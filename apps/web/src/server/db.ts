import "server-only";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./db-schema";
import { AppError } from "./errors";

let pool: Pool | undefined;

/** Uses the caller's transaction when supplied; otherwise the server-only pool. */
export function database(): Pool;
/** Reuses an existing transaction without opening a second connection. */
export function database(client: PoolClient): PoolClient;
/** Selects a transaction client or the default pool. */
export function database(client: PoolClient | undefined): Pool | PoolClient;
export function database(client?: PoolClient) {
  if (client) return client;
  if (!process.env.DATABASE_URL)
    throw new AppError(503, "NOT_CONFIGURED", "Database is not configured.");
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
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
