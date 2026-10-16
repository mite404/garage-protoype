import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { database } from "./db";
import { refreshActor, requireSession, type Actor } from "./access";
import { AppError } from "./errors";
import { parseEvidence } from "./evidence";
import { tokenCommand, tokenView } from "./token-schema";

const projection = `id,label,scopes,to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "expiresAt",
  to_char(revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "revokedAt",
  to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"`;

async function management<T>(actor: Actor, action: (db: PoolClient, current: Actor) => Promise<T>) {
  requireSession(actor);
  const db = await database().connect();
  try {
    await db.query("begin");
    await db.query("set local lock_timeout='5s'");
    await db.query("select signal_desk.lock_token_management()");
    const current = await refreshActor(actor, db);
    if (current.role !== "specialist")
      throw new AppError(403, "FORBIDDEN", "An invited specialist is required.");
    const result = await action(db, current);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

/** Lists the interactive specialist's tokens without secrets or hashes.
 * @throws {AppError} For ended sessions or non-specialists.
 */
export function listTokens(actor: Actor) {
  return management(actor, async (db, current) =>
    z
      .array(tokenView)
      .parse(
        (
          await db.query(
            `select ${projection} from signal_desk.app_tokens where user_id=$1 order by created_at desc,id`,
            [current.userId],
          )
        ).rows,
      ),
  );
}

/** Issues an opaque 256-bit secret once. Only its SHA-256 hash is persisted.
 * @throws {AppError} For invalid expiry/scopes, ended sessions or unavailable spending rights.
 */
export async function issueToken(actor: Actor, raw: unknown) {
  const input = parseEvidence(tokenCommand, raw);
  return management(actor, async (db, current) => {
    if (input.scopes.includes("spend") && !current.canSpend)
      throw new AppError(403, "SPENDING_DENIED", "Spending permission is required.");
    const secret = `sd_${randomBytes(32).toString("base64url")}`;
    const result = await db.query(
      `insert into signal_desk.app_tokens(id,user_id,label,scopes,expires_at,token_hash) values ($1,$2,$3,$4,$5,$6) returning ${projection}`,
      [
        randomUUID(),
        current.userId,
        input.label,
        input.scopes,
        input.expiresAt,
        createHash("sha256").update(secret).digest("hex"),
      ],
    );
    return { ...tokenView.parse(result.rows[0]), secret };
  });
}

/** Revokes only the current specialist's token; repeated revocation has the same result.
 * @throws {AppError} For inaccessible tokens or ended sessions.
 */
export function revokeToken(actor: Actor, rawId: string) {
  const id = parseEvidence(z.uuid(), rawId);
  return management(actor, async (db, current) => {
    const result = await db.query(
      `update signal_desk.app_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1 and user_id=$2 returning ${projection}`,
      [id, current.userId],
    );
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Token not found.");
    return tokenView.parse(result.rows[0]);
  });
}
