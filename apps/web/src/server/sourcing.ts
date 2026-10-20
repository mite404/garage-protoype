import "server-only";
import { createHash } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  acceptSelected,
  checkDecision,
  decisionBasis,
  evaluateFit,
  factSchema,
  isStale,
  needSchema,
  type Fact,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import { sourcingCardRef } from "@signal-desk/contracts/assistance-schema";
import { connectionOpen } from "@signal-desk/catalog/desk-state";
import { requireSession, type Actor } from "./access";
import { lockedTransaction, orm } from "./db";
import {
  buyerNeeds,
  cardCalls,
  connectionBlockers,
  growthAccounts,
  organizations,
  pairingEvents,
  pairingFacts,
  sourceChanges,
  sourcingCases,
  streamTurns,
  vehicles,
} from "./db-schema";
import { AppError } from "./errors";
import { changeProspect, recordGrowthEvent, requireGrowthActor, requireProspect } from "./growth";
import { readReceivedReplies } from "./growth-integrations";
import { enrollSequence, readOutreach } from "./outreach";
import { parseInput } from "./validation";

type Case = typeof sourcingCases.$inferSelect;
type Need = typeof buyerNeeds.$inferSelect;

const id = z.string().trim().min(1).max(160);
const revision = z.number().int().nonnegative();
const note = z.string().trim().min(1).max(2000);
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
  z.object({ kind: z.literal("introduce"), revision, note }).strict(),
  z.object({ kind: z.literal("close_sale"), revision, note }).strict(),
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
  proceed: "Share the reviewed evidence with the buyer, then record the introduction.",
  reject: "Find another candidate for this buyer need.",
};
// Stages a connection can no longer leave: one closed sale ends every competing connection.
const closedStages = ["sale_closed", "closed_elsewhere"];
// Milestones a specialist records after a proceed decision; nothing is sent or committed.
const milestones = {
  introduce: {
    from: "ready_for_buyer_review",
    to: "introduced",
    nextAction: "Follow up with the buyer and seller, then record the sale outcome.",
    refusal: "Record a current proceed decision before introducing the buyer.",
  },
  close_sale: {
    from: "introduced",
    to: "sale_closed",
    nextAction: "Sale recorded. Hand off payment and delivery to the people who own them.",
    refusal: "Introduce the buyer and seller before recording a sale.",
  },
} as const;
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

/** Lists the specialist's own connections, newest first, with each one's vehicle and the count
 * of proposed answers still waiting on review.
 * @throws {AppError} For revoked specialist access.
 */
export async function listSourcingCases(actor: Actor) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select({
      pairing: sourcingCases,
      need: buyerNeeds,
      vehicle: { id: vehicles.id, title: vehicles.title },
      proposals: sql<number>`(select count(*)::int from ${pairingFacts}
        where ${pairingFacts.caseId} = ${sourcingCases.id} and ${pairingFacts.status} = 'proposed')`,
    })
    .from(sourcingCases)
    .innerJoin(buyerNeeds, eq(buyerNeeds.id, sourcingCases.needId))
    .leftJoin(vehicles, eq(vehicles.id, sourcingCases.vehicleId))
    .where(and(eq(sourcingCases.ownerId, current.userId), eq(buyerNeeds.ownerId, current.userId)))
    .orderBy(desc(sourcingCases.createdAt))
    .limit(100);
  const cases = [];
  // Each seller is rechecked by its owner; an inaccessible seller drops its row.
  for (const { pairing, need, vehicle, proposals } of rows) {
    const seller = await requireProspect(actor, pairing.sellerProspectId).catch(() => null);
    if (seller)
      cases.push({
        id: pairing.id,
        needId: need.id,
        sellerId: seller.id,
        constraints: constraintsSchema.parse(need.constraints),
        buyer: need.buyerLabel,
        seller: seller.name,
        vehicle,
        proposals,
        stage: pairing.stage,
        nextAction: pairing.nextAction,
        needState: need.state,
      });
  }
  await requireGrowthActor(actor);
  return cases;
}

/** Lists the specialist's own buyer needs, newest first, including needs with no connection yet.
 * @throws {AppError} For revoked specialist access.
 */
