import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { test, mock } from "node:test";
import { Pool } from "pg";
import { prepareTestDatabase } from "./test-database";
import { database } from "./db";
import { resolveActor } from "./access";
import { importDirectory, getProspect, reviewProspect, routeProspect } from "./growth";
import { enrollSequence, dispatchMessage, readOutreach, reconcileMessage } from "./outreach";
import { receiveResendEvent } from "./growth-integrations";
import { configureGrowthSchedule, sweepGrowth } from "./growth-scheduler";
import { getGrowthOperations, recordGrowthOutcome } from "./growth-views";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const secret = `whsec_${Buffer.from("recovery-controlled-signature").toString("base64")}`;

function queryText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "text" in value) return String(value.text);
  return "";
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function pauseRead(matches: (text: string) => boolean, pooled = false) {
  const selected = barrier(),
    resume = barrier();
  let armed = true;
  const acquire = (client: Pool | import("pg").PoolClient) => {
    const query = client.query;
    mock.method(client, "query", async function (...args: unknown[]) {
      const result = await Reflect.apply(query, client, args);
      if (armed && matches(queryText(args[0]))) {
        armed = false;
        selected.release();
        await resume.promise;
      }
      return result;
    });
  };
  if (pooled) acquire(database());
  else database().on("acquire", acquire);
  return {
    selected: selected.promise,
    resume: resume.release,
    close() {
      resume.release();
      database().removeListener("acquire", acquire);
      mock.restoreAll();
    },
  };
}

