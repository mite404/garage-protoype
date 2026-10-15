import "server-only";
import { Pool, type PoolClient } from "pg";
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
