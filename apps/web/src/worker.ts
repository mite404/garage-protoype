import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { sessionDatabaseUrl } from "./server/db";
import { processImport, runNextImport } from "./server/imports";
import { sweepGrowth } from "./server/growth-scheduler";
import { drainGrowthTelemetry } from "./server/growth-measurement";

/** Runs one durable import worker. No live provider is installed by default.
 * @throws For a transaction-pooler URL, database configuration or connectivity failures; jobs survive process restart.
 */
export async function runWorker(
  signal: AbortSignal,
  provider?: Parameters<typeof processImport>[1],
) {
  sessionDatabaseUrl("The import worker");
  let nextGrowthSweep = 0;
  while (!signal.aborted) {
    if (Date.now() >= nextGrowthSweep) {
      await sweepGrowth();
      await drainGrowthTelemetry();
      nextGrowthSweep = Date.now() + 60000;
    }
    if (!(await runNextImport(undefined, provider))) {
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
