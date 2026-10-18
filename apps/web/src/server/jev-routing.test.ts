import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { Pool } from "pg";
import { z } from "zod";
import { resolveActor } from "./access";
import { acceptSuggestion, beginChatTurn, getAssistance, submitInquiry } from "./assistance";
import { decideSuggestion, suggestRoute } from "./jev-routing";
import { prepareTestDatabase } from "./test-database";
import { startTestApp } from "./test-app";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const user = "79000000-0000-4000-8000-000000000001";
const buyer = "79000000-0000-4000-8000-000000000002";
const session = "79000000-0000-4000-8000-000000000003";
const buyerSession = "79000000-0000-4000-8000-000000000004";
const modelVersion = "jev-1.13.0";
const question = { kind: "question", text: "How much water can it carry?" };

test("Jev threshold distinguishes fields from confident non-field choices", () => {
  assert.deepEqual(decideSuggestion({ choice: "tankCapacity", confidence: 0.79 }, modelVersion), {
    state: "needs_review",
    reason: "low_confidence",
    confidence: 0.79,
    modelVersion,
  });
  assert.deepEqual(decideSuggestion({ choice: "pumpCapacity", confidence: 0.8 }, modelVersion), {
    state: "suggested",
    field: "pumpCapacity",
    confidence: 0.8,
    modelVersion,
  });
  for (const reason of ["other", "multiple", "judgment"])
    assert.deepEqual(decideSuggestion({ choice: reason, confidence: 0.99 }, modelVersion), {
      state: "needs_review",
      reason,
      confidence: 0.99,
      modelVersion,
    });
});

