import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

// A query per Drizzle Kit journal entry that returns a null name until that migration applies.
const probes: Record<string, string> = {
  "0000_foundation": "select to_regclass('signal_desk.identities') as name",
  "0001_inference": "select to_regclass('signal_desk.inference_models') as name",
  "0002_evidence": "select to_regclass('signal_desk.claims') as name",
  "0003_photos": "select to_regclass('signal_desk.photo_reviews') as name",
  "0004_assistance": "select to_regclass('signal_desk.inquiries') as name",
  "0005_app-tokens": "select to_regclass('signal_desk.app_tokens') as name",
  "0006_streaming": "select to_regclass('signal_desk.stream_turns') as name",
  "0007_session-access":
    "select to_regprocedure('signal_desk.session_is_active(uuid,uuid)') as name",
  "0008_municipality-workspace": "select to_regclass('signal_desk.organizations') as name",
  "0009_stream-activity":
    "select (select column_name from information_schema.columns where table_schema='signal_desk' and table_name='stream_turns' and column_name='activity') as name",
};
const migrations = new URL("../../../../db/migrations/", import.meta.url);

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
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", migrations), "utf8"));
  for (const { tag } of journal.entries as { tag: string }[]) {
    const probe = probes[tag];
    if (!probe) throw new Error(`Add an applied-state probe for migration ${tag}.`);
    const applied = await db.query<{ name: string | null }>(probe);
    if (!applied.rows[0]?.name)
      await db.query(await readFile(new URL(`${tag}.sql`, migrations), "utf8"));
  }
}
