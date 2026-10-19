import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { analyzeGrowth } from "../agents/growth";
import { requireOpportunity, requireSession, type Actor } from "./access";
import { beginLocked, database, orm } from "./db";
import {
  credentialSchema,
  evidenceBlockers,
  growthEvents,
  growthMessages,
  growthSchedules,
} from "./db-schema";
import { AppError } from "./errors";
import { boundedBody } from "./evidence-http";
import { changeProspect, importDirectory, requireGrowthActor, requireProspect } from "./growth";
import { pollFeedbackForms } from "./growth-integrations";
import { dispatchMessage } from "./outreach";
import { parseInput } from "./validation";

const configuration = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory") }).strict(),
  z.object({ kind: z.literal("forms") }).strict(),
  z.object({ kind: z.literal("analysis"), accountId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("stalled"), accountId: z.string().min(1).max(200) }).strict(),
]);
const claimable = and(
  lte(growthSchedules.nextAt, sql`now()`),
  or(isNull(growthSchedules.leaseUntil), lte(growthSchedules.leaseUntil, sql`now()`)),
);

// RFC 4180 quoting, including doubled quotes and CRLF. The approved NY download is capped at 5 MB.
function csvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    switch (character) {
      case '"':
        if (quoted && csv[index + 1] === '"') {
          cell += '"';
          index++;
          break;
        }
        quoted = !quoted;
        break;
      case ",":
      case "\n":
        if (quoted) {
          cell += character;
          break;
        }
        row.push(cell.trim());
        cell = "";
        if (character === "\n") {
          rows.push(row);
          row = [];
        }
        break;
      default:
        cell += character;
    }
  }
  if (quoted) throw new AppError(422, "DIRECTORY_INVALID", "Unterminated CSV field.");
  rows.push([...row, cell.trim()]);
  return rows;
}

/** Normalizes the official USFA header without inventing contacts, signals or email consent.
 * @throws {AppError} For changed headers or oversized/malformed CSV.
 */
export function parseUsfaDirectory(csv: string) {
  if (Buffer.byteLength(csv) > 5000000)
    throw new AppError(
      413,
      "DIRECTORY_TOO_LARGE",
      "Directory exceeds the approved download bound.",
    );
  const [headers, ...records] = csvRows(csv.replace(/^\uFEFF/, ""));
  const names = ["FDID", "Fire dept name", "HQ city", "HQ state", "HQ zip"];
  if (!headers || names.some((name) => !headers.includes(name)))
    throw new AppError(
      422,
      "DIRECTORY_INVALID",
      "USFA header changed; review mapping before import.",
    );
  const rows = records
    .filter((row) => row[headers.indexOf("HQ state")] === "NY")
    .map((row) => {
      const get = (name: string) => row[headers.indexOf(name)] ?? "";
      if (!get("FDID"))
        throw new AppError(422, "DIRECTORY_INVALID", "USFA source identity is missing.");
      const website = z.url().safeParse(get("Website"));
      return {
        sourceId: `NY:${get("FDID")}`,
        name: get("Fire dept name"),
        city: get("HQ city"),
        state: "NY",
        postalCode: get("HQ zip"),
        ...(website.success ? { website: website.data } : {}),
      };
    });
  return {
    source: "usfa" as const,
    synthetic: false,
    snapshot: `usfa-ny:${createHash("sha256").update(csv).digest("hex")}`,
    rows,
  };
}

