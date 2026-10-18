import "server-only";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { streamView, type StreamActivity } from "@signal-desk/contracts/assistance-schema";
import { orm } from "./db";
import {
  credentialSchema,
  inferenceAttempts,
  inferenceOperations,
  inferenceModels,
  organizations,
  streamTurns,
} from "./db-schema";
import { type Actor, requireOpportunity, requireOpportunityAccess } from "./access";
import { beginChatTurn, getAssistance, getAssistanceRevision } from "./assistance";
import { AppError } from "./errors";
import { getMunicipalityWorkspace } from "./municipalities";

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
  const { actor } = await requireOpportunityAccess(
    original,
    row.opportunityId,
    ["opportunity", "write"],
    "specialist",
  );
  return { actor, row };
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
    .where(eq(organizations.buyerId, opportunity.buyer_id));
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
        eq(streamTurns.opportunityId, row.opportunityId),
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
  // Independent reads run concurrently; nothing is returned until every check has passed.
  const [view, deal, budget, previous] = await inOrder([
    getAssistance(actor, row.opportunityId),
    permittedDeal(actor, row.opportunityId),
    historyBudget(),
    priorTurns(actor, row),
  ]);
  if (view.revision !== row.revision)
    throw new AppError(412, "STALE_REVIEW", "Evidence changed during generation.");
  const history: typeof previous = [];
  for (const turn of previous) {
    if (Buffer.byteLength(JSON.stringify([turn, ...history]), "utf8") > budget) break;
    history.unshift(turn);
  }
  await requireOpportunity(actor, row.opportunityId, "specialist");
  return {
    row,
    history,
    deal,
    inquiry: view.inquiries.find((item) => item.id === row.inquiryId),
    revision: row.revision,
  };
}

// Spike seam: wakes a Cloudflare turn driver when configured. Unset keeps the Node owner path.
// A lost wake is not lost work; the Worker's cron sweep re-reads queued and cancelling turns.
async function wakeStreamWorker(path: string) {
  const origin = process.env.STREAM_WORKER_URL;
  if (!origin) return;
  await fetch(new URL(path, origin), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.STREAM_WORKER_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
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
  await wakeStreamWorker(`/internal/turns/${turn.id}`);
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
  await wakeStreamWorker(`/internal/turns/${id}/cancel`);
}

/** Checks the revision again before each provider request or recovered protected tool.
 * @throws {AppError} For cancellation, stale evidence, access revocation, or unresolved spend.
 */
export async function streamContext(id: string) {
  const { actor, row } = await streamActor(id);
  if (!["queued", "running"].includes(row.state))
    throw new AppError(409, "STREAM_STOPPED", "Stream is no longer running.");
  if ((await getAssistanceRevision(actor, row.opportunityId)) !== row.revision)
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
