import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "cloudflare:workers";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { configureDatabase } from "../../src/server/db";

const owners = new AsyncLocalStorage<object>();

/** Runs work with database sockets owned by one Durable Object outside Flue's own objects. Workers
 * bind sockets to the object that opened them, so a pool must never cross objects.
 */
export function withDatabaseOwner<T>(owner: object, work: () => Promise<T>) {
  return owners.run(owner, work);
}

// Flue's agent objects carry their storage in Flue's context; other objects declare themselves.
configureDatabase({
  // Read when a pool opens: deployed Workers reject binding access at module scope.
  connectionString: () => env.HYPERDRIVE.connectionString,
  owner: () => owners.getStore() ?? getCloudflareContext().storage,
});
