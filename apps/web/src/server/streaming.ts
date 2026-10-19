import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import {
  sourcingStreamView,
  streamView,
  type StreamActivity,
} from "@signal-desk/contracts/assistance-schema";
import { orm } from "./db";
import { wakeOwner } from "./owner";
import {
  chatTurns,
  credentialSchema,
  inferenceAttempts,
  inferenceOperations,
  inferenceModels,
  organizations,
  streamTurns,
} from "./db-schema";
import {
  type Actor,
  requireOpportunity,
  requireOpportunityAccess,
  requireSpending,
} from "./access";
import { beginChatTurn, getAssistance, getAssistanceRevision } from "./assistance";
import { AppError } from "./errors";
import { getMunicipalityWorkspace } from "./municipalities";
import { requireGrowthActor } from "./growth";
import {
  getSourcingAccount,
  requireSourcingCase,
  sourcingCards,
  sourcingRevision,
} from "./sourcing";

/** Reconstructs only the original credential and checks current permissions for recovered work.
 * @throws {AppError} For absent turns, ended credentials, or removed opportunity membership.
 */
export async function streamActor(id: string) {
  const row = await orm().query.streamTurns.findFirst({ where: eq(streamTurns.id, id) });
  if (!row) throw new AppError(404, "NOT_FOUND", "Stream not found.");
  const original = {
    userId: row.actorId,
    credential: credentialSchema.parse(row.credential),
    role: "specialist" as const,
    canSpend: false,
  };
  if (row.sourcingCaseId) {
    const actor = await requireGrowthActor(original, undefined, true);
    await requireSourcingCase(actor, row.sourcingCaseId);
    return { actor, row };
  }
  const { actor } = await requireOpportunityAccess(
    original,
    row.opportunityId ?? "",
    ["opportunity", "write"],
    "specialist",
  );
  return { actor, row };
}

// The current review revision of a turn's subject; a change stops generation.
async function subjectRevision(actor: Actor, row: typeof streamTurns.$inferSelect) {
  return row.sourcingCaseId
    ? sourcingRevision(actor, row.sourcingCaseId)
    : getAssistanceRevision(actor, row.opportunityId ?? "");
}

// Runs independent reads concurrently but reports failures in argument order, so the error a
// caller sees is the one the sequential checks would have raised.
async function inOrder<T extends unknown[]>(work: [...{ [K in keyof T]: Promise<T[K]> }]) {
  const settled: PromiseSettledResult<unknown>[] = await Promise.allSettled(work);
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as T;
}

async function permittedDeal(actor: Actor, opportunityId: string) {
  const opportunity = await requireOpportunity(actor, opportunityId, "specialist");
  const [organization] = await orm()
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      opportunity.organization_id
        ? eq(organizations.id, opportunity.organization_id)
        : opportunity.buyer_id
          ? eq(organizations.buyerId, opportunity.buyer_id)
          : sql`false`,
    );
  const workspace = organization ? await getMunicipalityWorkspace(actor, organization.id) : null;
  return workspace
    ? {
        organization: workspace.organization,
        acquisition: workspace.acquisitions.find((item) => item.id === opportunityId),
      }
    : null;
}

async function historyBudget() {
  const [policy] = await orm()
    .select({ bytes: inferenceModels.max_input_bytes })
    .from(inferenceModels)
    .where(eq(inferenceModels.id, "moonshotai/kimi-k3"));
  // Leave admission room for current evidence, tools, user text and subsequent tool results.
  return Math.min(8000, Math.floor((policy?.bytes ?? 0) / 8));
}

async function priorTurns(actor: Actor, row: typeof streamTurns.$inferSelect) {
  return orm()
    .select({
      message: sql<string>`left(${streamTurns.message},2000)`,
      assistant: sql<string>`left(${streamTurns.text},2000)`,
      state: streamTurns.state,
    })
    .from(streamTurns)
    .where(
      and(
        eq(streamTurns.actorId, actor.userId),
        row.sourcingCaseId
          ? eq(streamTurns.sourcingCaseId, row.sourcingCaseId)
          : eq(streamTurns.opportunityId, row.opportunityId ?? ""),
        sql`(${streamTurns.createdAt},${streamTurns.id}) < (${row.createdAt},${row.id})`,
      ),
    )
    .orderBy(desc(streamTurns.createdAt), desc(streamTurns.id))
    .limit(6);
}

/** Supplies bounded chronological conversation, never historical tool authority or evidence.
 * Returns the checked turn row alongside the prompt context.
 * @throws {AppError} For stale evidence, ended credentials, or removed membership.
 */