export async function listBuyerNeeds(actor: Actor) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select()
    .from(buyerNeeds)
    .where(eq(buyerNeeds.ownerId, current.userId))
    .orderBy(desc(buyerNeeds.createdAt))
    .limit(100);
  await requireGrowthActor(actor);
  return rows.map((need) => ({
    id: need.id,
    buyer: need.buyerLabel,
    statement: need.statement,
    provenance: need.provenance,
    state: need.state,
    synthetic: need.synthetic,
    constraints: constraintsSchema.parse(need.constraints),
  }));
}

/** Lists vehicles owned by the departments of the specialist's own seller accounts, so a
 * connection can start from a listing. Drafts are included; nothing here publishes a listing.
 * @throws {AppError} For revoked specialist access.
 */
export async function listSellerListings(actor: Actor) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select({
      id: vehicles.id,
      title: vehicles.title,
      publishedAt: vehicles.published_at,
      sellerId: growthAccounts.id,
    })
    .from(vehicles)
    .innerJoin(growthAccounts, eq(growthAccounts.organizationId, vehicles.ownerOrganizationId))
    .where(eq(growthAccounts.ownerId, current.userId))
    .orderBy(asc(vehicles.title))
    .limit(100);
  await requireGrowthActor(actor);
  return rows.map(({ publishedAt, ...row }) => ({ ...row, listed: publishedAt !== null }));
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

