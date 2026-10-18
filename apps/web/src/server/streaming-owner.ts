import "server-only";
import { setTimeout } from "node:timers/promises";
import { eq, inArray, and } from "drizzle-orm";
import { init, instrument } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import type { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { orm, sessionDatabaseUrl } from "./db";
import { streamTurns } from "./db-schema";
import { flueStorage, lockStreamingOwner } from "./flue-storage";
import { admittedProvider } from "./streaming-provider";
import { executeTurn, reconcileTurn, salesInterceptor } from "./streaming-turn";
import { SpecialistStream } from "../agents/specialist";

/** Starts one PostgreSQL-backed Flue owner. Web processes only submit or observe database records.
 * @throws If storage is not migrated, another owner is active, or the database is unavailable.
 */
export async function startStreamingOwner(options: { transport?: typeof streamSimple } = {}) {
  const url = sessionDatabaseUrl("The streaming owner");
  const lease = await lockStreamingOwner();
  lease.client.on("error", () => {
    process.stderr.write("Streaming ownership connection lost; exiting.\n");
    process.exit(1);
  });
  const { adapter, pool } = flueStorage(url);
  const dispose = instrument({
    observe: () => {},
    dispose: () => {},
    interceptor: salesInterceptor,
  });
  let runtime;
  let stores: Awaited<ReturnType<typeof adapter.connect>>;
  try {
    stores = await adapter.connect();
    // Check paid results against canonical completions before Flue can resume any submission.
    const pending = await orm()
      .select({ id: streamTurns.id })
      .from(streamTurns)
      .where(inArray(streamTurns.state, ["queued", "running"]));
    for (const row of pending) await reconcileTurn(row.id, stores.conversationStreamStore);
    runtime = await start({
      agents: [SpecialistStream],
      providers: [admittedProvider(stores.conversationStreamStore, options.transport)],
      db: {
        ...adapter,
        connect: () => stores,
        migrate: async () => {
          await pool.query("select value from flue_meta where key='format_version'");
        },
      },
    });
  } catch (error) {
    await dispose();
    await adapter.close?.();
    await lease.close();
    throw error;
  }
  let stopped = false;
  const active = new Map<string, Promise<void>>();
  async function acknowledgeCancellation(id: string) {
    try {
      await init(SpecialistStream, { id }).abort();
      await active.get(id);
      const turn = await orm().query.streamTurns.findFirst({
        where: eq(streamTurns.id, id),
      });
      if (turn?.submissionId) {
        const submission = await stores.submissionStore.getSubmission(turn.submissionId);
        if (submission && submission.status !== "settled") return;
      }
    } catch {
      // Keep cancellation pending until the owner can confirm that execution has stopped.
      return;
    }
    await orm()
      .update(streamTurns)
      .set({ state: "cancelled" })
      .where(and(eq(streamTurns.id, id), eq(streamTurns.state, "cancelling")));
  }
  const loop = (async () => {
    while (!stopped) {
      const rows = await orm()
        .select({ id: streamTurns.id, state: streamTurns.state })
        .from(streamTurns)
        .where(inArray(streamTurns.state, ["queued", "running", "cancelling"]));
      for (const row of rows) {
        if (row.state === "cancelling") {
          await acknowledgeCancellation(row.id);
        } else if (!active.has(row.id)) {
          const work = executeTurn(SpecialistStream, row.id).finally(() => {
            active.delete(row.id);
          });
          active.set(row.id, work);
        }
      }
      await setTimeout(150);
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await loop;
      for (const id of active.keys()) await init(SpecialistStream, { id }).abort();
      await Promise.all(active.values());
      await runtime.stop();
      await dispose();
      await lease.close();
    },
  };
}
