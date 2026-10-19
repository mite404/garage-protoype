import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const cents = z.number().int().nonnegative();

/** Hard constraints a confirmed buyer need places on any candidate vehicle. */
export const needSchema = z
  .object({
    id,
    buyer: z.string().trim().min(1).max(200),
    vehicleClass: z.string().trim().min(1).max(100),
    maxAllInCents: cents.positive(),
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
export type Requirement = "available" | "height" | "allInCost" | "authority";
export type FitStatus = "met" | "not_met" | "unknown" | "incomplete";
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
  allInCost: "What are the asking price, transport cost and any other charges?",
  authority: "Who can authorize the sale?",
};

/** Requirement labels shown in fit tables and decision packets. */
export const requirementLabel = (need: Need, requirement: Requirement) =>
  ({
    available: "Available for sale",
    height: `Height ≤${need.maxHeightIn} in`,
    allInCost: `All-in cost ≤${money(need.maxAllInCents)}`,
    authority: "Seller authority",
  })[requirement];

/** Latest accepted answer per field; proposed and rejected facts never count. */
export function currentAnswers(facts: Fact[]): Answers {
  const answers: Answers = {};
  const accepted = facts
    .filter((fact) => fact.status === "accepted" && fact.reviewedAt)
    .sort((a, b) => a.reviewedAt!.getTime() - b.reviewedAt!.getTime()); // → oldest first
  for (const fact of accepted) Object.assign(answers, { [fact.field]: fact });
  return answers;
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
  const known = costFields.flatMap((field) => answers[field] ?? []);
  const sourceRefs = known.map((fact) => fact.sourceRef);
  if (!known.length)
    return { status: "unknown", evidence: "Price, transport and fees missing", sourceRefs };
  const total = known.reduce((sum, fact) => sum + fact.value, 0);
  if (known.length < costFields.length) {
    const missing = costFields
      .filter((field) => !answers[field])
      .map((f) => f.replace("Cents", ""));
    // A partial sum already over the limit is a definite failure.
    return total > need.maxAllInCents
      ? { status: "not_met", evidence: `${money(total)} before ${missing.join(", ")}`, sourceRefs }
      : { status: "incomplete", evidence: `${missing.join(", ")} missing`, sourceRefs };
  }
  return {
    status: total <= need.maxAllInCents ? "met" : "not_met",
    evidence: `${money(total)} all-in`,
    sourceRefs,
  };
}

/** Evaluates each hard constraint from accepted facts only; missing evidence is never a pass. */
export function evaluateFit(need: Need, facts: Fact[]): FitRow[] {
  const answers = currentAnswers(facts);
  const authority = answers.authority;
  return [
    { requirement: "available", ...availableRow(answers.saleStatus) },
    { requirement: "height", ...heightRow(need, answers.heightIn) },
    { requirement: "allInCost", ...costRow(need, answers) },
    {
      requirement: "authority",
      ...(authority
        ? { status: "met", evidence: authority.value, sourceRefs: [authority.sourceRef] }
        : { status: "unknown", evidence: "Not established", sourceRefs: [] }),
    },
  ];
}

/** Questions for every requirement that accepted facts have not resolved. */
export const openQuestions = (rows: FitRow[]) =>
  rows
    .filter((row) => row.status === "unknown" || row.status === "incomplete")
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
    excerpt: string;
    sourceLabel: string;
    url: string;
    observedAt: Date;
  };
  need: Need & { buyerHref: string };
  inventorySearch: { searchedAt: Date; reviewedMatches: number };
  contact: {
    identity: "pending_review" | "reviewed";
    permission: "not_established" | "established";
  };
  outreach: {
    deliveryEnabled: boolean;
    state: "none" | "draft" | "queued" | "sent" | "uncertain" | "stopped";
    stopReason: string | null;
  };
  replies: { id: string; channel: "email" | "form"; receivedAt: Date; text: string }[];
  facts: Fact[];
  decision: (Decision & { decidedAt: Date }) | null;
};