async function bounce(providerId: string) {
  const id = `recovery:${providerId}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const raw = JSON.stringify({ type: "email.bounced", data: { email_id: providerId } });
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return receiveResendEvent(
    raw,
    new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
  );
}

test(
  "growth recovery preserves terminal decisions and does not strand due work",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const owner = randomUUID(),
      session = randomUUID(),
      nextSession = randomUUID(),
      other = randomUUID(),
      otherSession = randomUUID();
    const accountIds: string[] = [];
    await db.query(
      "insert into signal_desk.identities(user_id,role) values ($1,'specialist'),($2,'specialist')",
      [owner, other],
    );
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$2),($4,$5)", [
      session,
      owner,
      nextSession,
      otherSession,
      other,
    ]);
    const actor = await resolveActor({ userId: owner, sessionId: session });
    const otherActor = await resolveActor({ userId: other, sessionId: otherSession });
    async function account() {
      const sourceId = `recovery-${randomUUID()}`;
      await importDirectory(actor, {
        source: "usfa",
        snapshot: sourceId,
        synthetic: true,
        rows: [
          {
            sourceId,
            name: "Synthetic recovery department",
            city: "Albany",
            state: "NY",
            postalCode: "12207",
          },
        ],
      });
      const row = (
        await db.query("select id from signal_desk.growth_accounts where source_key=$1", [
          `usfa:${sourceId}`,
        ])
      ).rows[0];
      accountIds.push(row.id);
      await reviewProspect(actor, row.id, {
        name: "Reviewed recovery department",
        identity: "confirmed",
        fit: "fit",
        signal: {
          text: "Need pumper information",
          quote: "Need pumper",
          source: "Synthetic fixture",
          permission: "synthetic",
        },
        contact: {
          name: "Synthetic contact",
          email: `${row.id}@example.test`,
          permission: "allowlisted_test",
          provenance: "Synthetic permission fixture",
        },
      });
      return row.id as string;
    }
    const enroll = (id: string, key = randomUUID()) =>
      enrollSequence(actor, id, {
        key,
        subject: "Synthetic review",
        body: "Reply STOP to opt out.",
      });
    try {
      await t.test(
        "late provider failure cannot overwrite accepted human reconciliation",
        async () => {
          const id = await account(),
            message = await enroll(id);
          const entered = barrier(),
            fail = barrier();
          const dispatch = dispatchMessage(message.id, async () => {
            entered.release();
            await fail.promise;
            throw new Error("lost receipt");
          });
          const rejected = assert.rejects(dispatch, { code: "SEND_UNCERTAIN" });
          await entered.promise;
          await reconcileMessage(actor, id, {
            messageId: message.id,
            providerId: "recovery-reconciled",
            evidence: "Controlled provider receipt verified",
          });
          fail.release();
          await rejected;
          assert.equal(
            (await readOutreach(actor, id)).find((m) => m.id === message.id)!.state,
            "sent",
          );
        },
      );
      await t.test(
        "bounce before acceptance settlement or reconciliation stops follow-ups",
        async () => {
          for (const uncertain of [false, true]) {
            const id = await account(),
              message = await enroll(id),
              providerId = `recovery-early-${id}`;
            const dispatch = dispatchMessage(message.id, async () => {
              await bounce(providerId);
              if (uncertain) throw new Error("lost provider response");
              return { id: providerId };
            });
            if (uncertain) {
              await assert.rejects(dispatch, { code: "SEND_UNCERTAIN" });
              await reconcileMessage(actor, id, {
                messageId: message.id,
                providerId,
                evidence: "Controlled accepted receipt",
              });
            } else await dispatch;
            assert.equal(
              (await readOutreach(actor, id)).find((m) => m.step === 1)!.state,
              "stopped",
            );
            assert.equal((await bounce(providerId)).duplicate, true);
            await assert.rejects(enroll(id), { code: "SUPPRESSED" });
          }
        },
      );
      await t.test(
        "late acceptance retains failure correlation without resurrecting a stopped message",
        async () => {
          const id = await account(),
            message = await enroll(id);
          const entered = barrier(),
            accept = barrier();
          const providerId = `recovery-contradictory-${id}`;
          const dispatch = dispatchMessage(message.id, async () => {
            entered.release();
            await accept.promise;
            return { id: providerId };
          });
          await entered.promise;
          await reconcileMessage(actor, id, {
            messageId: message.id,
            providerId: null,
            evidence: "Controlled rejection evidence",
          });
          accept.release();
          await dispatch;
          const unrelated = await account(),
            uncertain = await enroll(unrelated);
          await assert.rejects(
            dispatchMessage(uncertain.id, async () => {
              throw new Error("Lost receipt");
            }),
            { code: "SEND_UNCERTAIN" },
          );
          await assert.rejects(
            reconcileMessage(actor, unrelated, {
              messageId: uncertain.id,
              providerId,
              evidence: "Mistakenly reused provider receipt",
            }),
            { code: "RECEIPT_CONFLICT" },
          );
          await bounce(providerId);
          assert.equal(
            (await readOutreach(actor, id)).find((m) => m.id === message.id)!.state,
            "stopped",
          );
          await assert.rejects(enroll(id), { code: "SUPPRESSED" });
          assert.equal(
            (await readOutreach(actor, unrelated)).find((m) => m.step === 1)!.state,
            "queued",
          );
        },
      );
      await t.test(
        "reconciliation cannot overwrite a receipt settled during its read",
        async () => {
          const id = await account(),
            message = await enroll(id);
          const entered = barrier(),
            accept = barrier();
          const dispatch = dispatchMessage(message.id, async () => {
            entered.release();
            await accept.promise;
            return { id: `recovery-winning-${id}` };
          });
          await entered.promise;
          const paused = pauseRead(
            (text) => text.startsWith("select") && text.includes('"growth_messages"'),
          );
          const reconciliation = reconcileMessage(actor, id, {
            messageId: message.id,
            providerId: null,
            evidence: "Stale controlled rejection evidence",
          });
          const rejected = assert.rejects(reconciliation, { code: "RECONCILIATION_REQUIRED" });
          try {
            await paused.selected;
            accept.release();
            await dispatch;
            paused.resume();
            await rejected;
          } finally {
            accept.release();
            paused.close();
          }
          assert.equal(
            (await readOutreach(actor, id)).find((m) => m.id === message.id)!.state,
            "sent",
          );
        },
      );
      await t.test("accepted reconciliation contributes once to sent accounts", async () => {
        const before = (await getGrowthOperations(actor)).counts.sent;
        const id = await account(),
          message = await enroll(id);
        await assert.rejects(
          dispatchMessage(message.id, async () => {
            throw new Error("Lost response");
          }),
          { code: "SEND_UNCERTAIN" },
        );
        await reconcileMessage(actor, id, {
          messageId: message.id,
          providerId: `recovery-counted-${id}`,
          evidence: "Controlled accepted receipt",
        });
        assert.equal((await getGrowthOperations(actor)).counts.sent, before + 1);
      });
      await t.test("operations fail closed when routing transfers a selected account", async () => {
        const id = await account();
        await db.query(
          "insert into signal_desk.growth_territories(id,postal_prefix,specialist_id) values ($1,'122',$2)",
          [other, other],
        );
        const paused = pauseRead(
          (text) =>
            text.startsWith("select") &&
            text.includes('"growth_accounts"') &&
            text.includes('"owner_id"'),
          true,
        );
        const operations = getGrowthOperations(actor);
        const rejected = assert.rejects(operations, { code: "NOT_FOUND" });
        try {
          await paused.selected;
          await routeProspect(actor, id);
          await recordGrowthOutcome(otherActor, id, {
            key: "new-owner-private",
            kind: "progressed",
            detail: "New owner private activity",
            evidence: "Synthetic fixture",
          });
          paused.resume();
          await rejected;
        } finally {
          paused.close();
          await db.query("delete from signal_desk.growth_territories where id=$1", [other]);
        }
      });
      await t.test(
        "blocked predecessor does not monopolize the scheduler and definitive rejection closes its sequence",
        async () => {
          const blocked = await account(),
            ready = await account();
          const first = await enroll(blocked),
            second = await enroll(ready);
          await assert.rejects(
            dispatchMessage(first.id, async () => {
              throw new Error("uncertain");
            }),
            { code: "SEND_UNCERTAIN" },
          );
          await db.query(
            "update signal_desk.growth_messages set due_at=now()-interval '1 day' where account_id=$1",
            [blocked],
          );
          Object.assign(process.env, {
            GROWTH_DELIVERY_MODE: "allowlisted-test",
            RESEND_API_KEY: "controlled",
            RESEND_FROM: "synthetic@example.test",
            RESEND_REPLY_DOMAIN: "example.test",
            GROWTH_TEST_ALLOWLIST: `${ready}@example.test`,
          });
          let requests = 0;
          const nativeFetch = globalThis.fetch;
          globalThis.fetch = async () => {
            requests++;
            return Response.json({ id: `recovery-scheduler-${second.id}` });
          };
          try {
            await sweepGrowth();
          } finally {
            globalThis.fetch = nativeFetch;
            delete process.env.GROWTH_DELIVERY_MODE;
          }
          assert.equal(requests, 1);
          assert.equal(
            (await readOutreach(actor, ready)).find((m) => m.id === second.id)!.state,
            "sent",
          );
          await reconcileMessage(actor, blocked, {
            messageId: first.id,
            providerId: null,
            evidence: "Provider definitively rejected the request",
          });
          assert.equal(
            (await readOutreach(actor, blocked)).find((m) => m.step === 1)!.state,
            "stopped",
          );
          await enroll(blocked);
        },
      );
      await t.test(
        "suppression and admission cannot cross after the suppression read",
        async () => {
          const id = await account();
          const first = await enroll(id);
          const providerId = `recovery-race-${id}`;
          await dispatchMessage(first.id, async () => ({ id: providerId }));
          await db.query(
            "update signal_desk.growth_messages set due_at=now() where account_id=$1",
            [id],
          );
          const next = (await readOutreach(actor, id)).find((m) => m.step === 1)!;
          const selected = barrier(),
            resume = barrier(),
            waiting = barrier();
          let armed = true,
            paused = false,
            suppressionCommitted = false,
            sentAfterSuppression = false;
          const acquire = (client: import("pg").PoolClient) => {
            const query = client.query;
            mock.method(client, "query", async function (...args: unknown[]) {
              const text = queryText(args[0]);
              const pending = Reflect.apply(query, client, args);
              if (paused && text.includes("76002")) waiting.release();
              const result = await pending;
              if (armed && text.startsWith("select") && text.includes('"growth_suppressions"')) {
                armed = false;
                paused = true;
                selected.release();
                await resume.promise;
              }
              return result;
            });
          };
          database().on("acquire", acquire);
          const dispatch = dispatchMessage(next.id, async () => {
            sentAfterSuppression = suppressionCommitted;
            return { id: `recovery-admitted-${id}` };
          });
          try {
            await selected.promise;
            const suppression = bounce(providerId).then(() => {
              suppressionCommitted = true;
            });
            await Promise.race([suppression, waiting.promise]);
            resume.release();
            await Promise.all([dispatch, suppression]);
          } finally {
            resume.release();
            database().removeListener("acquire", acquire);
            mock.restoreAll();
          }
          assert.equal(
            sentAfterSuppression,
            false,
            "Never send after suppression committed before admission",
          );
          await assert.rejects(enroll(id), { code: "SUPPRESSED" });
        },
      );
      await t.test("outcome keys reject conflicting reuse", async () => {
        const id = await account();
        const input = {
          key: "outcome-retry",
          kind: "intervention",
          detail: "Reviewed specification",
          evidence: "Synthetic note",
        };
        await recordGrowthOutcome(actor, id, input);
        await recordGrowthOutcome(actor, id, input);
        await assert.rejects(recordGrowthOutcome(actor, id, { ...input, kind: "progressed" }), {
          code: "IDEMPOTENCY_CONFLICT",
        });
      });
      await t.test(
        "sourcing contact does not require a buyer signal but retains identity and key validation",
        async () => {
          const id = await account(),
            original = (await getProspect(actor, id)).review!;
          await reviewProspect(actor, id, { ...original, fit: "not_fit", signal: null });
          await assert.rejects(enroll(id), { code: "REVIEW_REQUIRED" });
          const input = {
            purpose: "sourcing",
            key: `pairing:${randomUUID()}:1`,
            subject: "Reviewed seller inquiry",
            body: "Reply STOP to opt out.",
          };
          await assert.rejects(enrollSequence(actor, id, { ...input, key: "arbitrary" }), {
            code: "INVALID_INPUT",
          });
          const queued = await enrollSequence(actor, id, input);
          await dispatchMessage(queued.id, async () => ({ id: `recovery-sourcing-${id}` }));
          assert.equal((await getProspect(actor, id)).qualified, false);
        },
      );
      await t.test("directory refresh rechecks ownership after a concurrent route", async () => {
        const id = await account(),
          original = await getProspect(actor, id);
        await db.query(
          "insert into signal_desk.growth_territories(id,postal_prefix,specialist_id) values ($1,'122',$2)",
          [owner, other],
        );
        const selected = barrier(),
          resume = barrier();
        let armed = true;
        const acquire = (client: import("pg").PoolClient) => {
          const query = client.query;
          mock.method(client, "query", async function (...args: unknown[]) {
            const result = await Reflect.apply(query, client, args);
            const text = queryText(args[0]);
            if (
              armed &&
              text.includes('"growth_accounts"') &&
              text.includes('"source_key"') &&
              text.startsWith("select")
            ) {
              armed = false;
              selected.release();
              await resume.promise;
            }
            return result;
          });
        };
        database().on("acquire", acquire);
        const refresh = importDirectory(actor, {
          source: "usfa",
          snapshot: "concurrent-refresh",
          synthetic: true,
          rows: [
            {
              ...original.directory,
              name: "Must not overwrite a transferred account",
              postalCode: "10001",
            },
          ],
        });
        try {
          await selected.promise;
          await routeProspect(actor, id);
        } finally {
          resume.release();
        }
        try {
          await refresh;
        } finally {
          database().removeListener("acquire", acquire);
          mock.restoreAll();
        }
        assert.equal((await getProspect(otherActor, id)).directory.name, original.directory.name);
      });
      await t.test(
        "explicit schedule reapproval renews an expired session without resetting its watermark",
        async () => {
          const { id } = await configureGrowthSchedule(actor, { kind: "directory" });
          await db.query(
            "update signal_desk.growth_schedules set watermark='2026-10-01T00:00:00Z' where id=$1",
            [id],
          );
          await db.query("delete from auth.sessions where id=$1", [session]);
          const renewed = await resolveActor({ userId: owner, sessionId: nextSession });
          await configureGrowthSchedule(renewed, { kind: "directory" });
          const nativeFetch = globalThis.fetch;
          let requests = 0;
          globalThis.fetch = async () => {
            requests++;
            throw new Error("controlled unavailable directory");
          };
          try {
            await sweepGrowth();
          } finally {
            globalThis.fetch = nativeFetch;
          }
          assert.equal(requests, 1);
          const schedule = (await getGrowthOperations(renewed)).schedules.find((s) => s.id === id)!;
          assert.equal(schedule.lastCode, "WORK_FAILED");
          const cursor = (
            await db.query("select watermark from signal_desk.growth_schedules where id=$1", [id])
          ).rows[0];
          assert.equal(cursor.watermark.toISOString(), "2026-10-01T00:00:00.000Z");
        },
      );
    } finally {
      mock.restoreAll();
      await db.query(
        "delete from signal_desk.growth_receipts where id like 'recovery:%' or message_id in (select id from signal_desk.growth_messages where account_id=any($1))",
        [accountIds],
      );
      await db.query("delete from signal_desk.growth_schedules where actor_id=$1", [owner]);
      await db.query("delete from signal_desk.growth_events where account_id=any($1)", [
        accountIds,
      ]);
      await db.query("delete from signal_desk.growth_messages where account_id=any($1)", [
        accountIds,
      ]);
      await db.query("delete from signal_desk.growth_suppressions where email=any($1)", [
        accountIds.map((id) => `${id}@example.test`),
      ]);
      await db.query("delete from signal_desk.growth_observations where account_id=any($1)", [
        accountIds,
      ]);
      await db.query("delete from signal_desk.growth_accounts where id=any($1)", [accountIds]);
      await db.query("delete from signal_desk.growth_territories where id=$1", [owner]);
      await db.query("delete from auth.sessions where user_id=any($1)", [[owner, other]]);
      await db.query("delete from signal_desk.identities where user_id=any($1)", [[owner, other]]);
      for (const key of [
        "GROWTH_DELIVERY_MODE",
        "RESEND_API_KEY",
        "RESEND_WEBHOOK_SECRET",
        "RESEND_FROM",
        "RESEND_REPLY_DOMAIN",
        "GROWTH_TEST_ALLOWLIST",
      ])
        delete process.env[key];
      db.release();
      await pool.end();
    }
  },
);
