import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { sessionDatabaseUrl } from "./server/db";
import { claimImport, processImport } from "./server/imports";

/** Runs one durable import worker. No live provider is installed by default.
 * @throws For a transaction-pooler URL, database configuration or connectivity failures; jobs survive process restart.
 */
export async function runWorker(
  signal: AbortSignal,
  provider?: Parameters<typeof processImport>[1],
) {
  sessionDatabaseUrl("The import worker");
  while (!signal.aborted) {
    const lease = await claimImport();
    if (lease) {
      try {
        await processImport(lease, provider);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "STALE_WORKER")
          throw error;
      }
    } else {
      await setTimeout(1000, undefined, { signal }).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  await runWorker(controller.signal);
}
