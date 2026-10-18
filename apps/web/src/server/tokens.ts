import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { beginLocked, database, orm } from "./db";
import { appTokens } from "./db-schema";
import { refreshActor, requireSession, type Actor } from "./access";
import { AppError } from "./errors";
import { parseInput } from "./validation";
import { tokenCommand, tokenView } from "@signal-desk/contracts/token-schema";

const projection = {
  id: appTokens.id,
  label: appTokens.label,
  scopes: appTokens.scopes,
  expiresAt: sql<string>`to_char(${appTokens.expires_at} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  revokedAt: sql<
    string | null
  >`to_char(${appTokens.revoked_at} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  createdAt: sql<string>`to_char(${appTokens.created_at} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

async function management<T>(actor: Actor, action: (db: PoolClient, current: Actor) => Promise<T>) {
  requireSession(actor);
  const db = await database().connect();
  try {
    await beginLocked(db, sql`select signal_desk.lock_token_management()`);
    const current = await refreshActor(actor, db);
    if (current.role !== "specialist")
      throw new AppError(403, "FORBIDDEN", "An invited specialist is required.");
    const result = await action(db, current);
    await orm(db).execute(sql`commit`);
    return result;
  } catch (error) {
    await orm(db).execute(sql`rollback`);
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
        await orm(db)
          .select(projection)
          .from(appTokens)
          .where(eq(appTokens.user_id, current.userId))
          .orderBy(desc(appTokens.created_at), appTokens.id),
      ),
  );
}

/** Issues an opaque 256-bit secret once. Only its SHA-256 hash is persisted.
 * @throws {AppError} For invalid expiry/scopes, ended sessions or unavailable spending rights.
 */
export async function issueToken(actor: Actor, raw: unknown) {
  const input = parseInput(tokenCommand, raw);
  return management(actor, async (db, current) => {
    if (input.scopes.includes("spend") && !current.canSpend)
      throw new AppError(403, "SPENDING_DENIED", "Spending permission is required.");
    const secret = `sd_${randomBytes(32).toString("base64url")}`;
    const result = await orm(db)
      .insert(appTokens)
      .values({
        id: randomUUID(),
        user_id: current.userId,
        label: input.label,
        scopes: input.scopes,
        expires_at: sql`${input.expiresAt}::timestamptz`,
        token_hash: createHash("sha256").update(secret).digest("hex"),
      })
      .returning(projection);
    return { ...tokenView.parse(result[0]), secret };
  });
}

/** Revokes only the current specialist's token; repeated revocation has the same result.
 * @throws {AppError} For inaccessible tokens or ended sessions.
 */
export function revokeToken(actor: Actor, rawId: string) {
  const id = parseInput(z.uuid(), rawId);
  return management(actor, async (db, current) => {
    const result = await orm(db)
      .update(appTokens)
      .set({ revoked_at: sql`coalesce(${appTokens.revoked_at},clock_timestamp())` })
      .where(and(eq(appTokens.id, id), eq(appTokens.user_id, current.userId)))
      .returning(projection);
    if (!result.length) throw new AppError(404, "NOT_FOUND", "Token not found.");
    return tokenView.parse(result[0]);
  });
}