export async function streamPrompt(id: string) {
  const { actor, row } = await streamContext(id);
  if (row.sourcingCaseId) return sourcingPrompt(actor, row);
  const opportunityId = row.opportunityId ?? "";
  // Independent reads run concurrently; nothing is returned until every check has passed.
  const [view, deal, budget, previous] = await inOrder([
    getAssistance(actor, opportunityId),
    permittedDeal(actor, opportunityId),
    historyBudget(),
    priorTurns(actor, row),
  ]);
  if (view.revision !== row.revision)
    throw new AppError(412, "STALE_REVIEW", "Evidence changed during generation.");
  await requireOpportunity(actor, opportunityId, "specialist");
  return {
    kind: "deal" as const,
    row,
    history: boundHistory(previous, budget),
    deal,
    inquiry: view.inquiries.find((item) => item.id === row.inquiryId),
    revision: row.revision,
  };
}

function boundHistory<T>(previous: T[], budget: number) {
  const history: T[] = [];
  for (const turn of previous) {
    if (Buffer.byteLength(JSON.stringify([turn, ...history]), "utf8") > budget) break;
    history.unshift(turn);
  }
  return history;
}

async function sourcingPrompt(actor: Actor, row: typeof streamTurns.$inferSelect) {
  const caseId = row.sourcingCaseId ?? "";
  const [view, budget, previous] = await inOrder([
    getSourcingAccount(actor, caseId),
    historyBudget(),
    priorTurns(actor, row),
  ]);
  if (view.revision !== row.revision)
    throw new AppError(412, "STALE_REVIEW", "This case changed during generation.");
  await requireSourcingCase(actor, caseId);
  return { kind: "sourcing" as const, row, history: boundHistory(previous, budget), view };
}

/** Admits one logical turn; repeating its key never queues another Flue submission.
 * @throws {AppError} For invalid input, missing permissions, or conflicting idempotency keys.
 */
export async function submitStream(
  actor: Actor,
  opportunityId: string,
  message: unknown,
  key: string,
) {
  // Every check must pass before the turn is created.
  await requireOpportunityAccess(
    actor,
    opportunityId,
    ["opportunity", "spend", "write"],
    "specialist",
  );
  const turn = await beginChatTurn(actor, opportunityId, message, key);
  const revision = await getAssistanceRevision(actor, opportunityId);
  await orm()
    .insert(streamTurns)
    .values({
      ...turn,
      opportunityId,
      actorId: actor.userId,
      credential: actor.credential,
      revision,
      state: "queued",
      text: "",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: streamTurns.id });
  await wakeOwner("kickTurn", turn.id);
  return turn;
}

/** Reads current authorized text and freshly resolved cards, never frozen tool output.
 * @throws {AppError} When access is no longer valid.
 */
export async function readStreams(actor: Actor, opportunityId: string) {
  await requireOpportunity(actor, opportunityId, "specialist");
  const rows = await orm()
    .select()
    .from(streamTurns)
    .where(and(eq(streamTurns.opportunityId, opportunityId), eq(streamTurns.actorId, actor.userId)))
    .orderBy(asc(streamTurns.createdAt));
  const assistance = await getAssistance(actor, opportunityId);
  await requireOpportunity(actor, opportunityId, "specialist");
  return rows.map((row) =>
    streamView.parse({
      ...row,
      cards:
        row.revision === assistance.revision
          ? (assistance.turns.find((turn) => turn.id === row.id)?.cards ?? [])
          : [],
    }),
  );
}

/** Records explicit cancellation. Disconnecting an observer never calls this operation.
 * @throws {AppError} For denied access or a turn owned by another specialist.
 */
export async function cancelStream(actor: Actor, opportunityId: string, id: string) {
  await requireOpportunityAccess(actor, opportunityId, ["opportunity", "write"], "specialist");
  const [row] = await orm()
    .select()
    .from(streamTurns)
    .where(
      and(
        eq(streamTurns.id, id),
        eq(streamTurns.actorId, actor.userId),
        eq(streamTurns.opportunityId, opportunityId),
      ),
    );
  if (!row) throw new AppError(404, "NOT_FOUND", "Stream not found.");
  await orm()
    .update(streamTurns)
    .set({ state: "cancelling" })
    .where(and(eq(streamTurns.id, id), inArray(streamTurns.state, ["queued", "running"])));
  await wakeOwner("cancelTurn", id);
}

