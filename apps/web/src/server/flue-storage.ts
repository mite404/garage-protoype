import "server-only";
import { Pool } from "pg";
import { postgres } from "@flue/postgres";
import { AppError } from "./errors";

/** Creates isolated private Flue storage. Its pool is not shared with application transactions. */
export function flueStorage(url: string) {
  const connection = new URL(url);
  connection.searchParams.set(
    "options",
    `${connection.searchParams.get("options") ?? ""} -c search_path=signal_desk_flue`,
  );
  const pool = new Pool({ connectionString: connection.toString(), max: 5 });
  const adapter = postgres({
    query: async (text, params) => (await pool.query(text, params)).rows,
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          query: async (text, params) => (await client.query(text, params)).rows,
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  });
  return { pool, adapter };
}

/** Installs the pinned framework tables with operator credentials, never from the owner process.
 * @throws If the private schema migration is absent or privileges are insufficient.
 */
export async function migrateFlue(url: string) {
  const { pool, adapter } = flueStorage(url);
  try {
    await adapter.migrate?.();
    const client = await pool.connect();
    try {
      await client.query(`do $$ declare t text; begin
        for t in select tablename from pg_tables where schemaname='signal_desk_flue' loop
          execute format('alter table signal_desk_flue.%I enable row level security',t);
          execute format('grant select,insert,update,delete on signal_desk_flue.%I to signal_desk_runtime',t);
          if not exists (select 1 from pg_policies where schemaname='signal_desk_flue' and tablename=t and policyname='server_access') then
            execute format('create policy server_access on signal_desk_flue.%I to signal_desk_runtime using (true) with check (true)',t);
          end if;
        end loop;
      end $$;
      grant usage,select on all sequences in schema signal_desk_flue to signal_desk_runtime;`);
    } finally {
      client.release();
    }
  } finally {
    await adapter.close?.();
  }
}

/** Acquires the singleton execution lease; a lost connection must stop the owner process.
 * @throws {AppError} If another owner holds the lock.
 */
export async function lockStreamingOwner() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const result = await client.query("select pg_try_advisory_lock(80001) as locked");
  if (!result.rows[0]?.locked) {
    client.release();
    await pool.end();
    throw new AppError(409, "OWNER_ACTIVE", "A streaming execution owner is already active.");
  }
  return {
    client,
    close: async () => {
      await client.query("select pg_advisory_unlock(80001)");
      client.release();
      await pool.end();
    },
  };
}
