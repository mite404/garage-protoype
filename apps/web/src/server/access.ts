import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { orm } from "./db";
import { appTokens } from "./db-schema";
import { AppError } from "./errors";

const roleSchema = z.enum(["buyer", "specialist"]);
const opportunitySchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  buyer_id: z.uuid(),
  internal_notes: z.string(),
  next_action: z.string(),
});

export type Role = z.infer<typeof roleSchema>;
export type SessionReference = { userId: string; sessionId: string };
export type Credential =
  | { kind: "supabase-session"; sessionId: string }
  | { kind: "app-token"; tokenId: string };
export type Actor = {
  userId: string;
  role: Role;
  canSpend: boolean;
  credential: Credential;
};

// One row answers every check: credential state, current identity, token scopes, and whether
// the opportunity is visible to this identity.
const accessRowSchema = z.object({
  active: z.boolean(),
  token_id: z.uuid().nullable(),
  scopes: z.array(z.enum(["read", "write", "spend"])).nullable(),
  user_id: z.uuid().nullable(),
  role: roleSchema.nullable(),
  can_spend: z.boolean().nullable(),
  revoked: z.boolean().nullable(),
  opportunity: opportunitySchema.nullable(),
});

export type AccessRow = z.infer<typeof accessRowSchema>;
type Opportunity = z.infer<typeof opportunitySchema>;
// Session revocation goes through the private runtime predicate (ADR-023); a token must be live.
type Grant = { credential: Credential; userId?: string };

/** An ordered permission check evaluated after the credential, in the caller's order. */
export type AccessCheck = "opportunity" | "spend" | "write";

function credentialSql({ credential, userId }: Grant) {
  if (credential.kind === "supabase-session")
    return sql`select signal_desk.session_is_active(${credential.sessionId}::uuid,${userId}::uuid) as active,
      ${userId}::uuid as user_id, null::uuid as token_id, null::text[] as scopes`;
  return sql`select t.id is not null as active, t.user_id, t.id as token_id, t.scopes
    from (select 1) as one
    left join signal_desk.app_tokens t on t.id=${credential.tokenId}::uuid
      and t.revoked_at is null and t.expires_at > clock_timestamp()`;
}

function accessSql(grant: Grant, opportunityId: string | null) {
  return sql`with credential as (${credentialSql(grant)})
    select c.active, c.token_id, c.scopes,
      i.user_id, i.role, i.can_spend, i.revoked_at is not null as revoked,
      case when o.id is null then null else json_build_object('id',o.id,'vehicle_id',o.vehicle_id,
        'buyer_id',o.buyer_id,'internal_notes',o.internal_notes,'next_action',o.next_action) end
        as opportunity
    from credential c
    left join signal_desk.identities i on i.user_id=c.user_id
    left join signal_desk.opportunities o on o.id=${opportunityId}::text and case i.role
      when 'buyer' then o.buyer_id=i.user_id
      else exists(select 1 from signal_desk.opportunity_members m
        where m.opportunity_id=o.id and m.user_id=i.user_id) end`;
}

function sessionActor(row: AccessRow, sessionId: string): Actor {
  if (!row.active) throw new AppError(401, "UNAUTHENTICATED", "Session has expired or ended.");
  if (row.revoked || !row.user_id || !row.role)
    throw new AppError(403, "ACCESS_REVOKED", "Application access is not available.");
  return {
    userId: row.user_id,
    role: row.role,
    canSpend: Boolean(row.can_spend),
    credential: { kind: "supabase-session", sessionId },
  };
}

function tokenActor(row: AccessRow): Actor {
  if (!row.active || !row.token_id || !row.user_id)
    throw new AppError(401, "UNAUTHENTICATED", "Application token has expired or ended.");
  if (row.revoked || row.role !== "specialist")
    throw new AppError(403, "ACCESS_REVOKED", "Specialist access is not available.");
  if (!row.scopes?.includes("read"))
    throw new AppError(403, "SCOPE_DENIED", "Read permission is required.");
  return {
    userId: row.user_id,
    role: row.role,
    canSpend: Boolean(row.can_spend) && row.scopes.includes("spend"),
    credential: { kind: "app-token", tokenId: row.token_id },
  };
}

const checks: Record<AccessCheck, (row: AccessRow, actor: Actor, role?: Role) => void> = {
  opportunity: (row, actor, role) => {
    if (role && actor.role !== role)
      throw new AppError(403, "FORBIDDEN", "This action is not permitted.");
    if (!row.opportunity) throw new AppError(404, "NOT_FOUND", "Record not found.");
  },
  spend: (_row, actor) => {
    if (!actor.canSpend)
      throw new AppError(403, "SPENDING_DENIED", "Spending permission is required.");
  },
  write: (row, actor) => {
    if (actor.credential.kind === "app-token" && !row.scopes?.includes("write"))
      throw new AppError(403, "SCOPE_DENIED", "Write permission is required.");
  },
};