// Opens a blocker for each requirement the reviewed evidence does not meet and resolves the open
// ones that it now meets. Closed connections keep their rows as they were.
async function syncBlockers(
  client: PoolClient,
  row: Awaited<ReturnType<typeof requireSourcingCase>>,
) {
  if (!connectionOpen(row.pairing.stage)) return;
  const facts = (
    await orm(client).select().from(pairingFacts).where(eq(pairingFacts.caseId, row.pairing.id))
  ).map(factRow); // → Fact[]
  const unmet = new Set<string>(
    evaluateFit(needProjection(row.need), facts)
      .filter((fit) => fit.status !== "met")
      .map((fit) => fit.requirement),
  );
  if (!row.seller.contactable) unmet.add("contact_permission");
  const open = await orm(client)
    .select()
    .from(connectionBlockers)
    .where(
      and(eq(connectionBlockers.caseId, row.pairing.id), isNull(connectionBlockers.resolvedAt)),
    );
  const resolved = open.filter((blocker) => !unmet.has(blocker.kind)).map((blocker) => blocker.id);
  // An empty list matches nothing, so this is a no-op when nothing resolved.
  await orm(client)
    .update(connectionBlockers)
    .set({ resolvedAt: sql`now()` })
    .where(inArray(connectionBlockers.id, resolved));
  const fresh = [...unmet].filter((kind) => !open.some((blocker) => blocker.kind === kind));
  if (fresh.length)
    await orm(client)
      .insert(connectionBlockers)
      .values(fresh.map((kind) => ({ id: crypto.randomUUID(), caseId: row.pairing.id, kind })))
      .onConflictDoNothing();
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
    await syncBlockers(client, await requireSourcingCase(actor, caseId, client));
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

type OutreachMessage = {
  enrollmentKey: string | null;
  state: string;
  step: number;
  subject: string;
  body: string;
};

function outreachSummary(messages: OutreachMessage[]) {
  const latest = latestOutreach(messages);
  if (!latest) return { state: "none" as const, stopReason: null, request: null };
  const first = messages.find(
    (message) => message.enrollmentKey === latest.enrollmentKey && message.step === 0,
  );
  return {
    state: outreachStates[latest.state as keyof typeof outreachStates],
    stopReason: latest.state === "stopped" ? "Follow-up stopped" : null,
    request: first ? { subject: first.subject, body: first.body } : null,
  };
}

/** Builds the department page for one case from saved, authorized records only.
 * @throws {AppError} For revoked access or another owner's case.
 */
export async function getSourcingAccount(actor: Actor, caseId: string) {
  const { pairing, need, seller } = await requireSourcingCase(actor, caseId);
  const [facts, changes, replies, messages, current, vehicle, progress] = [
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
    pairing.vehicleId
      ? (
          await orm()
            .select({ id: vehicles.id, title: vehicles.title, publishedAt: vehicles.published_at })
            .from(vehicles)
            .where(eq(vehicles.id, pairing.vehicleId))
        )[0]
      : undefined,
    await orm()
      .select()
      .from(pairingEvents)
      .where(
        and(
          eq(pairingEvents.caseId, caseId),
          inArray(pairingEvents.kind, ["introduced", "sale_closed"]),
        ),
      )
      .orderBy(asc(pairingEvents.createdAt)),
  ];
  const trigger = changes.find((change) => change.disposition !== "dismissed") ?? null;
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
      ...outreachSummary(messages),
    },
    replies,
    facts: facts.map(factRow),
    decision: pairing.decision ? decisionRecord.parse(pairing.decision) : null,
    connection: {
      stage: pairing.stage,
      vehicle: vehicle
        ? { id: vehicle.id, title: vehicle.title, listed: vehicle.publishedAt !== null }
        : null,
      milestones: progress.map((event) => ({
        kind: event.kind as "introduced" | "sale_closed",
        at: event.createdAt,
        note: event.detail,
      })),
    },
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
  if (closedStages.includes(row.pairing.stage))
    throw new AppError(
      409,
      "CONNECTION_CLOSED",
      "This connection is closed. Its decision is final.",
    );
  // After an introduction only a rejection still applies; the next step is the sale outcome.
  if (row.pairing.stage === "introduced" && input.decision !== "reject")
    throw new AppError(
      409,
      "CONNECTION_ADVANCED",
      "The buyer was introduced. Record the sale outcome or reject this connection.",
    );
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
    // A sale closed elsewhere meanwhile keeps this connection closed.
    .where(
      and(eq(sourcingCases.id, row.pairing.id), notInArray(sourcingCases.stage, closedStages)),
    );
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

// Shares writeTransaction's namespace, so opening and selling on one need or vehicle serialize.
const lockKey = (key: string) => sql`select pg_advisory_xact_lock(hashtextextended(${key},76101))`;

// A closed sale ends every other open connection for the same vehicle or the same buyer need, so
// one vehicle never counts as two sales and one need is never fulfilled twice.
async function closeCompeting(client: PoolClient, sold: Case, actorId: string) {
  const competing = await orm(client)
    .select()
    .from(sourcingCases)
    .where(
      and(
        ne(sourcingCases.id, sold.id),
        notInArray(sourcingCases.stage, [...closedStages, "rejected", "unavailable"]),
        sold.vehicleId
          ? sql`(${sourcingCases.needId} = ${sold.needId} or ${sourcingCases.vehicleId} = ${sold.vehicleId})`
          : eq(sourcingCases.needId, sold.needId),
      ),
    );
  for (const other of competing) {
    const reason =
      other.needId === sold.needId
        ? "The buyer need was fulfilled through another connection."
        : "The vehicle was sold through another connection.";
    await orm(client)
      .update(sourcingCases)
      .set({ stage: "closed_elsewhere", nextAction: reason })
      .where(eq(sourcingCases.id, other.id));
    // Its own ID namespace, since this transaction does not hold the other connection's lock.
    await orm(client)
      .insert(pairingEvents)
      .values({
        id: `${other.id}:closed:${sold.id}`,
        caseId: other.id,
        actorId,
        kind: "closed_elsewhere",
        detail: reason,
      });
  }
  await orm(client)
    .update(buyerNeeds)
    .set({ state: "fulfilled" })
    .where(eq(buyerNeeds.id, sold.needId));
}

async function advance(
  client: PoolClient,
  row: Awaited<ReturnType<typeof requireSourcingCase>>,
  actorId: string,
  input: Extract<SourcingCommand, { kind: "introduce" | "close_sale" }>,
) {
  const step = milestones[input.kind];
  // Sales for one need or one vehicle serialize, then the stage is read again under those locks.
  await orm(client).execute(lockKey(`need:${row.pairing.needId}`));
  if (row.pairing.vehicleId) await orm(client).execute(lockKey(`vehicle:${row.pairing.vehicleId}`));
  const [pairing] = await orm(client)
    .select()
    .from(sourcingCases)
    .where(eq(sourcingCases.id, row.pairing.id));
  const [need] = await orm(client).select().from(buyerNeeds).where(eq(buyerNeeds.id, row.need.id));
  if (!pairing || !need || pairing.stage !== step.from)
    throw new AppError(409, "STAGE_REQUIRED", step.refusal);
  if (!pairing.vehicleId)
    throw new AppError(
      409,
      "LISTING_REQUIRED",
      "Qualify the seller to draft its listing before introducing the buyer.",
    );
  if (need.state !== "active")
    throw new AppError(409, "NEED_INACTIVE", "This buyer need is no longer active.");
  if (input.kind === "introduce") {
    const facts = (
      await orm(client).select().from(pairingFacts).where(eq(pairingFacts.caseId, pairing.id))
    ).map(factRow);
    const decision = pairing.decision ? decisionRecord.parse(pairing.decision) : null;
    if (decision?.decision !== "proceed" || isStale(decision.basis, needProjection(need), facts))
      throw new AppError(409, "DECISION_REQUIRED", step.refusal);
  }
  await orm(client)
    .update(sourcingCases)
    .set({ stage: step.to, nextAction: step.nextAction })
    .where(eq(sourcingCases.id, pairing.id));
  await recordEvent(client, pairing, actorId, step.to, input.note);
  if (input.kind === "close_sale") await closeCompeting(client, pairing, actorId);
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
    if (input.kind === "introduce" || input.kind === "close_sale")
      return advance(client, row, actor.userId, input);
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
    // A connection starts from a buyer need toward a seller, or from a seller's listed vehicle.
    sellerProspectId: id.optional(),
    vehicleId: id.optional(),
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
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => input.sellerProspectId || input.vehicleId, "Choose a seller or a vehicle.");

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

// Adds a seller's vehicle to a connection that had none. The event uses its own ID namespace, since
// callers do not hold the connection's lock; the added event still advances its revision.
async function attachVehicle(client: PoolClient, row: Case, actorId: string, vehicleId: string) {
  const attached = await orm(client)
    .update(sourcingCases)
    .set({ vehicleId })
    .where(and(eq(sourcingCases.id, row.id), sql`${sourcingCases.vehicleId} is null`))
    .returning({ id: sourcingCases.id });
  if (attached.length)
    await orm(client)
      .insert(pairingEvents)
      .values({
        id: `${row.id}:vehicle:${vehicleId}`,
        caseId: row.id,
        actorId,
        kind: "vehicle_attached",
        detail: vehicleId,
      })
      .onConflictDoNothing();
}

// The seller account that owns a vehicle, among the current specialist's own accounts.
async function requireListingSeller(client: PoolClient, ownerId: string, vehicleId: string) {
  const [listing] = await orm(client)
    .select({ sellerId: growthAccounts.id })
    .from(vehicles)
    .innerJoin(growthAccounts, eq(growthAccounts.organizationId, vehicles.ownerOrganizationId))
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(growthAccounts.ownerId, ownerId),
        isNotNull(vehicles.ownerOrganizationId),
      ),
    )
    .orderBy(asc(growthAccounts.id))
    .limit(1);
  if (!listing) throw new AppError(404, "NOT_FOUND", "Listing not found.");
  return listing.sellerId;
}

