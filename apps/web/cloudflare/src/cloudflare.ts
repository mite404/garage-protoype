import { DurableObject, WorkerEntrypoint, env } from "cloudflare:workers";
import { eq, and, inArray } from "drizzle-orm";
import { init } from "@flue/runtime";
import { orm } from "../../src/server/db";
import { streamTurns } from "../../src/server/db-schema";
import { executeTurn } from "../../src/server/streaming-turn";
import { SpecialistStream } from "./agents/specialist";
import { withDatabaseOwner } from "./database";
import { consumeImports, enqueueImport, sweepImports, type ImportMessage } from "./imports";
import { sweepGrowth } from "../../src/server/growth-scheduler";
import { drainGrowthTelemetry } from "../../src/server/growth-measurement";

const cancelRetryMs = 500;
const settleWaitMs = 5000;

const turnState = async (id: string) =>
  (await orm().query.streamTurns.findFirst({ where: eq(streamTurns.id, id) }))?.state;
const turnSubmission = async (id: string) =>
  (await orm().query.streamTurns.findFirst({ where: eq(streamTurns.id, id) }))?.submissionId;
// Either outcome of the read means the submission settled; only silence means it may still run.
const settlesWithin = (read: Promise<unknown>, ms: number) =>
  Promise.race([
    read.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);

// The database is in AWS us-west-2. Flue's agent object is first contacted by this driver, so it
// is created near the driver too; neither object moves after creation.
function driver(turnId: string) {
  return env.TURN_DRIVER.get(env.TURN_DRIVER.idFromName(turnId), { locationHint: "wnam" });
}

/** Wakes the object that owns one logical turn. Safe to repeat: a running turn is not restarted. */
export async function kickTurn(turnId: string) {
  await driver(turnId).kick(turnId);
}

/** Asks the turn's object to stop it.
 * @returns Whether the stop is acknowledged; otherwise the object keeps retrying on its own.
 */
export async function cancelTurn(turnId: string) {
  return driver(turnId).cancel(turnId);
}

/** Replaces the Node owner's polling loop with one object per logical turn, woken by the web
 * app's submit and cancel kicks or the cron sweep, never by a browser observer.
 */
export class TurnDriver extends DurableObject<Env> {
  private active?: Promise<void>;

  /** Records the turn and schedules work now unless work is already scheduled. */
  async kick(turnId: string) {
    await this.ctx.storage.put("turnId", turnId);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  /** Aborts the turn and confirms that its submission settled, retrying in the background.
   * @returns Whether the cancellation is acknowledged now.
   */
  async cancel(turnId: string) {
    await this.ctx.storage.put("turnId", turnId);
    const done = await withDatabaseOwner(this, () => this.acknowledgeCancellation(turnId));
    if (!done) await this.retrySoon();
    return done;
  }

  /** Runs, resumes, or cancels the recorded turn according to its database state. */
  override async alarm() {
    const turnId = await this.ctx.storage.get<string>("turnId");
    if (turnId) await withDatabaseOwner(this, () => this.advance(turnId));
  }

  private async advance(turnId: string) {
    const state = await turnState(turnId); // → stream_turns.state | undefined
    if (state === "cancelling") await this.cancelOrRetry(turnId);
    else if (state === "queued" || state === "running") await this.run(turnId);
  }

  private async run(turnId: string) {
    if (await env.FLUE_SPECIALIST_STREAM_AGENT.getByName(turnId).reconcile(turnId)) return;
    this.active ??= executeTurn(SpecialistStream, turnId).finally(() => {
      this.active = undefined;
    });
    await this.active;
  }

  private async cancelOrRetry(turnId: string) {
    if (!(await this.acknowledgeCancellation(turnId))) await this.retrySoon();
  }

  private async retrySoon() {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + cancelRetryMs);
  }

  private async acknowledgeCancellation(id: string) {
    if (!(await this.stopped(id))) return false;
    await orm()
      .update(streamTurns)
      .set({ state: "cancelled" })
      .where(and(eq(streamTurns.id, id), eq(streamTurns.state, "cancelling")));
    return true;
  }

  // Keeps cancellation pending until the agent object confirms that execution has stopped.
  private async stopped(id: string) {
    try {
      const handle = init(SpecialistStream, { id });
      await handle.abort();
      await this.active;
      const submissionId = await turnSubmission(id); // → string | null | undefined
      // The submission store lives in the agent object; a settled read proves the stop.
      return !submissionId || (await settlesWithin(handle.read(submissionId), settleWaitMs));
    } catch {
      return false;
    }
  }
}

/** Recovers turns whose kick was lost and imports whose wake or consumer was lost. Runs in an
 * object, where CPU limits suit database work.
 */
export class TurnSweeper extends DurableObject<Env> {
  /** Wakes the driver of every unfinished turn and re-enqueues every claimable import. */
  async sweep() {
    await withDatabaseOwner(this, async () => {
      const rows = await orm()
        .select({ id: streamTurns.id })
        .from(streamTurns)
        .where(inArray(streamTurns.state, ["queued", "running", "cancelling"]));
      for (const row of rows) await kickTurn(row.id);
      await sweepImports();
      await sweepGrowth();
      await drainGrowthTelemetry();
    });
  }
}

/** The web Worker's service binding. It is unreachable from the internet, so it needs no token,
 * and like the HTTP adapter it never reads or returns conversation or source content.
 */
export class StreamOwner extends WorkerEntrypoint<Env> {
  /** Wakes the object that owns one logical turn. */
  async kickTurn(turnId: string) {
    await kickTurn(turnId);
  }

  /** Asks the turn's object to stop it.
   * @returns Whether the stop is acknowledged; otherwise the object keeps retrying on its own.
   */
  async cancelTurn(turnId: string) {
    return cancelTurn(turnId);
  }

  /** Hands one import job to the import queue. */
  async enqueueImport(jobId: string) {
    await enqueueImport(jobId);
  }
}

export default {
  async scheduled() {
    await env.TURN_SWEEPER.getByName("sweeper").sweep();
  },
  async queue(batch: MessageBatch<ImportMessage>) {
    await consumeImports(batch);
  },
} satisfies ExportedHandler<Env, ImportMessage>;
