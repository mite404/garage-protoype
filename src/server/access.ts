import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { database } from "./db";
import { AppError } from "./errors";

const roleSchema = z.enum(["buyer", "specialist"]);
const identitySchema = z.object({
  user_id: z.uuid(),
  role: roleSchema,
  can_spend: z.boolean(),
  revoked_at: z.date().nullable(),
});
const opportunitySchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  buyer_id: z.uuid(),
  internal_notes: z.string(),
  next_action: z.string(),
});

export type Role = z.infer<typeof roleSchema>;
export type SessionReference = { userId: string; sessionId: string };
export type Actor = {
  userId: string;
  role: Role;
  canSpend: boolean;
  credential: { kind: "supabase-session"; sessionId: string };
};

/** Resolves a previously verified Supabase session against current application access.
 * @throws {AppError} If the session is gone, expired, uninvited, or revoked.
 */
export async function resolveActor(
  reference: SessionReference,
  client?: PoolClient,
): Promise<Actor> {
  if (
    !z.uuid().safeParse(reference.userId).success ||
    !z.uuid().safeParse(reference.sessionId).success
  )
    throw new AppError(401, "UNAUTHENTICATED", "Sign in with an invited account.");
  const db = database(client);
  const session = await db.query(
    `select id from auth.sessions where id=$1 and user_id=$2
    and (not_after is null or not_after > now())`,
    [reference.sessionId, reference.userId],
  );
  if (!session.rowCount)
    throw new AppError(401, "UNAUTHENTICATED", "Session has expired or ended.");
  const result = await db.query(
    "select user_id,role,can_spend,revoked_at from signal_desk.identities where user_id=$1",
    [reference.userId],
  );
  const identity = identitySchema.nullable().parse(result.rows[0] ?? null);
  if (!identity || identity.revoked_at)
    throw new AppError(403, "ACCESS_REVOKED", "Application access is not available.");
  return {
    userId: identity.user_id,
    role: identity.role,
    canSpend: identity.can_spend,
    credential: { kind: "supabase-session", sessionId: reference.sessionId },
  };
}

/** Rechecks session and application permissions, including inside an admission transaction.
 * @throws {AppError} If access was revoked since the actor was created.
 */
export function refreshActor(actor: Actor, client?: PoolClient) {
  return resolveActor({ userId: actor.userId, sessionId: actor.credential.sessionId }, client);
}

/** Requires explicit spending permission. Budget admission remains a separate required gate.
 * @throws {AppError} If identity or spending access is no longer valid.
 */
export async function requireSpending(actor: Actor, client?: PoolClient) {
  const current = await refreshActor(actor, client);
  if (!current.canSpend)
    throw new AppError(403, "SPENDING_DENIED", "Spending permission is required.");
  return current;
}

/** Conceals inaccessible opportunities; specialists need explicit membership.
 * @throws {AppError} For revoked access, wrong role, or an inaccessible record.
 */
export async function requireOpportunity(
  actor: Actor,
  id: string,
  role?: Role,
  client?: PoolClient,
) {
  const current = await refreshActor(actor, client);
  if (role && current.role !== role)
    throw new AppError(403, "FORBIDDEN", "This action is not permitted.");
  const result = await database(client).query(
    `select o.id,o.vehicle_id,o.buyer_id,o.internal_notes,o.next_action
    from signal_desk.opportunities o where o.id=$1 and
    (($3='buyer' and o.buyer_id=$2) or ($3='specialist' and exists
      (select 1 from signal_desk.opportunity_members m where m.opportunity_id=o.id and m.user_id=$2)))`,
    [id, current.userId, current.role],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Record not found.");
  return opportunitySchema.parse(result.rows[0]);
}