// Turn IDs are UUID-shaped digests of the specialist's idempotency key, so a retry is one turn.
function sourcingTurnId(actor: Actor, caseId: string, key: string) {
  const hex = createHash("sha256")
    .update(`sourcing:${actor.userId}:${caseId}:${key}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Admits one sourcing-assistant turn; repeating its key never queues another submission.
 * @throws {AppError} For invalid input, missing spend or write permission, or a reused key.
 */
export async function submitSourcingStream(
  actor: Actor,
  caseId: string,
  raw: unknown,
  key: string,
) {
  const message = z.string().trim().min(1).max(2000).safeParse(raw);
  const requestKey = z.string().min(8).max(200).safeParse(key);
  if (!message.success || !requestKey.success)
    throw new AppError(422, "INVALID_INPUT", "Message is invalid.");
  // Every check must pass before the turn is created.
  await requireSpending(actor);
  const current = await requireGrowthActor(actor, undefined, true);
  await requireSourcingCase(current, caseId);
  const id = sourcingTurnId(current, caseId, requestKey.data);
  const revision = await sourcingRevision(current, caseId);
  // Cards and stream state hang off the shared chat turn, written together or not at all.
  await orm().transaction(async (tx) => {
    await tx
      .insert(chatTurns)
      .values({
        id,
        sourcing_case_id: caseId,
        actor_id: current.userId,
        request_key: `sourcing:${caseId}:${requestKey.data}`,
        message: message.data,
      })
      .onConflictDoNothing({ target: chatTurns.id });
    await tx
      .insert(streamTurns)
      .values({
        id,
        sourcingCaseId: caseId,
        actorId: current.userId,
        credential: current.credential,
        message: message.data,
        revision,
        state: "queued",
        text: "",
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: streamTurns.id });
  });
  const [row] = await orm().select().from(streamTurns).where(eq(streamTurns.id, id));
  if (row?.message !== message.data || row.sourcingCaseId !== caseId)
    throw new AppError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key was used for another message.",
    );
  await wakeOwner("kickTurn", id);
  return { id };
}

/** Reads the specialist's own sourcing turns with cards resolved against current records.
 * @throws {AppError} When access is no longer valid.
 */
export async function readSourcingStreams(actor: Actor, caseId: string) {
  await requireSourcingCase(actor, caseId);
  const rows = await orm()
    .select()
    .from(streamTurns)
    .where(and(eq(streamTurns.sourcingCaseId, caseId), eq(streamTurns.actorId, actor.userId)))
    .orderBy(asc(streamTurns.createdAt));
  const cards = await sourcingCards(rows.map((row) => row.id));
  await requireSourcingCase(actor, caseId);
  return rows.map((row) =>
    sourcingStreamView.parse({ ...row, inquiryId: caseId, cards: cards.get(row.id) ?? [] }),
  );
}

/** Records explicit cancellation of the specialist's own sourcing turn.
 * @throws {AppError} For denied access or a turn owned by another specialist.
 */
export async function cancelSourcingStream(actor: Actor, caseId: string, id: string) {
  await requireGrowthActor(actor, undefined, true);
  await requireSourcingCase(actor, caseId);
  const updated = await orm()
    .update(streamTurns)
    .set({ state: "cancelling" })
    .where(
      and(
        eq(streamTurns.id, id),
        eq(streamTurns.actorId, actor.userId),
        eq(streamTurns.sourcingCaseId, caseId),
        inArray(streamTurns.state, ["queued", "running"]),
      ),
    )
    .returning({ id: streamTurns.id });
  if (updated.length) await wakeOwner("cancelTurn", id);
}

/** Checks the revision again before each provider request or recovered protected tool.
 * @throws {AppError} For cancellation, stale evidence, access revocation, or unresolved spend.
 */
export async function streamContext(id: string) {
  const { actor, row } = await streamActor(id);
  if (!["queued", "running"].includes(row.state))
    throw new AppError(409, "STREAM_STOPPED", "Stream is no longer running.");
  if ((await subjectRevision(actor, row)) !== row.revision)
    throw new AppError(412, "STALE_REVIEW", "Evidence changed during generation.");
  const uncertain = await orm()
    .select({ id: inferenceAttempts.id })
    .from(inferenceAttempts)
    .innerJoin(inferenceOperations, eq(inferenceOperations.id, inferenceAttempts.operation_id))
    .where(
      and(
        eq(inferenceOperations.user_id, actor.userId),
        like(inferenceOperations.request_key, `flue:${id}:%`),
        isNull(inferenceAttempts.report),
      ),
    )
    .limit(1);
  if (uncertain.length)
    throw new AppError(409, "SPEND_UNCERTAIN", "Prior provider request requires reconciliation.");
  return { actor, row };
}

const activityWrites = new Map<string, Promise<void>>();

/** Records the owner's current real step for observers without delaying that step. Writes apply
 * in call order per turn, only while it runs; a failed write never stops the turn.
 */
export function noteActivity(id: string, activity: StreamActivity) {
  const write = async () => {
    await orm()
      .update(streamTurns)
      .set({ activity })
      .where(and(eq(streamTurns.id, id), inArray(streamTurns.state, ["queued", "running"])));
  };
  const next = (activityWrites.get(id) ?? Promise.resolve()).then(write).catch(() => {});
  activityWrites.set(id, next);
  void next.then(() => {
    if (activityWrites.get(id) === next) activityWrites.delete(id);
  });
}

/** Strict boundary for persisted model-call failures exposed in the UI. */
export function streamError(error: unknown) {
  return error instanceof AppError ? error.code : "STREAM_INTERRUPTED";
}

/** Parses a bounded logical-turn reference at the HTTP boundary. */
export const streamId = z.string().uuid();
