import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool, type PoolClient } from "pg";
import { migrateFlue } from "../apps/web/src/server/flue-storage";
import { legacyBaseline } from "../apps/web/src/server/migrations";

const migrationsFolder = new URL("../db/migrations", import.meta.url).pathname;
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");

// Files the legacy runner applied, listed only until Drizzle records its first migration here.
async function unadoptedLegacyNames(client: PoolClient) {
  const state = await client.query<{ adopt: boolean }>(`select
    to_regclass('public.signal_desk_migrations') is not null
    and not exists (select 1 from drizzle.__drizzle_migrations) as adopt`);
  if (!state.rows[0]?.adopt) return [];
  const applied = await client.query<{ name: string }>(
    "select name from public.signal_desk_migrations",
  );
  return applied.rows.map((row) => row.name);
}

// Records the legacy runner's applied files once, before Drizzle's first run on that database.
async function adoptLegacyHistory(client: PoolClient) {
  await client.query("begin");
  await client.query("create schema if not exists drizzle");
  await client.query(`create table if not exists drizzle.__drizzle_migrations
    (id serial primary key, hash text not null, created_at bigint)`);
  const migrations = readMigrationFiles({ migrationsFolder });
  for (const row of legacyBaseline(migrations, await unadoptedLegacyNames(client)))
    await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values ($1,$2)", [
      row.hash,
      row.createdAt,
    ]);
  await client.query("commit");
}

const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  // Serializes with other operator runs and with test fixtures that take the same key.
  await client.query("select pg_advisory_lock(73001)");
  await adoptLegacyHistory(client);
  await migrate(drizzle(client), { migrationsFolder });
  await migrateFlue(url);
  process.stdout.write("Migrations applied or already current.\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.query("select pg_advisory_unlock(73001)").catch(() => undefined);
  client.release();
  await pool.end();
}
