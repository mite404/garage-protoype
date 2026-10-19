import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const cents = z.number().int().nonnegative();

/** Hard constraints a confirmed buyer need places on any candidate vehicle. */
export const needSchema = z
  .object({
    id,
    // A new revision makes every decision recorded against an older one stale.
    revision: z.number().int().positive(),
    buyer: z.string().trim().min(1).max(200),
    vehicleClass: z.string().trim().min(1).max(100),
    // USD with an explicit basis: a purchase-price limit never stands in for a total budget.
    budgetBasis: z.enum(["purchase_price", "total"]),
    maxBudgetCents: cents.positive(),
    maxHeightIn: z.number().positive().max(240),
  })
  .strict();

// Each answer kind has exactly one value shape, so a fact cannot carry a mismatched value.
const answerSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("saleStatus"),
    value: z.enum(["available", "maybe_later", "not_selling"]),
  }),
  z.object({ field: z.literal("authority"), value: z.string().trim().min(1).max(200) }),
  z.object({ field: z.literal("heightIn"), value: z.number().positive().max(240) }),
  z.object({ field: z.literal("priceCents"), value: cents }),
  z.object({ field: z.literal("transportCents"), value: cents }),
  z.object({ field: z.literal("feesCents"), value: cents }),
]);

/** A proposed or reviewed answer for one pairing, always tied to its original source. */
export const factSchema = z.intersection(
  answerSchema,
  z.object({
    id,
    // structured = deterministic selection; ai_interpretation stays proposed until reviewed.
    basis: z.enum(["structured", "explicit_reply", "source_claim", "ai_interpretation"]),
    sourceRef: id,
    status: z.enum(["proposed", "accepted", "rejected"]),
    reviewedAt: z.date().nullable(),
  }),
);

