import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

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
  const existing = await db.query("select to_regclass('signal_desk.identities') as name");
  if (!existing.rows[0]?.name)
    await db.query(await readFile(new URL("../../db/001-foundation.sql", import.meta.url), "utf8"));
  const inference = await db.query("select to_regclass('signal_desk.inference_models') as name");
  if (!inference.rows[0]?.name)
    await db.query(await readFile(new URL("../../db/002-inference.sql", import.meta.url), "utf8"));
  const evidence = await db.query("select to_regclass('signal_desk.claims') as name");
  if (!evidence.rows[0]?.name)
    await db.query(await readFile(new URL("../../db/003-evidence.sql", import.meta.url), "utf8"));
}