type ConnectionInput = z.infer<typeof caseInput>;

async function requireActiveNeed(client: PoolClient, ownerId: string, needId: string) {
  const [need] = await orm(client)
    .select({ state: buyerNeeds.state })
    .from(buyerNeeds)
    .where(and(eq(buyerNeeds.id, needId), eq(buyerNeeds.ownerId, ownerId)));
  if (!need) throw new AppError(404, "NOT_FOUND", "Buyer need not found.");
  if (need.state !== "active")
    throw new AppError(409, "NEED_INACTIVE", "Only an active buyer need can be connected.");
}

// The seller on either side: named directly, or the owner of the chosen vehicle.
async function connectionSeller(client: PoolClient, ownerId: string, input: ConnectionInput) {
  if (!input.vehicleId) return input.sellerProspectId!;
  const sellerId = await requireListingSeller(client, ownerId, input.vehicleId);
  if (input.sellerProspectId && input.sellerProspectId !== sellerId)
    throw new AppError(409, "MATCH_REQUIRED", "That vehicle belongs to a different seller.");
  // Serializes with a sale of this vehicle, so a sold vehicle never gains a new connection.
  await orm(client).execute(lockKey(`vehicle:${input.vehicleId}`));
  const [sold] = await orm(client)
    .select({ id: sourcingCases.id })
    .from(sourcingCases)
    .where(
      and(eq(sourcingCases.vehicleId, input.vehicleId), eq(sourcingCases.stage, "sale_closed")),
    );
  if (sold) throw new AppError(409, "VEHICLE_SOLD", "This vehicle was already sold.");
  return sellerId;
}