/** A specialist's recorded decision for one need and candidate pairing. */
export const decisionSchema = z
  .object({
    decision: z.enum(["proceed", "investigate", "reject"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export type Need = z.infer<typeof needSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Field = Fact["field"];
export type Decision = z.infer<typeof decisionSchema>;
export type Requirement = "available" | "height" | "budget" | "authority";
export type FitStatus = "met" | "not_met" | "unknown" | "incomplete" | "conflicting";
// The need revision and accepted evidence a decision was made against.
export type DecisionBasis = { needRevision: number; factIds: string[] };
export type FitRow = {
  requirement: Requirement;
  status: FitStatus;
  evidence: string;
  sourceRefs: string[];
};
type Answers = Partial<{ [F in Field]: Extract<Fact, { field: F }> }>;

const costFields = ["priceCents", "transportCents", "feesCents"] as const;
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const money = (value: number) => usd.format(value / 100);
const questions: Record<Requirement, string> = {
  available: "Is the vehicle being offered for sale, and when?",
  height: "What is the exact overall height in inches?",
  budget: "What are the asking price, transport cost and any other charges?",
  authority: "Who can authorize the sale?",
};

/** Requirement labels shown in fit tables and decision packets. */
export const requirementLabel = (need: Need, requirement: Requirement) =>
  ({
    available: "Available for sale",
    height: `Height ≤${need.maxHeightIn} in`,
    budget: `${need.budgetBasis === "total" ? "All-in cost" : "Purchase price"} ≤${money(need.maxBudgetCents)}`,
    authority: "Seller authority",
  })[requirement];

const requirementFields: Record<Requirement, Field[]> = {
  available: ["saleStatus"],
  height: ["heightIn"],
  budget: [...costFields],
  authority: ["authority"],
};

const accepted = (facts: Fact[]) => facts.filter((fact) => fact.status === "accepted");

/** Accepted answer per field; proposed and rejected facts never count. */
export function currentAnswers(facts: Fact[]): Answers {
  const answers: Answers = {};
  for (const fact of accepted(facts)) Object.assign(answers, { [fact.field]: fact });
  return answers;
}

// Accepted facts for one field that disagree stay unresolved until a reviewer rejects one.
function conflictRow(fields: Field[], facts: Fact[]): Omit<FitRow, "requirement"> | null {
  const clashing = fields
    .map((field) => accepted(facts).filter((fact) => fact.field === field))
    .find((group) => new Set(group.map((fact) => fact.value)).size > 1);
  if (!clashing) return null;
  return {
    status: "conflicting",
    evidence: `Reviewed answers disagree: ${clashing.map((fact) => fact.value).join(" vs ")}`,
    sourceRefs: clashing.map((fact) => fact.sourceRef),
  };
}

function availableRow(answer: Answers["saleStatus"]): Omit<FitRow, "requirement"> {
  if (!answer) return { status: "unknown", evidence: "Not confirmed", sourceRefs: [] };
  const refs = [answer.sourceRef];
  if (answer.value === "available") return { status: "met", evidence: "Offered", sourceRefs: refs };
  if (answer.value === "not_selling")
    return { status: "not_met", evidence: "Not selling", sourceRefs: refs };
  return { status: "unknown", evidence: "Maybe later; timing unconfirmed", sourceRefs: refs };
}

function heightRow(need: Need, answer: Answers["heightIn"]): Omit<FitRow, "requirement"> {
  if (!answer) return { status: "unknown", evidence: "No measurement supplied", sourceRefs: [] };
  return {
    status: answer.value <= need.maxHeightIn ? "met" : "not_met",
    evidence: `${answer.value} in`,
    sourceRefs: [answer.sourceRef],
  };
}

// Price alone never establishes all-in cost: every cost component must be answered.
function costRow(need: Need, answers: Answers): Omit<FitRow, "requirement"> {
  const fields = need.budgetBasis === "total" ? costFields : (["priceCents"] as const);
  const known = fields.flatMap((field) => answers[field] ?? []);
  const sourceRefs = known.map((fact) => fact.sourceRef);
  if (!known.length)
    return { status: "unknown", evidence: "Price, transport and fees missing", sourceRefs };
  const total = known.reduce((sum, fact) => sum + fact.value, 0);
  if (known.length < fields.length) {
    const missing = fields.filter((field) => !answers[field]).map((f) => f.replace("Cents", ""));
    // A partial sum already over the limit is a definite failure.
    return total > need.maxBudgetCents
      ? { status: "not_met", evidence: `${money(total)} before ${missing.join(", ")}`, sourceRefs }
      : { status: "incomplete", evidence: `${missing.join(", ")} missing`, sourceRefs };
  }
  return {
    status: total <= need.maxBudgetCents ? "met" : "not_met",
    evidence: `${money(total)}${need.budgetBasis === "total" ? " all-in" : ""}`,
    sourceRefs,
  };
}

/** Evaluates each hard constraint from accepted facts only; missing evidence is never a pass. */
export function evaluateFit(need: Need, facts: Fact[]): FitRow[] {
  const answers = currentAnswers(facts);
  const authority = answers.authority;
  const rows: Record<Requirement, Omit<FitRow, "requirement">> = {
    available: availableRow(answers.saleStatus),
    height: heightRow(need, answers.heightIn),
    budget: costRow(need, answers),
    authority: authority
      ? { status: "met", evidence: authority.value, sourceRefs: [authority.sourceRef] }
      : { status: "unknown", evidence: "Not established", sourceRefs: [] },
  };
  return (Object.keys(rows) as Requirement[]).map((requirement) => ({
    requirement,
    ...(conflictRow(requirementFields[requirement], facts) ?? rows[requirement]),
  }));
}

/** Freezes the need revision and accepted evidence a decision is made against. */
export const decisionBasis = (need: Need, facts: Fact[]): DecisionBasis => ({
  needRevision: need.revision,
  factIds: accepted(facts)
    .map((fact) => fact.id)
    .sort(),
});

/** True when the need was revised or accepted evidence changed since the decision. */
export function isStale(basis: DecisionBasis, need: Need, facts: Fact[]) {
  const current = decisionBasis(need, facts);
  return (
    basis.needRevision !== current.needRevision || basis.factIds.join() !== current.factIds.join()
  );
}

/** Questions for every requirement that accepted facts have not resolved. */
export const openQuestions = (rows: FitRow[]) =>
  rows
    .filter((row) => row.status !== "met" && row.status !== "not_met")
    .map((row) => questions[row.requirement]);

/**
 * Rule-derived suggestion, not a confidence score: reject on any failed constraint,
 * proceed only when every constraint is met, otherwise keep investigating.
 */
export function suggestDecision(rows: FitRow[]): Decision["decision"] {
  if (rows.some((row) => row.status === "not_met")) return "reject";
  return rows.every((row) => row.status === "met") ? "proceed" : "investigate";
}

/**
 * Validates a specialist decision against current fit before it is recorded.
 * @throws {Error} When the input is malformed or proceeds with unresolved or failed constraints.
 */
export function checkDecision(rows: FitRow[], input: unknown): Decision {
  const decision = decisionSchema.parse(input);
  if (decision.decision === "proceed" && suggestDecision(rows) !== "proceed")
    throw new Error("Every hard constraint must be met by accepted evidence before proceeding.");
  return decision;
}

/**
 * Accepts the selected proposals and leaves the rest proposed, so unselected
 * interpretations stay unresolved rather than silently changing facts.
 * @throws {Error} When a selected id is not a current proposal.
 */
export function acceptSelected(facts: Fact[], selected: string[], at: Date): Fact[] {
  const proposed = new Set(facts.filter((f) => f.status === "proposed").map((f) => f.id));
  const stale = selected.find((factId) => !proposed.has(factId));
  if (stale) throw new Error(`Fact ${stale} is not a current proposal.`);
  return facts.map((fact) =>
    selected.includes(fact.id) ? { ...fact, status: "accepted", reviewedAt: at } : fact,
  );
}

// Read model for one seller-candidate account page; server code assembles it from the
// owning growth and pairing operations, never from client input.
export type SourcingAccount = {
  account: {
    id: string;
    name: string;
    place: string; // e.g. "Cedar Valley, NY"
    roles: ("buyer" | "seller")[];
    synthetic: boolean;
  };
  owner: string;
  nextAction: string;
  trigger: {
    id: string;
    excerpt: string;
    sourceLabel: string;
    url: string;
    observedAt: Date;
  } | null;
  need: Need & { buyerHref: string };
  inventorySearch: { searchedAt: Date; reviewedMatches: number } | null;
  contact: {
    identity: "pending_review" | "reviewed";
    permission: "not_established" | "established";
  };
  outreach: {
    deliveryEnabled: boolean;
    state: "none" | "draft" | "queued" | "sent" | "uncertain" | "stopped";
    stopReason: string | null;
  };
  // Verified email replies and specialist-recorded notes, verbatim.
  replies: { id: string; channel: "email" | "note"; receivedAt: Date; text: string }[];
  facts: Fact[];
  decision: (Decision & { decidedAt: Date; basis: DecisionBasis }) | null;
};
