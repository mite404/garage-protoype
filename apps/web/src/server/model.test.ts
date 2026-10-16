import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveActor } from "./access";
import { prepareTestDatabase } from "./test-database";
import { runInference, reconcileInference } from "./model";
import { AppError } from "./errors";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const user = "74000000-0000-4000-8000-000000000001";
const other = "74000000-0000-4000-8000-000000000002";
const session = "74000000-0000-4000-8000-000000000003";
const otherSession = "74000000-0000-4000-8000-000000000004";
const request = {
  key: "one",
  opportunityId: "budget-deal",
  model: "controlled",
  input: "hello",
  photos: [],
};
const completed = {
  kind: "completed" as const,
  output: "supported answer",
  modelVersion: "controlled-v1",
  inputTokens: 3,
  outputTokens: 2,
  reviewOutcome: "needs_review" as const,
};

test(
  "PostgreSQL inference admission, retries, revocation, and recovery",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const previous = process.env.DATABASE_URL;
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    let prepared = false;
    try {
      await db.query("begin");
      await prepareTestDatabase(db);
      await db.query("commit");
      prepared = true;
      await db.query(
        `insert into signal_desk.identities(user_id,role,can_spend)
      values ($1,'buyer',true),($2,'buyer',true)`,
        [user, other],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)", [
        session,
        user,
        otherSession,
        other,
      ]);
      await db.query(
        "insert into signal_desk.vehicles(id,title) values ('budget-truck','Synthetic')",
      );
      await db.query(
        `insert into signal_desk.opportunities(id,vehicle_id,buyer_id)
      values ('budget-deal','budget-truck',$1),('budget-other','budget-truck',$2)`,
        [user, other],
      );
      const actor = await resolveActor({ userId: user, sessionId: session }, db);
      const actorB = await resolveActor({ userId: other, sessionId: otherSession }, db);
      const reset = async (installation = 1000, perUser = 1000, concurrency = 2) => {
        await db.query("delete from signal_desk.inference_denials");
        await db.query("delete from signal_desk.inference_attempts");
        await db.query("delete from signal_desk.inference_operations");
        await db.query("delete from signal_desk.inference_budgets");
        await db.query(
          `insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent)
        values ('installation',$1,$3),($4,$2,2),($5,$2,2)`,
          [installation, perUser, concurrency, user, other],
        );
        await db.query(
          `insert into signal_desk.inference_models
        (id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
        values ('controlled',10,1,5,0,4,2,3,2,10000,1000)
        on conflict(id) do update set enabled=true,timeout_ms=1000,overhead_tokens=0`,
          [],
        );
      };
      await t.test(
        "concurrent jobs cannot oversubscribe either budget or concurrency",
        async () => {
          for (const scope of ["installation", "user", "concurrency"]) {
            await reset(
              scope === "installation" ? 30 : 1000,
              scope === "user" ? 30 : 1000,
              scope === "concurrency" ? 1 : 2,
            );
            let calls = 0;
            let release = () => {};
            const hold = new Promise<void>((resolve) => {
              release = resolve;
            });
            const provider = async () => {
              calls++;
              await hold;
              return completed;
            };
            const a = runInference(actor, request, provider);
            const failed = a.catch((error: unknown) => {
              throw error;
            });
            // Wait until the first provider is inside the real reservation path.
            await Promise.race([
              failed,
              (async () => {
                for (let tries = 0; !calls && tries < 100; tries++)
                  await new Promise((resolve) => setTimeout(resolve, 5));
                assert.equal(calls, 1);
              })(),
            ]);
            const secondActor = scope === "user" ? actor : actorB;
            const b = runInference(
              secondActor,
              {
                ...request,
                key: "two",
                opportunityId: scope === "user" ? "budget-deal" : "budget-other",
              },
              provider,
            );
            await assert.rejects(b, {
              code: scope === "concurrency" ? "CONCURRENCY_LIMIT" : "BUDGET_EXHAUSTED",
            });
            assert.equal(calls, 1);
            release();
            assert.equal((await a).output, "supported answer");
            assert.deepEqual(
              (
                await db.query(
                  "select spent_micro_usd::int as spent,reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
                )
              ).rows,
              [{ spent: 12, reserved: 0 }],
            );
          }
        },
      );
      await t.test("simultaneous contenders reserve the last budget only once", async () => {
        await reset(22);
        let release = () => {};
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        let calls = 0;
        let denied = 0;
        const jobs = Array.from({ length: 12 }, (_, index) =>
          runInference(
            index % 2 ? actorB : actor,
            {
              ...request,
              key: String(index),
              opportunityId: index % 2 ? "budget-other" : "budget-deal",
            },
            async () => {
              calls++;
              await wait;
              return completed;
            },
          ).catch((error: unknown) => {
            denied++;
            return error;
          }),
        );
        try {
          for (let tries = 0; denied < 11 && tries < 100; tries++)
            await new Promise((resolve) => setTimeout(resolve, 5));
          assert.equal(calls, 1);
          assert.equal(denied, 11);
        } finally {
          release();
        }
        const results = await Promise.all(jobs);
        assert.equal(
          results.filter(
            (result) => result instanceof AppError && result.code === "BUDGET_EXHAUSTED",
          ).length,
          11,
        );
      });
      await t.test("denied inputs and unavailable providers never dispatch", async () => {
        await reset();
        let calls = 0;
        const provider = async () => {
          calls++;
          return completed;
        };
        await assert.rejects(runInference(actor, { ...request, input: "12345678901" }, provider), {
          status: 413,
        });
        await assert.rejects(runInference(actor, { ...request, photos: ["a", "b"] }, provider), {
          status: 413,
        });
        await assert.rejects(runInference(actor, { ...request, model: "unlisted" }, provider), {
          code: "NOT_CONFIGURED",
        });
        await assert.rejects(runInference(actor, request), { code: "NOT_CONFIGURED" });
        await assert.rejects(runInference(actorB, request, provider), { status: 404 });
        await db.query("update signal_desk.identities set can_spend=false where user_id=$1", [
          user,
        ]);
        await assert.rejects(runInference(actor, request, provider), { code: "SPENDING_DENIED" });
        assert.equal(
          (
            await db.query(
              "select count(*)::int as count from signal_desk.inference_denials where code='SPENDING_DENIED'",
            )
          ).rows[0].count,
          1,
        );
        await db.query("update signal_desk.identities set can_spend=true where user_id=$1", [user]);
        await db.query(
          "update signal_desk.identities set revoked_at=clock_timestamp() where user_id=$1",
          [user],
        );
        await assert.rejects(runInference(actor, request, provider), { code: "ACCESS_REVOKED" });
        await db.query("update signal_desk.identities set revoked_at=null where user_id=$1", [
          user,
        ]);
        await db.query(
          "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",
          [session],
        );
        await assert.rejects(runInference(actor, request, provider), { status: 401 });
        await db.query("update auth.sessions set not_after=null where id=$1", [session]);
        assert.equal(calls, 0);
      });
      await t.test(
        "photo and framing tokens contribute to the conservative reservation",
        async () => {
          await reset(33);
          await db.query("update signal_desk.inference_models set overhead_tokens=5");
          let calls = 0;
          const input = { ...request, input: "", photos: ["x"] };
          await assert.rejects(
            runInference(actor, input, async () => {
              calls++;
              return completed;
            }),
            { code: "BUDGET_EXHAUSTED" },
          );
          assert.equal(calls, 0);
          await db.query("update signal_desk.inference_budgets set limit_micro_usd=34");
          const result = await runInference(actor, input, async (bounded) => {
            assert.equal(bounded.maxInputTokens, 11);
            assert.equal(bounded.maxOutputTokens, 4);
            return completed;
          });
          assert.equal(result.output, "supported answer");
        },
      );
      await t.test("duplicates reuse results and changed payloads conflict", async () => {
        await reset();
        let calls = 0;
        const provider = async () => {
          calls++;
          return completed;
        };
        const first = await runInference(actor, request, provider);
        assert.deepEqual(await runInference(actor, request, provider), first);
        await assert.rejects(runInference(actor, { ...request, input: "other" }, provider), {
          code: "IDEMPOTENCY_CONFLICT",
        });
        assert.equal(calls, 1);
      });
      await t.test("retry attempts are separately accounted and bounded", async () => {
        await reset();
        let calls = 0;
        const provider = async () => {
          calls++;
          return { kind: "not-billed" as const, retryable: true };
        };
        await assert.rejects(runInference(actor, request, provider), { code: "PROVIDER_FAILED" });
        await assert.rejects(runInference(actor, request, provider), { code: "PROVIDER_FAILED" });
        assert.equal(calls, 1);
        await assert.rejects(runInference(actor, { ...request, attempt: 2 }, provider), {
          code: "RETRY_LATER",
        });
        await db.query(
          "update signal_desk.inference_attempts set retry_after=clock_timestamp()-interval '1 second'",
        );
        const retries = await Promise.allSettled([
          runInference(actor, { ...request, attempt: 2 }, provider),
          runInference(actor, { ...request, attempt: 2 }, provider),
        ]);
        for (const retry of retries) {
          assert.equal(retry.status, "rejected");
          if (retry.status === "rejected")
            assert.ok(["PROVIDER_FAILED", "SPEND_UNCERTAIN"].includes(retry.reason.code));
        }
        assert.ok(
          retries.some(
            (retry) => retry.status === "rejected" && retry.reason.code === "PROVIDER_FAILED",
          ),
        );
        await db.query(
          "update signal_desk.inference_attempts set retry_after=clock_timestamp()-interval '1 second'",
        );
        await assert.rejects(runInference(actor, { ...request, attempt: 3 }, provider), {
          code: "ATTEMPTS_EXHAUSTED",
        });
        assert.equal(calls, 2);
        assert.equal(
          (await db.query("select count(*)::int as count from signal_desk.inference_attempts"))
            .rows[0].count,
          2,
        );
      });
      await t.test(
        "billed failures retain usage separately and retries need new budget",
        async () => {
          await reset(30);
          let calls = 0;
          const provider = async () => {
            calls++;
            return {
              kind: "failed" as const,
              modelVersion: "controlled-v1",
              inputTokens: 3,
              outputTokens: 2,
              reviewOutcome: "rejected" as const,
              retryable: true,
            };
          };
          await assert.rejects(runInference(actor, request, provider), { code: "PROVIDER_FAILED" });
          await db.query(
            "update signal_desk.inference_attempts set retry_after=clock_timestamp()-interval '1 second'",
          );
          await assert.rejects(runInference(actor, { ...request, attempt: 2 }, provider), {
            code: "BUDGET_EXHAUSTED",
          });
          assert.equal(calls, 1);
          assert.deepEqual(
            (
              await db.query(
                "select spent_micro_usd::int as spent,reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows,
            [{ spent: 12, reserved: 0 }],
          );
          await db.query("update signal_desk.identities set can_spend=false where user_id=$1", [
            user,
          ]);
          await assert.rejects(runInference(actor, request, provider), { code: "SPENDING_DENIED" });
          await db.query("update signal_desk.identities set can_spend=true where user_id=$1", [
            user,
          ]);
        },
      );
      await t.test(
        "revocation commits ahead of blocked admission and prevents dispatch",
        async () => {
          await reset();
          await db.query("begin");
          await db.query("update signal_desk.identities set can_spend=false where user_id=$1", [
            user,
          ]);
          let calls = 0;
          const pending = runInference(actor, request, async () => {
            calls++;
            return completed;
          });
          const denied = assert.rejects(pending, { code: "SPENDING_DENIED" });
          await new Promise((resolve) => setTimeout(resolve, 25));
          assert.equal(calls, 0);
          await db.query("commit");
          await denied;
          await db.query("update signal_desk.identities set can_spend=true where user_id=$1", [
            user,
          ]);
        },
      );
      await t.test(
        "ambiguous dispatch retains spend and slots until operator reconciliation",
        async () => {
          await reset(1000, 1000, 1);
          let calls = 0;
          const provider = async () => {
            calls++;
            throw new Error("private provider detail");
          };
          await assert.rejects(runInference(actor, request, provider), { code: "SPEND_UNCERTAIN" });
          await assert.rejects(runInference(actor, request, provider), { code: "SPEND_UNCERTAIN" });
          await assert.rejects(
            runInference(actorB, { ...request, opportunityId: "budget-other" }, provider),
            { code: "CONCURRENCY_LIMIT" },
          );
          assert.equal(calls, 1);
          const attempt = (await db.query("select id from signal_desk.inference_attempts")).rows[0]
            .id;
          assert.equal(
            (
              await db.query(
                "select reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows[0].reserved,
            22,
          );
          await reconcileInference(attempt, completed, "operator-confirmed-provider-receipt", db);
          await reconcileInference(attempt, completed, "operator-confirmed-provider-receipt", db);
          assert.equal((await runInference(actor, request, provider)).output, "supported answer");
          assert.equal(
            (
              await db.query(
                "select spent_micro_usd::int as spent from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows[0].spent,
            12,
          );
        },
      );
      await t.test(
        "a killed worker cannot refund or redispatch its committed attempt",
        async () => {
          await reset();
          const child = spawn(
            process.execPath,
            [
              "--conditions=react-server",
              "--import",
              "tsx",
              "--input-type=module",
              "-e",
              `
        import {runInference} from './apps/web/src/server/model.ts';
        import {resolveActor} from './apps/web/src/server/access.ts';
        const actor=await resolveActor({userId:'${user}',sessionId:'${session}'});
        await runInference(actor,${JSON.stringify(request)},async()=>{
          process.stdout.write('dispatched');
          return new Promise(()=>{});
        });
      `,
            ],
            { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
          );
          try {
            await once(child.stdout, "data", { signal: AbortSignal.timeout(5000) });
            child.kill("SIGKILL");
            await once(child, "exit");
          } finally {
            if (child.exitCode === null) child.kill("SIGKILL");
          }
          const row = (await db.query("select id,state from signal_desk.inference_attempts"))
            .rows[0];
          assert.equal(row.state, "dispatched");
          await assert.rejects(
            runInference(actor, request, async () => completed),
            { code: "SPEND_UNCERTAIN" },
          );
          await db.query("set role signal_desk_runtime");
          await assert.rejects(db.query("update signal_desk.inference_models set enabled=true"), {
            code: "42501",
          });
          await assert.rejects(
            db.query("update signal_desk.inference_budgets set limit_micro_usd=1000"),
            { code: "42501" },
          );
          await assert.rejects(
            reconcileInference(row.id, { kind: "not-billed", retryable: true }, "verified", db),
            { status: 403 },
          );
          await db.query("reset role");
          await reconcileInference(
            row.id,
            { kind: "not-billed", retryable: true },
            "confirmed-not-billed",
            db,
          );
          assert.equal(
            (
              await db.query(
                "select reserved_micro_usd::int as reserved,active from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows[0].reserved,
            0,
          );
        },
      );
      await t.test("revoked access cannot retrieve a result, but usage still settles", async () => {
        await reset();
        try {
          await assert.rejects(
            runInference(actor, request, async () => {
              await db.query(
                "update signal_desk.identities set revoked_at=clock_timestamp() where user_id=$1",
                [user],
              );
              return completed;
            }),
            { code: "ACCESS_REVOKED" },
          );
          assert.equal(
            (
              await db.query(
                "select spent_micro_usd::int as spent from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows[0].spent,
            12,
          );
        } finally {
          await db.query("update signal_desk.identities set revoked_at=null where user_id=$1", [
            user,
          ]);
        }
      });
      await t.test(
        "reported overages stay uncertain until verified and block further spend",
        async () => {
          await reset(22);
          const overage = { ...completed, inputTokens: 100 };
          await assert.rejects(
            runInference(actor, request, async () => overage),
            { code: "SPEND_UNCERTAIN" },
          );
          const id = (await db.query("select id from signal_desk.inference_attempts")).rows[0].id;
          await reconcileInference(id, overage, "confirmed-billable-overage", db);
          await assert.rejects(reconcileInference(id, completed, "different-usage", db), {
            code: "SETTLEMENT_CONFLICT",
          });
          let calls = 0;
          await assert.rejects(
            runInference(actor, { ...request, key: "new" }, async () => {
              calls++;
              return completed;
            }),
            { code: "BUDGET_EXHAUSTED" },
          );
          assert.equal(calls, 0);
          assert.deepEqual(
            (
              await db.query(
                "select spent_micro_usd::int as spent,reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows,
            [{ spent: 206, reserved: 0 }],
          );
        },
      );
      await t.test("timeouts retain reservations even if the adapter later finishes", async () => {
        await reset();
        await db.query("update signal_desk.inference_models set timeout_ms=10");
        let finish = () => {};
        const wait = new Promise<void>((resolve) => {
          finish = resolve;
        });
        await assert.rejects(
          runInference(actor, request, async () => {
            await wait;
            return completed;
          }),
          { code: "SPEND_UNCERTAIN" },
        );
        finish();
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(
          (await db.query("select state from signal_desk.inference_attempts")).rows[0].state,
          "uncertain",
        );
        assert.equal(
          (
            await db.query(
              "select reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
            )
          ).rows[0].reserved,
          22,
        );
      });
    } finally {
      await db.query("rollback");
      await db.query("reset role");
      if (prepared) {
        await db.query("delete from signal_desk.inference_denials");
        await db.query("delete from signal_desk.inference_attempts");
        await db.query("delete from signal_desk.inference_operations");
        await db.query("delete from signal_desk.inference_budgets");
        await db.query("delete from signal_desk.inference_models");
        await db.query(
          "delete from signal_desk.opportunities where id in ('budget-deal','budget-other')",
        );
        await db.query("delete from signal_desk.vehicles where id='budget-truck'");
        await db.query("delete from auth.sessions where user_id in ($1,$2)", [user, other]);
        await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [
          user,
          other,
        ]);
      }
      db.release();
      await pool.end();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  },
);