// Repeating a connection returns it, adding the vehicle once it is known.
async function reuseConnection(
  client: PoolClient,
  existing: Case,
  actorId: string,
  vehicleId: string | undefined,
) {
  if (!vehicleId || existing.vehicleId === vehicleId) return existing.id;
  if (existing.vehicleId)
    throw new AppError(
      409,
      "CONNECTION_EXISTS",
      "This buyer need is already connected to another vehicle from this seller.",
    );
  await attachVehicle(client, existing, actorId, vehicleId);
  return existing.id;
}

async function insertConnection(
  client: PoolClient,
  ownerId: string,
  sellerId: string,
  input: ConnectionInput,
) {
  // Any listing the seller already has joins the connection, so either side reaches the vehicle.
  const [seller] = await orm(client)
    .select({ listing: growthAccounts.listingVehicleId })
    .from(growthAccounts)
    .where(eq(growthAccounts.id, sellerId));
  const caseId = crypto.randomUUID();
  await orm(client)
    .insert(sourcingCases)
    .values({
      id: caseId,
      needId: input.needId,
      sellerProspectId: sellerId,
      vehicleId: input.vehicleId ?? seller?.listing ?? null,
      ownerId,
      nextAction: input.nextAction,
    });
  if (input.sourceChange)
    await orm(client)
      .insert(sourceChanges)
      .values({ id: crypto.randomUUID(), caseId, ...input.sourceChange })
      .onConflictDoNothing();
  const origin = input.vehicleId ? "From a listed vehicle" : "From a buyer need";
  await orm(client)
    .insert(pairingEvents)
    .values({
      id: `${caseId}:1`,
      caseId,
      actorId: ownerId,
      kind: "opened",
      detail: input.sourceChange?.sourceLabel ?? origin,
    });
  return caseId;
}

/** Opens a connection between an owned, active buyer need and an owned seller, from either side:
 * toward a seller prospect, or from a vehicle that seller's department owns. A cited source change
 * is a research trigger only. Repeating the request returns the existing connection, adding the
 * vehicle when it was not yet known.
 * @throws {AppError} For another owner's need, seller or vehicle, an inactive need, a sold vehicle,
 *   a different vehicle already on the connection, invalid input or missing write access.
 */
export async function openConnection(actor: Actor, raw: unknown) {
  const input = parseInput(caseInput, raw);
  return writeTransaction(actor, `need:${input.needId}`, async (client) => {
    const current = await requireGrowthActor(actor, client);
    await requireActiveNeed(client, current.userId, input.needId);
    const sellerId = await connectionSeller(client, current.userId, input);
    await requireProspect(actor, sellerId, client);
    const [existing] = await orm(client)
      .select()
      .from(sourcingCases)
      .where(
        and(eq(sourcingCases.needId, input.needId), eq(sourcingCases.sellerProspectId, sellerId)),
      );
    const caseId = existing
      ? await reuseConnection(client, existing, current.userId, input.vehicleId)
      : await insertConnection(client, current.userId, sellerId, input);
    await syncBlockers(client, await requireSourcingCase(actor, caseId, client));
    return caseId;
  });
}

const qualifyInput = z
  .object({
    vehicleTitle: z.string().trim().min(1).max(200),
    reply: z.string().trim().min(1).max(1000),
    provenance: z.string().trim().min(1).max(1000),
    permission: z.enum(["synthetic", "permissioned"]),
  })
  .strict();

