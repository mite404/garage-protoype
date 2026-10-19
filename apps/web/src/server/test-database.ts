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
  "0010_jev-routing": "select to_regclass('signal_desk.inquiry_suggestions') as name",
  "0011_jev-routing-policies":
    "select (select policyname from pg_policies where schemaname='signal_desk' and tablename='inquiry_suggestions' and policyname='server_insert') as name",
  "0012_derived-locators":
    "select (select column_name from information_schema.columns where table_schema='signal_desk' and table_name='import_jobs' and column_name='dropped_claims') as name",
  "0013_derived-locators-access":
    "select (select conname from pg_constraint where conname='import_jobs_dropped_claims_check') as name",
  "0014_growth-discovery": "select to_regclass('signal_desk.growth_accounts') as name",
  "0015_growth-access": "select to_regclass('signal_desk.growth_accounts_owner') as name",
  "0016_growth-outreach": "select to_regclass('signal_desk.growth_messages') as name",
  "0017_growth-outreach-access": "select to_regclass('signal_desk.growth_messages_due') as name",
  "0018_growth-account-deals":
    "select (select column_name from information_schema.columns where table_schema='signal_desk' and table_name='opportunities' and column_name='organization_id') as name",
  "0019_growth-deal-access": "select to_regclass('signal_desk.opportunities_organization') as name",
  "0020_growth-feedback": "select to_regclass('signal_desk.growth_feedback') as name",
  "0021_growth-feedback-access":
    "select to_regclass('signal_desk.growth_feedback_invitation') as name",
  "0022_growth-background": "select to_regclass('signal_desk.growth_insights') as name",
  "0023_growth-background-access":
    "select to_regclass('signal_desk.inference_operations_prospect') as name",
  "0024_growth-schedules": "select to_regclass('signal_desk.growth_schedules') as name",
  "0025_growth-schedule-access": "select to_regclass('signal_desk.growth_schedules_due') as name",
  "0026_sourcing-pairing": "select to_regclass('signal_desk.sourcing_cases') as name",
  "0027_sourcing-access": "select to_regclass('signal_desk.sourcing_cases_owner') as name",
  "0028_posthog-measurement": "select to_regclass('signal_desk.growth_telemetry') as name",
  "0029_posthog-access": "select to_regclass('signal_desk.growth_telemetry_pending') as name",
  "0030_buyer-seller-connections":
    "select (select column_name from information_schema.columns where table_schema='signal_desk' and table_name='sourcing_cases' and column_name='vehicle_id') as name",
  "0031_connection-stages": "select to_regclass('signal_desk.sourcing_cases_vehicle_sale') as name",
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
