import "server-only";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { streamView } from "@signal-desk/contracts/assistance-schema";
import { orm } from "./db";
import {
  credentialSchema,
  inferenceAttempts,
  inferenceOperations,
  inferenceModels,
  organizations,
  streamTurns,
} from "./db-schema";
import {
  refreshActor,
  requireOpportunity,
  requireSpending,
  requireWrite,
  type Actor,
} from "./access";
import { beginChatTurn, getAssistance } from "./assistance";
import { getWorkbench } from "./evidence";
import { AppError } from "./errors";
import { getMunicipalityWorkspace } from "./municipalities";

/** Reconstructs only the original credential and checks current permissions for recovered work.
 * @throws {AppError} For absent turns, ended credentials, or removed opportunity membership.
 */
export async function streamActor(id: string) {
  const row = await orm().query.streamTurns.findFirst({ where: eq(streamTurns.id, id) });
  if (!row) throw new AppError(404, "NOT_FOUND", "Stream not found.");
  const actor = await refreshActor({
    userId: row.actorId,
    credential: credentialSchema.parse(row.credential),
    role: "specialist",
    canSpend: false,
  });
  await requireOpportunity(actor, row.opportunityId, "specialist");
  await requireWrite(actor);
  return { actor, row };
}

/** Supplies bounded chronological conversation, never historical tool authority or evidence.
 * @throws {AppError} For stale evidence, ended credentials, or removed membership.
 */
export async function streamPrompt(id: string) {
  const { actor, row, view } = await streamContext(id);
  const opportunity = await requireOpportunity(actor, row.opportunityId, "specialist");
  const [organization] = await orm()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.buyerId, opportunity.buyer_id));
  const workspace = organization ? await getMunicipalityWorkspace(actor, organization.id) : null;
  const deal = workspace
    ? {
        organization: workspace.organization,
        acquisition: workspace.acquisitions.find((item) => item.id === row.opportunityId),
      }
    : null;
  const [policy] = await orm()
    .select({ bytes: inferenceModels.max_input_bytes })
    .from(inferenceModels)
    .where(eq(inferenceModels.id, "moonshotai/kimi-k3"));
  // Leave admission room for current evidence, tools, user text and subsequent tool results.
  const budget = Math.min(8000, Math.floor((policy?.bytes ?? 0) / 8));
  const previous = await orm()
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
  const history: typeof previous = [];
  for (const turn of previous) {
    if (Buffer.byteLength(JSON.stringify([turn, ...history]), "utf8") > budget) break;
    history.unshift(turn);
  }
  await requireOpportunity(actor, row.opportunityId, "specialist");
  return {
    history,
    deal,
    inquiry: view.inquiries.find((item) => item.id === row.inquiryId),
    revision: row.revision,
  };
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
  await requireOpportunity(actor, opportunityId, "specialist");
  await requireSpending(actor);
  await requireWrite(actor);
  const turn = await beginChatTurn(actor, opportunityId, message, key);
  const evidence = await getWorkbench(actor, opportunityId);
  await orm()
    .insert(streamTurns)
    .values({
      ...turn,
      opportunityId,
      actorId: actor.userId,
      credential: actor.credential,
      revision: evidence.revision,
      state: "queued",
      text: "",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: streamTurns.id });
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
  await requireOpportunity(actor, opportunityId, "specialist");
  await requireWrite(actor);
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
}

/** Checks the revision again before each provider request or recovered protected tool.
 * @throws {AppError} For cancellation, stale evidence, access revocation, or unresolved spend.
 */
export async function streamContext(id: string) {
  const { actor, row } = await streamActor(id);
  if (!["queued", "running"].includes(row.state))
    throw new AppError(409, "STREAM_STOPPED", "Stream is no longer running.");
  const view = await getAssistance(actor, row.opportunityId);
  if (view.revision !== row.revision)
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
  return { actor, row, view };
}

/** Strict boundary for persisted model-call failures exposed in the UI. */
export function streamError(error: unknown) {
  return error instanceof AppError ? error.code : "STREAM_INTERRUPTED";
}

/** Parses a bounded logical-turn reference at the HTTP boundary. */
export const streamId = z.string().uuid();
