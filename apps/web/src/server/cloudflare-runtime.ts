import { getCloudflareContext } from "@opennextjs/cloudflare";
import { configureDatabase } from "./db";
import { configureOwner, type OwnerCommands } from "./owner";

// Wrangler types are not generated for the OpenNext Worker, so its bindings are declared here.
type Env = { HYPERDRIVE: { connectionString: string }; STREAM_OWNER: OwnerCommands };

// Bindings are request-scoped on Workers, so each call reads the current request's context.
const env = () => getCloudflareContext().env as unknown as Env;

/** Gives each Workers request its own Hyperdrive pool, since sockets cannot outlive a request,
 * and reaches the owner Worker through its service binding instead of a public URL.
 */
export function useCloudflareRuntime() {
  configureDatabase({
    connectionString: () => env().HYPERDRIVE.connectionString,
    owner: () => getCloudflareContext().ctx as object,
  });
  configureOwner({
    kickTurn: (id) => env().STREAM_OWNER.kickTurn(id),
    cancelTurn: (id) => env().STREAM_OWNER.cancelTurn(id),
  });
}
