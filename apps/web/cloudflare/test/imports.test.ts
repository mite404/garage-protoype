import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { resolveActor } from "../../src/server/access";
import { loadSavedEvidence } from "../../src/server/imports";
import { prepareTestDatabase } from "../../src/server/test-database";
import { cloudflareRuntime } from "./runtime";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const user = "81000000-0000-4000-8000-000000000001";
const session = "81000000-0000-4000-8000-000000000002";
const buyer = "81000000-0000-4000-8000-000000000003";
const sweepPath = `/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}`;

test("the owner Worker's queue consumer runs imports exactly once", { skip: !url }, async (t) => {
  if (!url) return;
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  await db.query("begin");
  await prepareTestDatabase(db);
  await db.query("commit");
  await cloudflareRuntime.prepare(url);
  const runtime = new URL(url);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  process.env.DATABASE_URL = runtime.toString();
  await db.query(
    "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
    [user, buyer],
  );
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, user]);
  await db.query(
    "insert into signal_desk.vehicles(id,title,published_at) values ('queue-truck','Synthetic pumper',now())",
  );
  for (const deal of ["queue-woken", "queue-swept"]) {
    await db.query(
      "insert into signal_desk.opportunities(id,vehicle_id,buyer_id) values ($1,'queue-truck',$2)",
      [deal, buyer],
    );
    await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [deal, user]);
  }
  const actor = await resolveActor({ userId: user, sessionId: session });
  const job = async (id: string) =>
    (await db.query("select state, fence from signal_desk.import_jobs where id=$1", [id])).rows[0];
  const settled = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const row = await job(id);
      if (row.state === "ready" || row.state === "failed") return row;
      await setTimeout(200);
    }
    return job(id);
  };
  const owner = await cloudflareRuntime.start();
  try {
    const origin = process.env.STREAM_WORKER_URL!;
    await t.test("queueing an import wakes the consumer through the owner", async () => {
      const { id } = await loadSavedEvidence(actor, "queue-woken");
      assert.deepEqual(await settled(id), { state: "ready", fence: 1 });
      // A repeated wake or redelivery finds nothing claimable and leaves the job alone.
      const repeat = await fetch(`${origin}/internal/imports/${id}`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.STREAM_WORKER_TOKEN}` },
      });
      assert.equal(repeat.status, 202);
      await setTimeout(3000);
      assert.deepEqual(await job(id), { state: "ready", fence: 1 });
    });
    await t.test("the cron sweep recovers an import whose wake was lost", async () => {
      delete process.env.STREAM_WORKER_URL;
      const { id } = await loadSavedEvidence(actor, "queue-swept");
      process.env.STREAM_WORKER_URL = origin;
      await setTimeout(1000);
      assert.equal((await job(id)).state, "queued");
      assert.ok((await fetch(`${origin}${sweepPath}`)).ok);
      assert.deepEqual(await settled(id), { state: "ready", fence: 1 });
    });
  } finally {
    await owner.stop();
    db.release();
    await pool.end();
  }
});
