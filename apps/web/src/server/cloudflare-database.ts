import { getCloudflareContext } from "@opennextjs/cloudflare";
import { configureDatabase } from "./db";

// Wrangler types are not generated for the OpenNext Worker, so the binding is declared here.
type Env = { HYPERDRIVE: { connectionString: string } };

/** Gives each Workers request its own Hyperdrive pool, since sockets cannot outlive a request. */
export function useCloudflareDatabase() {
  configureDatabase({
    connectionString: () =>
      (getCloudflareContext().env as unknown as Env).HYPERDRIVE.connectionString,
    owner: () => getCloudflareContext().ctx as object,
  });
}
