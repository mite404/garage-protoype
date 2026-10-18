import "server-only";
import { Pool, type PoolClient } from "pg";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./db-schema";
import { AppError } from "./errors";

/** Supplies connections for a runtime whose sockets cannot be shared process-wide. */
export interface DatabaseRuntime {
  /** Resolves the URL when a pool opens, so runtimes can defer binding access past module scope.
   * @throws When the runtime has no database configured.
   */
  connectionString(): string;
  /** Returns the object that owns sockets for the current call; each owner gets one pool. */
  owner(): object;
}

// Node shares one pool across the process; Workers bind sockets to the Durable Object that opened
// them, so the worker installs a runtime keyed by object.
const processOwner = {};
const nodeRuntime: DatabaseRuntime = {
  connectionString() {
    if (!process.env.DATABASE_URL)
      throw new AppError(503, "NOT_CONFIGURED", "Database is not configured.");
    return process.env.DATABASE_URL;
  },
  owner: () => processOwner,
};
// Kept on globalThis because Next.js bundles instrumentation and routes with separate module copies.
const state = ((globalThis as { [key: symbol]: unknown })[Symbol.for("signal-desk.database")] ??= {
  runtime: nodeRuntime,
  pools: new WeakMap<object, Pool>(),
}) as { runtime: DatabaseRuntime; pools: WeakMap<object, Pool> };

/** Replaces where connections come from. Call once at startup, before any query. */
export function configureDatabase(next: DatabaseRuntime) {
  state.runtime = next;
}

function ownedPool() {
  const owner = state.runtime.owner(); // → object
  const existing = state.pools.get(owner); // → Pool | undefined
  if (existing) return existing;
  const pool = new Pool({ connectionString: state.runtime.connectionString(), max: 5 });
  state.pools.set(owner, pool);
  return pool;
}

/** Uses the caller's transaction when supplied; otherwise the current owner's pool. */
export function database(): Pool;
/** Reuses an existing transaction without opening a second connection. */
export function database(client: PoolClient): PoolClient;
/** Selects a transaction client or the default pool. */
export function database(client: PoolClient | undefined): Pool | PoolClient;
export function database(client?: PoolClient) {
  return client ?? ownedPool();
}

/** Returns a database URL safe for a long-lived process that holds session state, such as
 * advisory leases. Supabase's transaction pooler (port 6543) reassigns server connections between
 * transactions, so these processes must use the session pooler on the same host at port 5432.
 * @throws When DATABASE_URL is missing, malformed or targets port 6543.
 */
export function sessionDatabaseUrl(processName: string) {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error(`${processName} requires DATABASE_URL.`);
  if (new URL(raw).port === "6543")
    throw new Error(
      `${processName} cannot use the Supabase transaction pooler (port 6543). Use the session pooler: the same host on port 5432.`,
    );
  return raw;
}

/** Uses Drizzle's typed ORM over the existing pool or caller-owned transaction. */
export function orm(client?: PoolClient) {
  return drizzle(database(client), { schema });
}

/** Begins a transaction that waits at most five seconds for locks, then takes the given
 * serialization lock before any access check reads state.
 */
export async function beginLocked(client: PoolClient, lock: SQL) {
  await orm(client).execute(sql`begin`);
  await orm(client).execute(sql`set local lock_timeout='5s'`);
  await orm(client).execute(lock);
}
