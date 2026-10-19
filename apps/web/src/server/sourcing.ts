import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  acceptSelected,
  checkDecision,
  decisionBasis,
  evaluateFit,
  factSchema,
  needSchema,
  type Fact,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import { sourcingCardRef } from "@signal-desk/contracts/assistance-schema";
import type { Actor } from "./access";
import { lockedTransaction, orm } from "./db";
import {
  buyerNeeds,
  cardCalls,
  pairingEvents,
  pairingFacts,
  sourceChanges,
  sourcingCases,
  streamTurns,
} from "./db-schema";
import { AppError } from "./errors";
import { requireGrowthActor, requireProspect } from "./growth";
import { readReceivedReplies } from "./growth-integrations";
import { enrollSequence, readOutreach } from "./outreach";
import { parseInput } from "./validation";

type Case = typeof sourcingCases.$inferSelect;
type Need = typeof buyerNeeds.$inferSelect;

const id = z.string().trim().min(1).max(160);
const revision = z.number().int().nonnegative();
const constraintsSchema = needSchema.pick({
  vehicleClass: true,
  budgetBasis: true,
  maxBudgetCents: true,
  maxHeightIn: true,
});
const inventorySchema = z.object({
  searchedAt: z.coerce.date(),
  reviewedMatches: z.number().int().nonnegative(),
});
const decisionRecord = z.object({
  decision: z.enum(["proceed", "investigate", "reject"]),
  reason: z.string(),
  decidedAt: z.coerce.date(),
  basis: z.object({ needRevision: z.number().int(), factIds: z.array(z.string()) }),
});
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept"), revision, factIds: z.array(id).min(1).max(20) }).strict(),
  z.object({ kind: z.literal("reject_fact"), revision, factId: id }).strict(),
  z
    .object({
      kind: z.literal("decide"),
      revision,
      decision: z.enum(["proceed", "investigate", "reject"]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("draft"),
      revision,
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(5000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("record_original"),
      revision,
      text: z.string().trim().min(1).max(5000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("source_disposition"),
      revision,
      sourceChangeId: id,
      disposition: z.enum(["kept", "dismissed"]),
    })
    .strict(),
]);
// A specialist command against one sourcing case, checked against its current revision.
type SourcingCommand = z.infer<typeof command>;
const proposalInput = z.object({ sourceRef: id, answer: z.unknown() }).strict();
// Terminal stages a decision moves a case to; a rejection never touches the buyer need.
const decisionStages = {
  proceed: "ready_for_buyer_review",
  investigate: "investigate",
  reject: "rejected",
};
// Next actions a decision implies; investigating keeps the specialist's current next action.
const decisionActions: Record<string, string | undefined> = {
  proceed: "Share the reviewed pairing with the buyer for review.",
  reject: "Find another candidate for this buyer need.",
};
// A sequence reports its most significant step: uncertain, then stopped, then sent.
const statePriority = ["queued", "dispatched", "sent", "stopped", "uncertain"];
// Stages where asking the seller is still meaningful; a decided pairing must be reopened first.
const openStages = new Set(["investigate", "awaiting_seller", "evidence_review"]);
const outreachStates = {
  queued: "queued",
  dispatched: "sent",
  sent: "sent",
  uncertain: "uncertain",
  stopped: "stopped",
} as const;

/** Cards the sourcing assistant may open; each renders from current saved records. */
export const sourcingView = sourcingCardRef.shape.view;
type SourcingView = z.infer<typeof sourcingView>;

const pairingKey = (caseId: string, at: number) => `pairing:${caseId}:${at}`;
const byRevision = (a: string, b: string) =>
  Number(a.split(":").at(-1)) - Number(b.split(":").at(-1));
const factId = (caseId: string, sourceRef: string, field: string, value: unknown) =>
  `fact:${createHash("sha256")
    .update(JSON.stringify([caseId, sourceRef, field, value]))
    .digest("hex")
    .slice(0, 32)}`;

// Explicit numeric heights with a unit are deterministic; everything else needs a reviewer.
function heightProposals(text: string) {
  if (!/\b(tall|heights?|high)\b(?!-)/i.test(text)) return [];
  const inches = [...text.matchAll(/\b(\d{2,3}(?:\.\d)?)\s*(?:in\b|inch(?:es)?\b|")/gi)].map(
    (match) => Number(match[1]),
  );
  const feet = [
    ...text.matchAll(/\b(\d{1,2})\s*(?:ft|feet|')\s*(\d{1,2})?\s*(?:in\b|inch(?:es)?\b|")?/gi),
  ].map((match) => Number(match[1]) * 12 + Number(match[2] ?? 0));
  // Apparatus heights only, so counts and partial measurements are not proposed.
  return [...new Set([...inches, ...feet])].filter((value) => value >= 60 && value <= 240);
}

function factRow(row: typeof pairingFacts.$inferSelect): Fact {
  return factSchema.parse({
    id: row.id,
    field: row.field,
    value: row.value,
    basis: row.basis,
    sourceRef: row.sourceRef,
    status: row.status,
    reviewedAt: row.reviewedAt,
  });
}

function needProjection(need: Need) {
  return needSchema.parse({
    id: need.id,
    revision: need.revision,
    buyer: need.buyerLabel,
    ...constraintsSchema.parse(need.constraints),
  });
}

// Reviews and recorded originals advance the revision; assistant proposals never do, so a turn
// that proposes an answer does not invalidate itself.
async function caseRevision(client: PoolClient | undefined, caseId: string) {
  const [row] = await orm(client)
    .select({ events: count() })
    .from(pairingEvents)
    .where(and(eq(pairingEvents.caseId, caseId), ne(pairingEvents.kind, "proposed")));
  return row?.events ?? 0;
}

async function recordEvent(
  client: PoolClient,
  row: Case,
  actorId: string,
  kind: string,
  detail: string,
) {
  const [total] = await orm(client)
    .select({ events: count() })
    .from(pairingEvents)
    .where(eq(pairingEvents.caseId, row.id));
  const eventId = `${row.id}:${(total?.events ?? 0) + 1}`;
  await orm(client)
    .insert(pairingEvents)
    .values({ id: eventId, caseId: row.id, actorId, kind, detail });
  return eventId;
}

/** Reads one sourcing case owned by the current specialist, with its seller prospect checked
 * through the growth owner's assertion. Grants nothing on the growth account itself.
 * @throws {AppError} For revoked access, another owner's case or an inaccessible seller.
 */
export async function requireSourcingCase(actor: Actor, caseId: string, client?: PoolClient) {
  const current = await requireGrowthActor(actor, client);
  const [row] = await orm(client)
    .select({ pairing: sourcingCases, need: buyerNeeds })
    .from(sourcingCases)
    .innerJoin(buyerNeeds, eq(buyerNeeds.id, sourcingCases.needId))
    .where(
      and(
        eq(sourcingCases.id, caseId),
        eq(sourcingCases.ownerId, current.userId),
        eq(buyerNeeds.ownerId, current.userId),
      ),
    );
  if (!row) throw new AppError(404, "NOT_FOUND", "Sourcing case not found.");
  const seller = await requireProspect(actor, row.pairing.sellerProspectId, client);
  return { ...row, seller };
}

/** Lists the specialist's own sourcing cases as a work queue, newest first.
 * @throws {AppError} For revoked specialist access.
 */
export async function listSourcingCases(actor: Actor) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select({ pairing: sourcingCases, need: buyerNeeds })
    .from(sourcingCases)
    .innerJoin(buyerNeeds, eq(buyerNeeds.id, sourcingCases.needId))
    .where(and(eq(sourcingCases.ownerId, current.userId), eq(buyerNeeds.ownerId, current.userId)))
    .orderBy(desc(sourcingCases.createdAt))
    .limit(100);
  const cases = [];
  // Each seller is rechecked by its owner; an inaccessible seller drops its row.
  for (const { pairing, need } of rows) {
    const seller = await requireProspect(actor, pairing.sellerProspectId).catch(() => null);
    if (seller)
      cases.push({
        id: pairing.id,
        needId: need.id,
        sellerId: seller.id,
        constraints: constraintsSchema.parse(need.constraints),
        buyer: need.buyerLabel,
        seller: seller.name,
        stage: pairing.stage,
        nextAction: pairing.nextAction,
        needState: need.state,
      });
  }
  await requireGrowthActor(actor);
  return cases;
}

// Runs one serialized write with current write scope checked at both transaction boundaries.
function writeTransaction<T>(
  actor: Actor,
  lock: string,
  action: (client: PoolClient) => Promise<T>,
) {
  return lockedTransaction(
    sql`select pg_advisory_xact_lock(hashtextextended(${lock},76101))`,
    async (client) => {
      await requireGrowthActor(actor, client, true);
      const result = await action(client);
      await requireGrowthActor(actor, client, true);
      return result;
    },
  );
}

/** Serializes one case's changes and rechecks both owners before commit.
 * @throws {AppError} For revoked access, lost ownership or a stale revision.
 */
async function changeCase<T>(
  actor: Actor,
  caseId: string,
  // null records something that already happened elsewhere, such as a growth enrollment.
  expected: number | null,
  action: (client: PoolClient, row: Awaited<ReturnType<typeof requireSourcingCase>>) => Promise<T>,
) {
  return writeTransaction(actor, caseId, async (client) => {
    const row = await requireSourcingCase(actor, caseId, client);
    if (expected !== null && (await caseRevision(client, caseId)) !== expected)
      throw new AppError(
        412,
        "STALE_REVIEW",
        "This case changed. Review the current record again.",
      );
    const result = await action(client, row);
    await requireSourcingCase(actor, caseId, client);
    return result;
  });
}

// Originals: verified email replies for this case's enrollments, plus specialist-recorded notes.
async function readOriginals(
  actor: Actor,
  caseId: string,
  prospectId: string,
  client?: PoolClient,
) {
  const emails = await readReceivedReplies(actor, prospectId);
  const notes = await orm(client)
    .select()
    .from(pairingEvents)
    .where(and(eq(pairingEvents.caseId, caseId), eq(pairingEvents.kind, "original")))
    .orderBy(asc(pairingEvents.createdAt));
  return [
    ...emails
      .filter((reply) => reply.enrollmentKey?.startsWith(`pairing:${caseId}:`))
      .map((reply) => ({
        id: reply.receiptId,
        channel: "email" as const,
        receivedAt: new Date(reply.receivedAt),
        text: reply.text,
      })),
    ...notes.map((note) => ({
      id: note.id,
      channel: "note" as const,
      receivedAt: note.createdAt,
      text: note.detail,
    })),
  ];
}

// Only the newest enrollment describes current outreach; earlier sequences are history.
function latestOutreach<T extends { enrollmentKey: string | null; state: string }>(messages: T[]) {
  const newest = messages
    .map((message) => message.enrollmentKey ?? "")
    .sort(byRevision)
    .at(-1);
  return messages
    .filter((message) => message.enrollmentKey === newest)
    .toSorted((a, b) => statePriority.indexOf(b.state) - statePriority.indexOf(a.state))[0];
}

function outreachSummary(latest: { state: string } | undefined) {
  if (!latest) return { state: "none" as const, stopReason: null };
  return {
    state: outreachStates[latest.state as keyof typeof outreachStates],
    stopReason: latest.state === "stopped" ? "Follow-up stopped" : null,
  };
}

/** Builds the department page for one case from saved, authorized records only.
 * @throws {AppError} For revoked access or another owner's case.
 */
export async function getSourcingAccount(actor: Actor, caseId: string) {
  const { pairing, need, seller } = await requireSourcingCase(actor, caseId);
  const [facts, changes, replies, messages, current] = [
    await orm()
      .select()
      .from(pairingFacts)
      .where(eq(pairingFacts.caseId, caseId))
      .orderBy(asc(pairingFacts.createdAt)),
    await orm()
      .select()
      .from(sourceChanges)
      .where(eq(sourceChanges.caseId, caseId))
      .orderBy(desc(sourceChanges.observedAt)),
    await readOriginals(actor, caseId, seller.id),
    (await readOutreach(actor, seller.id)).filter((message) =>
      message.enrollmentKey?.startsWith(`pairing:${caseId}:`),
    ),
    await caseRevision(undefined, caseId),
  ];
  const trigger = changes.find((change) => change.disposition !== "dismissed") ?? null;
  const latest = latestOutreach(messages);
  const contact = seller.review?.contact;
  const account: SourcingAccount = {
    account: {
      id: seller.id,
      name: seller.name,
      place: `${seller.directory.city}, NY`,
      roles: ["seller"],
      synthetic: seller.directory.synthetic,
    },
    owner: "You",
    nextAction: pairing.nextAction,
    trigger: trigger && {
      id: trigger.id,
      excerpt: trigger.excerpt,
      sourceLabel: trigger.sourceLabel,
      url: trigger.url,
      observedAt: trigger.observedAt,
    },
    need: { ...needProjection(need), buyerHref: `/desk/sourcing#need-${need.id}` },
    inventorySearch: need.inventory ? inventorySchema.parse(need.inventory) : null,
    contact: {
      identity: seller.identityState === "confirmed" ? "reviewed" : "pending_review",
      permission: contact && seller.contactable ? "established" : "not_established",
    },
    outreach: {
      deliveryEnabled: process.env.GROWTH_DELIVERY_MODE === "allowlisted-test",
      ...outreachSummary(latest),
    },
    replies,
    facts: facts.map(factRow),
    decision: pairing.decision ? decisionRecord.parse(pairing.decision) : null,
  };
  await requireSourcingCase(actor, caseId);
  return {
    caseId,
    revision: current,
    stage: pairing.stage,
    sellerHref: `/desk/prospects/${seller.id}`,
    account,
  };
}

// Proposes one answer for review; never accepts it. Used by the assistant and parsers.
async function proposeFact(
  client: PoolClient,
  row: Case,
  actorId: string,
  basis: Fact["basis"],
  raw: unknown,
) {
  const input = parseInput(proposalInput, raw);
  const answer = parseInput(factSchema, {
    ...(input.answer as object),
    id: "pending",
    basis,
    sourceRef: input.sourceRef,
    status: "proposed",
    reviewedAt: null,
  });
  const idValue = factId(row.id, input.sourceRef, answer.field, answer.value);
  const inserted = await orm(client)
    .insert(pairingFacts)
    .values({
      id: idValue,
      caseId: row.id,
      field: answer.field,
      value: answer.value,
      basis,
      sourceRef: input.sourceRef,
    })
    .onConflictDoNothing()
    .returning({ id: pairingFacts.id });
  if (inserted.length)
    await recordEvent(client, row, actorId, "proposed", `${answer.field} from ${input.sourceRef}`);
  return idValue;
}

async function recordEnrollment(
  client: PoolClient,
  row: Awaited<ReturnType<typeof requireSourcingCase>>,
  actor: Actor,
  key: string,
) {
  const [prior] = await orm(client)
    .select({ id: pairingEvents.id })
    .from(pairingEvents)
    .where(
      and(
        eq(pairingEvents.caseId, row.pairing.id),
        eq(pairingEvents.kind, "draft_enrolled"),
        eq(pairingEvents.detail, key),
      ),
    );
  if (prior) return;
  await recordEvent(client, row.pairing, actor.userId, "draft_enrolled", key);
  await orm(client)
    .update(sourcingCases)
    .set({ stage: "awaiting_seller" })
    .where(
      and(eq(sourcingCases.id, row.pairing.id), inArray(sourcingCases.stage, [...openStages])),
    );
}

async function decide(
  client: PoolClient,
  row: Awaited<ReturnType<typeof requireSourcingCase>>,
  actorId: string,
  input: Extract<SourcingCommand, { kind: "decide" }>,
) {
  const facts = (
    await orm(client).select().from(pairingFacts).where(eq(pairingFacts.caseId, row.pairing.id))
  ).map(factRow);
  const need = needProjection(row.need);
  let decision;
  try {
    decision = checkDecision(evaluateFit(need, facts), {
      decision: input.decision,
      reason: input.reason,
    });
  } catch (error) {
    throw new AppError(409, "DECISION_REFUSED", (error as Error).message);
  }
  await orm(client)
    .update(sourcingCases)
    .set({
      decision: { ...decision, decidedAt: new Date(), basis: decisionBasis(need, facts) },
      stage: decisionStages[decision.decision],
      nextAction: decisionActions[decision.decision] ?? row.pairing.nextAction,
    })
    .where(eq(sourcingCases.id, row.pairing.id));
  await recordEvent(client, row.pairing, actorId, `decided_${decision.decision}`, decision.reason);
}

async function review(
  client: PoolClient,
  row: Awaited<ReturnType<typeof requireSourcingCase>>,
  actorId: string,
  factIds: string[],
) {
  const facts = (
    await orm(client).select().from(pairingFacts).where(eq(pairingFacts.caseId, row.pairing.id))
  ).map(factRow);
  let accepted: Fact[];
  try {
    accepted = acceptSelected(facts, factIds, new Date());
  } catch {
    throw new AppError(409, "STALE_REVIEW", "A selected answer is no longer a current proposal.");
  }
  const at = new Date();
  await orm(client)
    .update(pairingFacts)
    .set({ status: "accepted", reviewedBy: actorId, reviewedAt: at })
    .where(and(eq(pairingFacts.caseId, row.pairing.id), inArray(pairingFacts.id, factIds)));
  await recordEvent(client, row.pairing, actorId, "accepted", factIds.join(","));
  return accepted;
}

/** Applies one reviewed specialist command. External delivery stays with the growth owner.
 * @throws {AppError} For invalid input, a stale revision, lost access or a refused decision.
 */
export async function runSourcingCommand(actor: Actor, caseId: string, raw: unknown) {
  const input = parseInput(command, raw);
  if (input.kind === "draft") {
    // Growth owns enrollment, suppression and stops; the key correlates replies to this case.
    // Check the revision and stage first, so a stale or closed pairing never enrolls.
    const { seller, pairing } = await requireSourcingCase(actor, caseId);
    if ((await caseRevision(undefined, caseId)) !== input.revision)
      throw new AppError(
        412,
        "STALE_REVIEW",
        "This case changed. Review the current record again.",
      );
    if (!openStages.has(pairing.stage))
      throw new AppError(409, "PAIRING_CLOSED", "Reopen this pairing before asking the seller.");
    const key = pairingKey(caseId, input.revision + 1);
    await enrollSequence(actor, seller.id, {
      purpose: "sourcing",
      key,
      subject: input.subject,
      body: input.body,
    });
    // The enrollment exists now, so it is recorded once even if the case changed meanwhile; a
    // decision made in between keeps its stage.
    return changeCase(actor, caseId, null, (client, row) =>
      recordEnrollment(client, row, actor, key),
    );
  }
  return changeCase(actor, caseId, input.revision, async (client, row) => {
    if (input.kind === "accept") return review(client, row, actor.userId, input.factIds);
    if (input.kind === "decide") return decide(client, row, actor.userId, input);
    if (input.kind === "reject_fact") {
      const rejected = await orm(client)
        .update(pairingFacts)
        .set({ status: "rejected", reviewedBy: actor.userId, reviewedAt: new Date() })
        .where(
          and(
            eq(pairingFacts.caseId, caseId),
            eq(pairingFacts.id, input.factId),
            ne(pairingFacts.status, "rejected"),
          ),
        )
        .returning({ id: pairingFacts.id });
      if (!rejected.length)
        throw new AppError(412, "STALE_REVIEW", "That answer is no longer current.");
      return recordEvent(client, row.pairing, actor.userId, "fact_rejected", input.factId);
    }
    if (input.kind === "source_disposition") {
      await orm(client)
        .update(sourceChanges)
        .set({ disposition: input.disposition })
        .where(and(eq(sourceChanges.caseId, caseId), eq(sourceChanges.id, input.sourceChangeId)));
      return recordEvent(
        client,
        row.pairing,
        actor.userId,
        `source_${input.disposition}`,
        input.sourceChangeId,
      );
    }
    // A recorded original keeps its verbatim text; explicit heights become proposals only.
    const sourceRef = await recordEvent(client, row.pairing, actor.userId, "original", input.text);
    for (const value of heightProposals(input.text))
      await proposeFact(client, row.pairing, actor.userId, "explicit_reply", {
        sourceRef,
        answer: { field: "heightIn", value },
      });
  });
}

/** Current review revision of a case; any recorded change advances it.
 * @throws {AppError} For revoked access or another owner's case.
 */
export async function sourcingRevision(actor: Actor, caseId: string) {
  await requireSourcingCase(actor, caseId);
  return caseRevision(undefined, caseId);
}

/** Reference-only chat cards for sourcing turns; the page resolves them from current records. */
export async function sourcingCards(turnIds: string[]) {
  const cards = new Map<string, { kind: "sourcing"; view: SourcingView }[]>();
  if (!turnIds.length) return cards;
  const rows = await orm()
    .select()
    .from(cardCalls)
    .where(and(inArray(cardCalls.turn_id, turnIds), eq(cardCalls.status, "accepted")));
  for (const row of rows) {
    const view = sourcingView.safeParse(row.tool);
    if (view.success)
      cards.set(row.turn_id, [
        ...(cards.get(row.turn_id) ?? []),
        { kind: "sourcing", view: view.data },
      ]);
  }
  return cards;
}

/** Records one reference-only card the assistant showed in a sourcing turn. Repeating a call ID
 * returns the original result.
 * @throws {AppError} For an unknown card, another subject's turn or lost access.
 */
export async function renderSourcingCard(
  actor: Actor,
  caseId: string,
  turnId: string,
  callId: string,
  raw: unknown,
) {
  const view = parseInput(sourcingView, raw);
  await requireSourcingCase(actor, caseId);
  const [turn] = await orm()
    .select({ id: streamTurns.id })
    .from(streamTurns)
    .where(
      and(
        eq(streamTurns.id, turnId),
        eq(streamTurns.sourcingCaseId, caseId),
        eq(streamTurns.actorId, actor.userId),
      ),
    );
  if (!turn) throw new AppError(404, "NOT_FOUND", "Turn not found.");
  await orm()
    .insert(cardCalls)
    .values({ turn_id: turnId, call_id: callId, tool: view, input: {}, status: "accepted" })
    .onConflictDoNothing();
  const [stored] = await orm()
    .select({ tool: cardCalls.tool })
    .from(cardCalls)
    .where(and(eq(cardCalls.turn_id, turnId), eq(cardCalls.call_id, callId)));
  return {
    shown: stored?.tool ?? view,
    note: "The specialist sees this card from current saved records.",
  };
}

/** Saves the assistant's proposal for a sourcing turn, never an accepted fact.
 * @throws {AppError} For an unknown original, invalid answer, stale revision or lost access.
 */
export async function proposeSourcingFact(
  actor: Actor,
  caseId: string,
  expected: number,
  raw: unknown,
) {
  return changeCase(actor, caseId, expected, async (client, row) => {
    const originals = await readOriginals(actor, caseId, row.seller.id, client);
    const input = parseInput(proposalInput, raw);
    if (!originals.some((original) => original.id === input.sourceRef))
      throw new AppError(422, "INVALID_INPUT", "Cite an original reply or note from this case.");
    return proposeFact(client, row.pairing, actor.userId, "ai_interpretation", input);
  });
}

const needInput = z
  .object({
    buyerLabel: z.string().trim().min(1).max(200),
    buyerOrganizationId: z.string().min(1).max(200).optional(),
    statement: z.string().trim().min(1).max(2000),
    provenance: z.string().trim().min(1).max(500),
    constraints: constraintsSchema,
    inventory: inventorySchema.optional(),
    synthetic: z.boolean(),
  })
  .strict();
const caseInput = z
  .object({
    needId: id,
    sellerProspectId: id,
    nextAction: z.string().trim().min(1).max(300),
    sourceChange: z
      .object({
        dedupeKey: id,
        sourceLabel: z.string().trim().min(1).max(200),
        url: z.url(),
        excerpt: z.string().trim().min(1).max(1000),
        observedAt: z.coerce.date(),
        synthetic: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** Records a confirmed buyer need owned by the current specialist. Creates no vehicle, deal or
 * buyer identity.
 * @throws {AppError} For invalid input or missing write access.
 */
export async function createBuyerNeed(actor: Actor, raw: unknown) {
  const input = parseInput(needInput, raw);
  const current = await requireGrowthActor(actor, undefined, true);
  const needId = crypto.randomUUID();
  await orm()
    .insert(buyerNeeds)
    .values({ id: needId, ownerId: current.userId, ...input });
  return needId;
}

/** Pairs an owned need with an owned seller prospect after a cited source change. The change is
 * a research trigger only. Repeating the same change returns the existing case.
 * @throws {AppError} For another owner's need or seller, invalid input or missing write access.
 */
export async function openSourcingCase(actor: Actor, raw: unknown) {
  const input = parseInput(caseInput, raw);
  return writeTransaction(
    actor,
    `pairing:${input.needId}:${input.sellerProspectId}`,
    async (client) => {
      const current = await requireGrowthActor(actor, client);
      const [need] = await orm(client)
        .select({ id: buyerNeeds.id })
        .from(buyerNeeds)
        .where(and(eq(buyerNeeds.id, input.needId), eq(buyerNeeds.ownerId, current.userId)));
      if (!need) throw new AppError(404, "NOT_FOUND", "Buyer need not found.");
      await requireProspect(actor, input.sellerProspectId, client);
      const [existing] = await orm(client)
        .select({ id: sourcingCases.id })
        .from(sourcingCases)
        .where(
          and(
            eq(sourcingCases.needId, input.needId),
            eq(sourcingCases.sellerProspectId, input.sellerProspectId),
          ),
        );
      if (existing) return existing.id;
      const caseId = crypto.randomUUID();
      await orm(client).insert(sourcingCases).values({
        id: caseId,
        needId: input.needId,
        sellerProspectId: input.sellerProspectId,
        ownerId: current.userId,
        nextAction: input.nextAction,
      });
      await orm(client)
        .insert(sourceChanges)
        .values({ id: crypto.randomUUID(), caseId, ...input.sourceChange })
        .onConflictDoNothing();
      await orm(client)
        .insert(pairingEvents)
        .values({
          id: `${caseId}:1`,
          caseId,
          actorId: current.userId,
          kind: "opened",
          detail: input.sourceChange.sourceLabel,
        });
      await requireProspect(actor, input.sellerProspectId, client);
      return caseId;
    },
  );
}
