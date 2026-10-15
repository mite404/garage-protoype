import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(73001)");
  await client.query(
    "create table if not exists public.signal_desk_migrations (name text primary key)",
  );
  await client.query("revoke all on public.signal_desk_migrations from public");
  const names = (await readdir(new URL("../db/", import.meta.url)))
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort();
  for (const name of names) {
    const applied = await client.query(
      "select name from public.signal_desk_migrations where name=$1",
      [name],
    );
    if (!applied.rowCount) {
      await client.query(await readFile(new URL("../db/" + name, import.meta.url), "utf8"));
      await client.query("insert into public.signal_desk_migrations(name) values ($1)", [name]);
    }
  }
  await client.query("commit");
  process.stdout.write("Ordered migrations applied or already current.\n");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