async function downloadNyDirectory() {
  const statesResponse = await fetch("https://apps.usfa.fema.gov/registry/api/lookups/states", {
    signal: AbortSignal.timeout(15000),
  });
  if (!statesResponse.ok)
    throw new AppError(503, "DIRECTORY_UNAVAILABLE", "USFA state lookup unavailable.");
  const states = z
    .array(z.object({ code: z.number().int(), shortDesc: z.string() }))
    .parse(await (await boundedBody(statesResponse, 100000)).json());
  const ny = states.find((state) => state.shortDesc === "NY");
  if (!ny) throw new AppError(422, "DIRECTORY_INVALID", "USFA NY identifier unavailable.");
  const response = await fetch(
    `https://apps.usfa.fema.gov/registry/api/download/state/${ny.code}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new AppError(503, "DIRECTORY_UNAVAILABLE", "USFA NY download unavailable.");
  return parseUsfaDirectory(await (await boundedBody(response, 5000000)).text());
}

/** Approves recurring work under the caller's current credentials, without enabling paid providers.
 * @throws {AppError} For invalid configuration, missing account access or noninteractive approval.
 */
export async function configureGrowthSchedule(actor: Actor, raw: unknown) {
  requireSession(actor);
  const config = parseInput(configuration, raw);
  await requireGrowthActor(actor, undefined, true);
  if ("accountId" in config) await requireProspect(actor, config.accountId);
  const id = createHash("sha256")
    .update(`${actor.userId}:${JSON.stringify(config)}`)
    .digest("hex");
  const client = await database().connect();
  try {
    await beginLocked(client, sql`select pg_advisory_xact_lock(76050)`);
    await requireGrowthActor(actor, client, true);
    if ("accountId" in config) await requireProspect(actor, config.accountId, client);
    await orm(client)
      .insert(growthSchedules)
      .values({ id, actorId: actor.userId, credential: actor.credential, configuration: config })
      .onConflictDoUpdate({
        target: growthSchedules.id,
        set: {
          credential: actor.credential,
          nextAt: new Date(),
          fence: sql`${growthSchedules.fence} + 1`,
        },
      });
    await requireGrowthActor(actor, client, true);
    await client.query("commit");
    return { id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function stalledTask(actor: Actor, id: string) {
  return changeProspect(actor, id, async (client, account) => {
    if (!account.opportunityId) return;
    await requireOpportunity(actor, account.opportunityId, "specialist", client);
    const [activity] = await orm(client)
      .select()
      .from(growthEvents)
      .where(
        and(
          eq(growthEvents.accountId, id),
          inArray(growthEvents.kind, [
            "qualified",
            "reply",
            "reviewed",
            "progressed",
            "intervention",
          ]),
        ),
      )
      .orderBy(desc(growthEvents.createdAt))
      .limit(1);
    if (!activity || Date.now() - activity.createdAt.getTime() < 7 * 86400000) return;
    await orm(client)
      .insert(evidenceBlockers)
      .values({
        id: `growth-stalled-${id}`,
        opportunity_id: account.opportunityId,
        blocker_key: `growth-stalled:${id}`,
        question: "No recorded deal progress for seven days",
        assignee_id: actor.userId,
        next_action: "Review the latest evidence and feedback, then choose a human follow-up.",
      })
      .onConflictDoNothing();
  });
}

async function claimScheduledWork() {
  const client = await database().connect();
  let jobs: (typeof growthSchedules.$inferSelect)[];
  try {
    await beginLocked(client, sql`select pg_advisory_xact_lock(76050)`);
    const due = await orm(client)
      .select()
      .from(growthSchedules)
      .where(claimable)
      .orderBy(asc(growthSchedules.nextAt), asc(growthSchedules.id))
      .limit(3)
      .for("update", { skipLocked: true });
    jobs = [];
    for (const job of due) {
      const [claimed] = await orm(client)
        .update(growthSchedules)
        .set({ leaseUntil: new Date(Date.now() + 300000), fence: job.fence + 1 })
        .where(eq(growthSchedules.id, job.id))
        .returning();
      if (claimed) jobs.push(claimed);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return jobs;
}

async function executeScheduledWork(job: typeof growthSchedules.$inferSelect) {
  const started = performance.now();
  let code = "completed",
    watermark = job.watermark;
  try {
    const actor: Actor = {
      userId: job.actorId,
      role: "specialist",
      canSpend: false,
      credential: credentialSchema.parse(job.credential),
    };
    await requireGrowthActor(actor, undefined, true);
    const config = configuration.parse(job.configuration);
    if (config.kind === "directory") await importDirectory(actor, await downloadNyDirectory());
    else if (config.kind === "forms") watermark = (await pollFeedbackForms(watermark)).watermark;
    else if (config.kind === "analysis") await analyzeGrowth(actor, config.accountId);
    else await stalledTask(actor, config.accountId);
  } catch (error) {
    code = error instanceof AppError ? error.code : "WORK_FAILED";
  }
  await orm()
    .update(growthSchedules)
    .set({
      leaseUntil: null,
      nextAt: new Date(Date.now() + 3600000),
      lastCode: code,
      durationMs: Math.round(performance.now() - started),
      watermark,
    })
    .where(and(eq(growthSchedules.id, job.id), eq(growthSchedules.fence, job.fence)));
}

async function dispatchDueMessage() {
  if (process.env.GROWTH_DELIVERY_MODE === "allowlisted-test") {
    const due = await orm()
      .select({ id: growthMessages.id })
      .from(growthMessages)
      .where(
        and(
          eq(growthMessages.state, "queued"),
          lte(growthMessages.dueAt, sql`now()`),
          sql`not exists (
          select 1 from signal_desk.growth_messages predecessor
          where predecessor.account_id = ${growthMessages.accountId}
            and predecessor.enrollment_key = ${growthMessages.enrollmentKey}
            and predecessor.step < ${growthMessages.step}
            and predecessor.state <> 'sent'
        )`,
        ),
      )
      .orderBy(asc(growthMessages.dueAt), asc(growthMessages.id))
      .limit(1);
    for (const message of due) {
      try {
        await dispatchMessage(message.id);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (
          [
            "UNAUTHENTICATED",
            "ACCESS_REVOKED",
            "NOT_FOUND",
            "FORBIDDEN",
            "RECIPIENT_DENIED",
          ].includes(error.code)
        )
          await orm()
            .update(growthMessages)
            .set({ state: "stopped" })
            .where(and(eq(growthMessages.id, message.id), eq(growthMessages.state, "queued")));
      }
    }
  }
}

/** Executes bounded scheduled work without a browser. Leases recover; business keys prevent replay.
 * Provider-disabled jobs retain an observable code rather than a simulated successful result.
 * @throws For database infrastructure failures; individual job errors are retained durably.
 */
export async function sweepGrowth() {
  const jobs = await claimScheduledWork();
  for (const job of jobs) await executeScheduledWork(job);
  await dispatchDueMessage();
  return { processed: jobs.length };
}
