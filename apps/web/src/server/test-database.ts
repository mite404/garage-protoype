import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

// Each ordered migration with a probe that returns a null name until it has been applied.
const migrations = [
  ["001-foundation.sql", "select to_regclass('signal_desk.identities') as name"],
  ["002-inference.sql", "select to_regclass('signal_desk.inference_models') as name"],
  ["003-evidence.sql", "select to_regclass('signal_desk.claims') as name"],
  ["004-photos.sql", "select to_regclass('signal_desk.photo_reviews') as name"],
  ["005-assistance.sql", "select to_regclass('signal_desk.inquiries') as name"],
  ["006-app-tokens.sql", "select to_regclass('signal_desk.app_tokens') as name"],
  ["007-streaming.sql", "select to_regclass('signal_desk.stream_turns') as name"],
  [
    "008-session-access.sql",
    "select to_regprocedure('signal_desk.session_is_active(uuid,uuid)') as name",
  ],
  ["009-municipality-workspace.sql", "select to_regclass('signal_desk.organizations') as name"],
] as const;

/** Initializes only a disposable *_test database, never a prototype or live database. */
export async function prepareTestDatabase(db: PoolClient) {
  const result = await db.query<{ name: string }>("select current_database() as name");
  if (!result.rows[0]?.name.endsWith("_test"))
    throw new Error("Tests require a disposable database ending in _test.");
  // Fixture accounting resets span transactions; hold until this test connection closes.
  await db.query("select pg_advisory_lock(73002)");
  await db.query("select pg_advisory_xact_lock(73001)");
  await db.query(`create schema if not exists auth;
    create table if not exists auth.sessions (id uuid primary key,user_id uuid not null,not_after timestamptz);
    alter table auth.sessions enable row level security;`);
  for (const [file, probe] of migrations) {
    const applied = await db.query<{ name: string | null }>(probe);
    if (!applied.rows[0]?.name)
      await db.query(await readFile(new URL(`../../../../db/${file}`, import.meta.url), "utf8"));
  }
}
