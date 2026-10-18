import { env } from "cloudflare:workers";
import { orm } from "../../src/server/db";
import { importJobs } from "../../src/server/db-schema";
import { claimableImports, runNextImport } from "../../src/server/imports";
import { withDatabaseOwner } from "./database";

/** One queued import; the job row stays the source of truth, so redelivery is harmless. */
export type ImportMessage = { jobId: string };

const retryDelaySeconds = 30;

/** Hands one job to the import queue. Safe to repeat: only one consumer can claim it. */
export async function enqueueImport(jobId: string) {
  await env.IMPORTS.send({ jobId } satisfies ImportMessage);
}

/** Re-enqueues every claimable job, recovering lost wakes and consumers that died mid-lease. */
export async function sweepImports() {
  const rows = await orm().select({ id: importJobs.id }).from(importJobs).where(claimableImports);
  if (rows.length) await env.IMPORTS.sendBatch(rows.map((row) => ({ body: { jobId: row.id } })));
}

/** Runs each queued import with sockets owned by this invocation. Job failures are recorded on
 * the job by `processImport`; only infrastructure failures, such as a lost database, retry.
 */
export async function consumeImports(batch: MessageBatch<ImportMessage>) {
  await withDatabaseOwner(batch, async () => {
    for (const message of batch.messages) {
      try {
        // Same contract as the Node worker, including no installed live provider adapter.
        await runNextImport(message.body.jobId);
        message.ack();
      } catch (error) {
        console.error("import consumer failed", error);
        message.retry({ delaySeconds: retryDelaySeconds });
      }
    }
  });
}