/** Applies credential checks, then each requested check in order, to one access row, so error
 * codes match the sequential checks the single query replaced.
 * @throws {AppError} The first failed check's error.
 */
export function grantedAccess(
  row: AccessRow,
  credential: Credential,
  order: AccessCheck[],
  role?: Role,
) {
  const actor =
    credential.kind === "supabase-session"
      ? sessionActor(row, credential.sessionId)
      : tokenActor(row);
  for (const check of order) checks[check](row, actor, role);
  return { actor, opportunity: row.opportunity };
}

async function readAccess(grant: Grant, opportunityId: string | null, client?: PoolClient) {
  const result = await orm(client).execute(accessSql(grant, opportunityId));
  return accessRowSchema.parse(result.rows[0]);
}

/** Rechecks a durable token reference and current specialist permissions, never cached scopes.
 * @throws {AppError} For expired, revoked, unknown tokens or revoked specialist access.
 */
export async function resolveToken(tokenId: string, client?: PoolClient): Promise<Actor> {
  const credential: Credential = { kind: "app-token", tokenId };
  return grantedAccess(await readAccess({ credential }, null, client), credential, []).actor;
}

/** Hashes a presented secret before lookup; plaintext never reaches storage.
 * @throws {AppError} For malformed, unknown or inactive credentials.
 */
export async function authenticateToken(secret: string) {
  if (!/^sd_[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AppError(401, "UNAUTHENTICATED", "Application token is invalid.");
  const result = await orm()
    .select({ id: appTokens.id })
    .from(appTokens)
    .where(eq(appTokens.token_hash, createHash("sha256").update(secret).digest("hex")));
  if (!result.length) throw new AppError(401, "UNAUTHENTICATED", "Application token is invalid.");
  return resolveToken(z.object({ id: z.uuid() }).parse(result[0]).id);
}

/** Requires an interactive session for token management and human review.
 * @throws {AppError} For application-token credentials.
 */
export function requireSession(actor: Actor) {
  if (actor.credential.kind !== "supabase-session")
    throw new AppError(
      403,
      "HUMAN_SESSION_REQUIRED",
      "An interactive specialist session is required.",
    );
}

/** Checks explicit token write opt-in in shared operations, not only in transport tools.
 * @throws {AppError} For ended credentials or missing write scope.
 */
export async function requireWrite(actor: Actor, client?: PoolClient) {
  return (await checkAccess(actor, null, ["write"], undefined, client)).actor;
}

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
  const credential: Credential = { kind: "supabase-session", sessionId: reference.sessionId };
  const row = await readAccess({ credential, userId: reference.userId }, null, client);
  return grantedAccess(row, credential, []).actor;
}

// Validates a stored session reference before it reaches SQL, as initial resolution does.
function sessionReference(actor: Actor) {
  if (actor.credential.kind === "app-token") return;
  if (
    !z.uuid().safeParse(actor.userId).success ||
    !z.uuid().safeParse(actor.credential.sessionId).success
  )
    throw new AppError(401, "UNAUTHENTICATED", "Sign in with an invited account.");
}

async function checkAccess(
  actor: Actor,
  opportunityId: string | null,
  order: AccessCheck[],
  role?: Role,
  client?: PoolClient,
) {
  sessionReference(actor);
  const grant = { credential: actor.credential, userId: actor.userId };
  return grantedAccess(
    await readAccess(grant, opportunityId, client),
    actor.credential,
    order,
    role,
  );
}

/** Rechecks session and application permissions, including inside an admission transaction.
 * @throws {AppError} If access was revoked since the actor was created.
 */
export async function refreshActor(actor: Actor, client?: PoolClient) {
  return (await checkAccess(actor, null, [], undefined, client)).actor;
}

/** Requires explicit spending permission. Budget admission remains a separate required gate.
 * @throws {AppError} If identity or spending access is no longer valid.
 */
export async function requireSpending(actor: Actor, client?: PoolClient) {
  return (await checkAccess(actor, null, ["spend"], undefined, client)).actor;
}

/** Checks the credential, role, membership, and any spending or write permission in one query,
 * evaluated in `order` so each failure raises the same error as the equivalent separate checks.
 * Membership is checked last when `order` omits it. Specialists need explicit membership.
 * @throws {AppError} For revoked access, wrong role, missing permission, or an inaccessible record.
 */
export async function requireOpportunityAccess(
  actor: Actor,
  id: string,
  order: AccessCheck[],
  role?: Role,
  client?: PoolClient,
): Promise<{ actor: Actor; opportunity: Opportunity }> {
  const complete: AccessCheck[] = order.includes("opportunity") ? order : [...order, "opportunity"];
  const access = await checkAccess(actor, id, complete, role, client);
  return { actor: access.actor, opportunity: access.opportunity as Opportunity };
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
  return (await requireOpportunityAccess(actor, id, ["opportunity"], role, client)).opportunity;
}