/** Qualifies a reviewed seller from its original reply: drafts one unpublished listing owned by the
 * seller's department and adds it to the seller's open connections. Creates no buyer opportunity,
 * no login for a contact and publishes nothing. Repeating returns the same listing.
 * @throws {AppError} For unreviewed identity, fit or sale signal, invalid input or revoked access.
 */
export async function qualifySeller(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(qualifyInput, raw);
  return changeProspect(actor, id, async (client, account) => {
    if (account.review?.identity !== "confirmed" || account.fit !== "fit" || !account.buyingSignal)
      throw new AppError(
        409,
        "REVIEW_REQUIRED",
        "Review identity, fit and the cited sale signal before qualifying this seller.",
      );
    if (account.listingVehicleId)
      return { vehicleId: account.listingVehicleId, organizationId: account.organizationId! };
    const organizationId = account.organizationId ?? `growth-${id}`;
    const vehicleId = `listing-${id}`;
    if (!account.organizationId)
      await orm(client).insert(organizations).values({
        id: organizationId,
        name: account.name,
        city: account.directory.city,
        region: "NY",
        unit: "",
        synthetic: account.directory.synthetic,
      });
    await orm(client)
      .insert(vehicles)
      .values({ id: vehicleId, title: input.vehicleTitle, ownerOrganizationId: organizationId });
    await orm(client)
      .update(growthAccounts)
      .set({ organizationId, listingVehicleId: vehicleId })
      .where(eq(growthAccounts.id, id));
    // The original reply stays verbatim beside the qualification, as the listing's first evidence.
    await recordGrowthEvent(
      client,
      id,
      "seller_reply",
      "seller_reply",
      `${input.reply}\n\nProvenance: ${input.provenance} · ${input.permission}`,
    );
    await recordGrowthEvent(
      client,
      id,
      "qualified",
      "qualified",
      "Human-reviewed seller reply; drafted an unpublished listing",
    );
    const open = await orm(client)
      .select()
      .from(sourcingCases)
      .where(
        and(
          eq(sourcingCases.sellerProspectId, id),
          sql`${sourcingCases.vehicleId} is null`,
          notInArray(sourcingCases.stage, closedStages),
        ),
      );
    for (const row of open) await attachVehicle(client, row, actor.userId, vehicleId);
    return { vehicleId, organizationId };
  });
}

/** Brings the given open connections' blockers up to date with current evidence and contact
 * review, then summarizes the specialist's blocker records: open blockers on those connections
 * and how long resolved ones took, per kind and overall.
 * @throws {AppError} For revoked specialist access.
 */
export async function getBlockerMetrics(actor: Actor, openCaseIds: string[]) {
  const current = await requireGrowthActor(actor);
  // ponytail: one short transaction per open connection on each desk view, so contact reviews
  // made on the prospect page resolve here; move to growth's review write if the queue grows.
  for (const caseId of openCaseIds)
    await lockedTransaction(lockKey(caseId), async (client) =>
      syncBlockers(client, await requireSourcingCase(actor, caseId, client)),
    );
  const hours = sql`extract(epoch from ${connectionBlockers.resolvedAt} - ${connectionBlockers.openedAt}) / 3600`;
  const owned = and(
    eq(sourcingCases.ownerId, current.userId),
    eq(sourcingCases.id, connectionBlockers.caseId),
  );
  const kinds = await orm()
    .select({
      kind: connectionBlockers.kind,
      open: sql<number>`(count(*) filter (where ${and(isNull(connectionBlockers.resolvedAt), inArray(connectionBlockers.caseId, openCaseIds))}))::int`,
      resolved: sql<number>`count(${connectionBlockers.resolvedAt})::int`,
      averageHours: sql<number | null>`avg(${hours})::float`,
    })
    .from(connectionBlockers)
    .innerJoin(sourcingCases, owned)
    .groupBy(connectionBlockers.kind); // → per-kind counts and average hours
  const [overall] = await orm()
    .select({
      medianHours: sql<
        number | null
      >`(percentile_cont(0.5) within group (order by ${hours}))::float`,
    })
    .from(connectionBlockers)
    .innerJoin(sourcingCases, owned)
    .where(isNotNull(connectionBlockers.resolvedAt));
  await requireGrowthActor(actor);
  return { kinds, medianHours: overall?.medianHours ?? null };
}