test(
  "Jev SDK routing preserves human control, privacy, and spending",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const previous = {
      DATABASE_URL: process.env.DATABASE_URL,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
      TYPESAFE_BASE_URL: process.env.TYPESAFE_BASE_URL,
    };
    let requests = 0;
    let confidence = 0.98;
    let selected = "tankCapacity";
    let status = 200;
    let inputTokens: number | null = 101;
    const received: unknown[] = [];
    const fake = createServer(async (request, response) => {
      requests++;
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/systemone");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      received.push(
        JSON.parse(
          (request.headers["content-encoding"] === "zstd"
            ? zstdDecompressSync(body)
            : body
          ).toString(),
        ),
      );
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          status === 200
            ? {
                model: modelVersion,
                answers: {
                  field: {
                    type: "choice",
                    choice: selected,
                    confidence,
                    probabilities: { tankCapacity: confidence, other: 1 - confidence },
                  },
                },
                usage: { input_tokens: inputTokens, output_tokens: 134 },
              }
            : { error: "Controlled failure" },
        ),
      );
    }).listen(0, "127.0.0.1");
    await once(fake, "listening");
    const address = fake.address();
    assert.ok(address && typeof address === "object");
    process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.TYPESAFE_API_KEY = "synthetic-jev-test-key";
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',true)",
        [user, buyer],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)", [
        session,
        user,
        buyerSession,
        buyer,
      ]);
      await db.query(
        "insert into signal_desk.vehicles(id,title,published_at) values ('jev-truck','Synthetic Jev truck',now())",
      );
      await db.query(
        "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ('jev-deal','jev-truck',$1,$2)",
        [buyer, user],
      );
      await db.query("insert into signal_desk.opportunity_members values ('jev-deal',$1)", [user]);
      await db.query(`insert into signal_desk.inference_models
      (id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,rate_tokens,max_attempts,retry_ms,timeout_ms)
      values ('jev-1.13.0',4096,0,0,2048,512,42,0,1000,1,1000,5000)`);
      await db.query(
        "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',10000,10),($1,10000,10)",
        [user],
      );
      const actor = await resolveActor({ userId: user, sessionId: session });
      const buyerActor = await resolveActor({ userId: buyer, sessionId: buyerSession });
      await t.test(
        "suggestion stays human review and settles fractional pricing once",
        async () => {
          const inquiry = await submitInquiry(actor, "jev-deal", question, "high");
          assert.equal(inquiry.classification, "human_review");
          assert.equal(inquiry.history[0]?.field, null);
          assert.equal(inquiry.card.kind, "review");
          assert.ok(inquiry.card.kind === "review");
          assert.equal(inquiry.card.routingRevision, 0);
          assert.deepEqual(inquiry.card.suggestion, {
            state: "suggested",
            field: "tankCapacity",
            confidence: 0.98,
            modelVersion,
          });
          assert.equal(requests, 1);
          assert.deepEqual(z.object({ state: z.unknown() }).parse(received[0]).state, {
            specialist_question: question.text,
          });
          assert.deepEqual(
            (
              await db.query(
                "select spent_micro_usd::int as spent,reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
              )
            ).rows,
            [{ spent: 5, reserved: 0 }],
          );
          assert.deepEqual(
            (
              await db.query(
                "select state,rate_tokens from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
                [user],
              )
            ).rows,
            [{ state: "completed", rate_tokens: 1000 }],
          );
          assert.deepEqual(await submitInquiry(actor, "jev-deal", question, "high"), inquiry);
          assert.equal(requests, 1);
          await assert.rejects(acceptSuggestion(actor, "jev-deal", inquiry.id, 4), {
            status: 412,
            code: "STALE_REVIEW",
          });
          await assert.rejects(acceptSuggestion(buyerActor, "jev-deal", inquiry.id, 0), {
            status: 403,
          });
          assert.deepEqual(await acceptSuggestion(actor, "jev-deal", inquiry.id, 0), {
            id: inquiry.id,
            revision: 1,
          });
          const accepted = (await getAssistance(actor, "jev-deal")).inquiries.find(
            (q) => q.id === inquiry.id,
          );
          assert.equal(accepted?.history[0]?.field, "tankCapacity");
          assert.equal(
            accepted?.history[0]?.basis,
            "Specialist accepted Jev suggestion: Tank capacity (confidence 0.98, jev-1.13.0).",
          );
          assert.equal(accepted?.classification, "missing_evidence");
          assert.ok(accepted?.card.kind === "review");
          assert.equal(accepted.card.suggestion, undefined);
          await assert.rejects(acceptSuggestion(actor, "jev-deal", inquiry.id, 1), {
            status: 409,
            code: "REVIEW_REQUIRED",
          });
        },
      );
      await t.test("low confidence is review without a proposed field", async () => {
        confidence = 0.79;
        const inquiry = await submitInquiry(actor, "jev-deal", question, "low");
        assert.ok(inquiry.card.kind === "review");
        assert.deepEqual(inquiry.card.suggestion, {
          state: "needs_review",
          reason: "low_confidence",
          confidence: 0.79,
          modelVersion,
        });
        await assert.rejects(acceptSuggestion(actor, "jev-deal", inquiry.id, 0), { status: 409 });
        confidence = 0.98;
      });
      await t.test("an unknown choice falls back to human review", async () => {
        selected = "paintColour";
        const inquiry = await submitInquiry(actor, "jev-deal", question, "unknown-choice");
        assert.equal(inquiry.classification, "human_review");
        assert.ok(inquiry.card.kind === "review");
        assert.deepEqual(inquiry.card.suggestion, { state: "unavailable", code: "INVALID_OUTPUT" });
        selected = "tankCapacity";
      });
      await t.test("500 and unreported usage retain reservations without retrying", async () => {
        for (const failure of ["server", "usage"]) {
          status = failure === "server" ? 500 : 200;
          inputTokens = failure === "usage" ? null : 101;
          const before = requests;
          const inquiry = await submitInquiry(actor, "jev-deal", question, failure);
          assert.equal(inquiry.classification, "human_review");
          assert.ok(inquiry.card.kind === "review");
          assert.deepEqual(inquiry.card.suggestion, {
            state: "unavailable",
            code: "SPEND_UNCERTAIN",
          });
          assert.equal(requests, before + 1);
        }
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from signal_desk.inference_attempts where state='uncertain'",
            )
          ).rows[0].n,
          2,
        );
        assert.ok(
          (
            await db.query(
              "select reserved_micro_usd::int as reserved from signal_desk.inference_budgets where scope='installation'",
            )
          ).rows[0].reserved > 0,
        );
        status = 200;
        inputTokens = 101;
      });
      await t.test(
        "exact questions, buyers, revoked access and absent budgets never dispatch",
        async () => {
          const before = requests;
          await submitInquiry(
            actor,
            "jev-deal",
            { kind: "question", text: "What is the tank capacity?" },
            "exact",
          );
          const own = await submitInquiry(buyerActor, "jev-deal", question, "buyer");
          assert.equal("suggestion" in own, false);
          assert.equal("suggestion" in own.card, false);
          const projection = await getAssistance(buyerActor, "jev-deal");
          assert.ok(
            projection.inquiries.every((q) => !("suggestion" in q) && !("suggestion" in q.card)),
          );
          await db.query(
            "delete from signal_desk.opportunity_members where opportunity_id='jev-deal'",
          );
          assert.deepEqual(await suggestRoute(actor, "jev-deal", question.text, "revoked"), {
            state: "unavailable",
            code: "NOT_FOUND",
          });
          await db.query("insert into signal_desk.opportunity_members values ('jev-deal',$1)", [
            user,
          ]);
          await db.query("delete from signal_desk.inference_budgets where scope=$1", [user]);
          assert.deepEqual(await suggestRoute(actor, "jev-deal", question.text, "no-budget"), {
            state: "unavailable",
            code: "BUDGET_EXHAUSTED",
          });
          await db.query(
            "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ($1,10000,10)",
            [user],
          );
          delete process.env.TYPESAFE_API_KEY;
          assert.deepEqual(await suggestRoute(actor, "jev-deal", question.text, "no-key"), {
            state: "unavailable",
            code: "NOT_CONFIGURED",
          });
          process.env.TYPESAFE_API_KEY = "synthetic-jev-test-key";
          assert.equal(requests, before);
        },
      );
      await t.test("chat retries reuse the report and append one suggestion", async () => {
        const before = requests;
        const turn = await beginChatTurn(actor, "jev-deal", question.text, "chat");
        assert.deepEqual(await beginChatTurn(actor, "jev-deal", question.text, "chat"), turn);
        assert.equal(requests, before + 1);
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from signal_desk.inquiry_suggestions where inquiry_id=$1",
              [turn.inquiryId],
            )
          ).rows[0].n,
          1,
        );
      });
      await t.test(
        "rejected requests release their reservation and classify retryability",
        async () => {
          for (const code of [400, 408, 429]) {
            status = code;
            const before = requests;
            assert.deepEqual(
              await suggestRoute(actor, "jev-deal", question.text, `rejected-${code}`),
              { state: "unavailable", code: "PROVIDER_FAILED" },
            );
            assert.equal(requests, before + 1);
            const result = await db.query(
              "select a.report from signal_desk.inference_attempts a join signal_desk.inference_operations o on o.id=a.operation_id where o.request_key=$1 and o.user_id=$2",
              [`jev:rejected-${code}`, user],
            );
            assert.deepEqual(result.rows[0].report, {
              kind: "not-billed",
              retryable: code !== 400,
            });
          }
        },
      );
      await t.test("HTTP acceptance renders a specialist-only review control", async () => {
        status = 200;
        const app = await startTestApp(user, session);
        const path = `${app.origin}/api/v1/desk/opportunities/jev-deal/assistance`;
        const headers = {
          Cookie: app.cookie,
          Origin: "http://signal.test",
          "Content-Type": "application/json",
          "Idempotency-Key": "http-suggestion",
        };
        try {
          const response = await fetch(path, {
            method: "POST",
            headers,
            body: JSON.stringify({ kind: "inquiry", input: question }),
          });
          assert.equal(response.status, 200);
          const result = z
            .object({ data: z.object({ id: z.string() }) })
            .parse(await response.json());
          const html = await (
            await fetch(`${app.origin}/desk/opportunities/jev-deal`, { headers })
          ).text();
          assert.match(html, /Use suggested field/);
          assert.match(html, /Suggestion only\. Confirm before routing\./);
          const accepted = await fetch(path, {
            method: "POST",
            headers,
            body: JSON.stringify({
              kind: "accept_suggestion",
              inquiryId: result.data.id,
              revision: 0,
            }),
          });
          assert.equal(accepted.status, 200);
          assert.deepEqual(await accepted.json(), { data: { id: result.data.id, revision: 1 } });
        } finally {
          await app.stop();
        }
      });
    } finally {
      fake.closeAllConnections();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
      await db.query(
        "delete from signal_desk.inquiry_suggestions where inquiry_id in (select id from signal_desk.inquiries where opportunity_id='jev-deal')",
      );
      await db.query(
        "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
        [user],
      );
      await db.query("delete from signal_desk.inference_operations where user_id=$1", [user]);
      await db.query("delete from signal_desk.inference_denials where user_id=$1", [user]);
      await db.query(
        "delete from signal_desk.inference_budgets where scope in ('installation',$1)",
        [user],
      );
      await db.query("delete from signal_desk.inference_models where id='jev-1.13.0'");
      await db.query("delete from signal_desk.opportunity_members where opportunity_id='jev-deal'");
      await db.query("delete from signal_desk.opportunities where id='jev-deal'");
      await db.query("delete from signal_desk.vehicles where id='jev-truck'");
      await db.query("delete from auth.sessions where user_id in ($1,$2)", [user, buyer]);
      await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [user, buyer]);
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      db.release();
      await pool.end();
    }
  },
);
