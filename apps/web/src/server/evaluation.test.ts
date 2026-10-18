import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { prepareTestDatabase } from "./test-database";
import { startTestApp } from "./test-app";
import { resolveActor } from "./access";
import { addSource, getWorkbench, reviewEvidence } from "./evidence";
import { getPublicVehicle } from "./records";
import { claimImport, loadSavedEvidence, processImport, queueImport, retryImport } from "./imports";
import {
  getAssistance,
  createDraft,
  correctInquiry,
  beginChatTurn,
  renderCardCall,
} from "./assistance";
import { inlineCard, inquiryInput } from "@signal-desk/contracts/assistance-schema";
import { issueToken, revokeToken } from "./tokens";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const specialist = "79000000-0000-4000-8000-000000000001";
const buyer = "79000000-0000-4000-8000-000000000002";
const other = "79000000-0000-4000-8000-000000000003";
const session = "79000000-0000-4000-8000-000000000004";
const buyerSession = "79000000-0000-4000-8000-000000000005";
const opportunity = "evaluation-deal";
const vehicle = "evaluation-pumper";
const corpusBytes = await readFile(new URL("./evaluation-corpus.json", import.meta.url));
const corpusHash = createHash("sha256").update(corpusBytes).digest("hex");
const corpus = z
  .object({
    version: z.literal(1),
    cases: z
      .array(
        z.object({
          id: z.string(),
          split: z.enum(["dev", "heldout"]),
          stage: z.enum(["conflict", "reviewed", "response"]),
          input: inquiryInput,
          classification: z.string(),
          card: z.enum(["answer", "review", "handoff"]),
          value: z.string().optional(),
          excerpt: z.string().optional(),
        }),
      )
      .length(18),
  })
  .parse(JSON.parse(corpusBytes.toString()));
const inquiryResult = z.object({ id: z.string(), classification: z.string(), card: inlineCard });
type Row = {
  id: string;
  split: string;
  expected: string;
  observed: string;
  milliseconds: number;
  passed: boolean;
};
type Context = Awaited<ReturnType<typeof setup>>;

async function setup(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = await pool.connect();
  await db.query("begin");
  await prepareTestDatabase(db);
  await db.query("commit");
  const runtime = new URL(connectionString);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  process.env.DATABASE_URL = runtime.toString();
  await db.query(
    "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false),($3,'buyer',false)",
    [specialist, buyer, other],
  );
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)", [
    session,
    specialist,
    buyerSession,
    buyer,
  ]);
  await db.query(
    "insert into signal_desk.vehicles(id,title,published_at) values ($1,'Synthetic evaluation pumper',now())",
    [vehicle],
  );
  await db.query(
    "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ($1,$2,$3,$4),('evaluation-other',$2,$5,$4)",
    [opportunity, vehicle, buyer, specialist, other],
  );
  await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [
    opportunity,
    specialist,
  ]);
  const actor = await resolveActor({ userId: specialist, sessionId: session });
  const saved = await loadSavedEvidence(actor, opportunity);
  const lease = await claimImport(saved.id);
  assert.ok(lease);
  await processImport(lease);
  return { db, pool, actor, saved };
}

async function cleanup({ db, pool }: Context) {
  await db.query("delete from signal_desk.assistance_drafts where opportunity_id=$1", [
    opportunity,
  ]);
  await db.query("delete from signal_desk.inference_denials where user_id=$1", [specialist]);
  await db.query(
    "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
    [specialist],
  );
  await db.query("delete from signal_desk.inference_operations where user_id=$1", [specialist]);
  await db.query("delete from signal_desk.sources where opportunity_id=$1", [opportunity]);
  await db.query("delete from signal_desk.import_jobs where opportunity_id=$1", [opportunity]);
  await db.query("delete from signal_desk.opportunity_members where opportunity_id=$1", [
    opportunity,
  ]);
  await db.query(
    "delete from signal_desk.inquiry_suggestions where inquiry_id in (select id from signal_desk.inquiries where opportunity_id=$1)",
    [opportunity],
  );
  await db.query("delete from signal_desk.opportunities where vehicle_id=$1", [vehicle]);
  await db.query("delete from signal_desk.vehicles where id=$1", [vehicle]);
  await db.query("delete from signal_desk.inference_budgets where scope in ('installation',$1)", [
    specialist,
  ]);
  await db.query("delete from signal_desk.inference_models where id='evaluation-controlled'");
  await db.query("delete from signal_desk.app_tokens where user_id=$1", [specialist]);
  await db.query("delete from auth.sessions where user_id in ($1,$2,$3)", [
    specialist,
    buyer,
    other,
  ]);
  await db.query("delete from signal_desk.identities where user_id in ($1,$2,$3)", [
    specialist,
    buyer,
    other,
  ]);
  db.release();
  await pool.end();
}

async function review(
  ctx: Context,
  field: "tankCapacity" | "serviceRecords" | "pumpTest",
  value: string,
) {
  const view = await getWorkbench(ctx.actor, opportunity);
  const claim = view.claims.find((c) => c.field === field && c.value === value);
  assert.ok(claim);
  return reviewEvidence(ctx.actor, opportunity, view.revision, {
    kind: "select",
    field,
    claimId: claim.id,
    shareable: true,
  });
}

async function runCase(
  app: Awaited<ReturnType<typeof startTestApp>>,
  fixture: (typeof corpus.cases)[number],
  rows: Row[],
) {
  const start = performance.now();
  let observed = "request_failed";
  let passed = false;
  try {
    const response = await fetch(
      `${app.origin}/api/v1/buyer/vehicles/${vehicle}/inquiries?opportunityId=${opportunity}`,
      {
        method: "POST",
        headers: {
          Cookie: app.cookie,
          Origin: "http://signal.test",
          "Content-Type": "application/json",
          "Idempotency-Key": `evaluation-${fixture.id}`,
        },
        body: JSON.stringify(fixture.input),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = inquiryResult.parse((await response.json()).data);
    observed = result.classification;
    assert.equal(result.classification, fixture.classification);
    assert.equal(result.card.kind, fixture.card);
    if (result.card.kind === "answer") {
      assert.equal(result.card.value, fixture.value);
      assert.ok(result.card.citation.excerpt.endsWith(`: ${fixture.excerpt}`));
      assert.match(result.card.citation.excerpt, /^Page 1, characters \d+-\d+: /);
      if (result.card.field === "serviceRecords")
        assert.match(result.card.citation.sourceLabel, /^Seller-reported · /);
    }
    if (result.card.kind === "review") {
      assert.equal(result.card.assigneeId, specialist);
      assert.equal(
        result.card.state,
        fixture.classification === "missing_evidence" ? "unknown" : fixture.classification,
      );
    }
    if (result.card.kind === "handoff" && fixture.input.kind === "offer") {
      assert.equal(result.card.amountMinor, fixture.input.amountMinor);
      assert.equal(result.card.timingText, fixture.input.timingText);
      assert.deepEqual(result.card.conditions, fixture.input.conditions);
      assert.deepEqual(result.card.unansweredQuestions, fixture.input.unansweredQuestions);
      assert.equal(result.card.status, "recorded_not_accepted");
    }
    passed = true;
  } finally {
    rows.push({
      id: fixture.id,
      split: fixture.split,
      expected: fixture.classification,
      observed,
      milliseconds: performance.now() - start,
      passed,
    });
  }
}

async function sellerLoop(ctx: Context) {
  const availability = await addSource(ctx.actor, opportunity, {
    name: "Synthetic report availability note",
    kind: "seller_note",
    mediaType: "text/plain",
    content: Buffer.from("A pump-test report is available on request. No result supplied."),
    audience: "sales",
    shareable: true,
    permission: "synthetic",
    provenance: "ETH-79 original synthetic availability statement, not a test finding",
  });
  const view = await getAssistance(ctx.actor, opportunity);
  const pump = view.inquiries.find((q) => q.input.text === "What was the pump-test result?");
  assert.ok(pump && pump.card.kind === "review");
  const blockerId = pump.card.blockerId;
  const request = await createDraft(
    ctx.actor,
    opportunity,
    { kind: "seller_request", inquiryId: pump.id, revision: view.revision },
    "evaluation-seller-request",
  );
  assert.equal(request.status, "unsent");
  assert.match(request.body, /What was the pump-test result/);
  await assert.rejects(
    createDraft(
      ctx.actor,
      opportunity,
      { kind: "buyer_followup", inquiryId: pump.id, revision: view.revision },
      "early-followup",
    ),
    { code: "REVIEW_REQUIRED" },
  );
  const source = await addSource(ctx.actor, opportunity, {
    name: "Synthetic pump report",
    kind: "seller_response",
    mediaType: "text/plain",
    content: Buffer.from("Pump test: passed."),
    audience: "sales",
    shareable: true,
    permission: "synthetic",
    provenance: "ETH-79 synthetic controlled report, not an actual vehicle test",
    blockerId: pump.card.blockerId,
  });
  await ctx.db
    .query(`insert into signal_desk.inference_models(id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
    values ('evaluation-controlled',100000,0,0,100,1000,2,3,2,10,1000)`);
  await ctx.db.query(
    "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',1000000,2),($1,1000000,2)",
    [specialist],
  );
  const job = await queueImport(ctx.actor, opportunity, {
    sourceIds: [availability.id, source.id],
    model: "evaluation-controlled",
    key: "evaluation-response",
  });
  const lease = await claimImport(job.id);
  assert.ok(lease);
  await processImport(lease, async () => ({
    kind: "completed",
    modelVersion: "controlled-fixture-v1",
    inputTokens: 17,
    outputTokens: 23,
    reviewOutcome: "needs_review",
    output: JSON.stringify({
      claims: [
        {
          sourceId: source.id,
          field: "pumpTest",
          value: "passed",
          unit: "",
          page: 1,
          start: 0,
          end: 18,
          excerpt: "Pump test: passed.",
        },
      ],
      classifications: [
        {
          sourceId: availability.id,
          kind: "missing_evidence",
          basis: "Availability alone supplies no pump-test finding.",
          nextAction: "Review the separately supplied report before replying",
        },
        {
          sourceId: source.id,
          kind: "supported",
          basis: "Synthetic report explicitly states a result.",
          nextAction: "Review report before buyer disclosure",
        },
      ],
    }),
  }));
  const unreviewed = await getAssistance(ctx.actor, opportunity);
  assert.equal(unreviewed.inquiries.find((q) => q.id === pump.id)?.card.kind, "review");
  await review(ctx, "pumpTest", "passed");
  const current = await getAssistance(ctx.actor, opportunity);
  const followup = await createDraft(
    ctx.actor,
    opportunity,
    { kind: "buyer_followup", inquiryId: pump.id, revision: current.revision },
    "evaluation-followup",
  );
  assert.equal(followup.status, "unsent");
  assert.match(followup.body, /Pump test: passed/);
  assert.match(followup.body, /Other offer conditions and timing remain unresolved/);
  const workbench = await getWorkbench(ctx.actor, opportunity);
  assert.equal(workbench.blockers.find((b) => b.id === blockerId)?.state, "resolved");
  assert.equal(
    current.inquiries.find((q) => q.id === pump.id)?.input.text,
    "What was the pump-test result?",
  );
}

async function presentation(ctx: Context) {
  const turn = await beginChatTurn(
    ctx.actor,
    opportunity,
    "What is the tank capacity?",
    "evaluation-turn",
  );
  const call = (id: string, raw: unknown) =>
    renderCardCall(ctx.actor, opportunity, turn.id, id, raw);
  const valid = { tool: "answer", props: { inquiryId: turn.inquiryId } };
  const resolved = await call("valid", valid);
  assert.equal(resolved.status, "accepted");
  assert.ok(resolved.card?.kind === "answer");
  assert.equal(resolved.card.value, "750 gal");
  assert.equal(
    (await call("wrong-reference", { tool: "answer", props: { inquiryId: "not-an-inquiry" } }))
      .status,
    "unavailable",
  );
  const malformed = {
    tool: "answer",
    props: { inquiryId: turn.inquiryId, value: "9999 gal", html: "<b>verified</b>" },
  };
  assert.equal((await call("one", malformed)).status, "malformed");
  assert.equal((await call("one", malformed)).status, "malformed");
  assert.equal((await call("two", malformed)).status, "malformed");
  assert.equal((await call("retired", valid)).status, "retired");
  const next = await beginChatTurn(
    ctx.actor,
    opportunity,
    "What is the tank capacity?",
    "evaluation-next-turn",
  );
  assert.equal(
    (
      await renderCardCall(ctx.actor, opportunity, next.id, "reset", {
        tool: "answer",
        props: { inquiryId: next.inquiryId },
      })
    ).status,
    "accepted",
  );
  const wb = await getWorkbench(ctx.actor, opportunity);
  await reviewEvidence(ctx.actor, opportunity, wb.revision, {
    kind: "unknown",
    field: "tankCapacity",
    reason: "Synthetic withdrawal to test stale accepted-call replay",
  });
  assert.equal((await call("valid", valid)).card, null);
  assert.equal(
    (
      await renderCardCall(ctx.actor, opportunity, next.id, "review", {
        tool: "review",
        props: { inquiryId: next.inquiryId },
      })
    ).card?.kind,
    "review",
  );
  await review(ctx, "tankCapacity", "750");
}

async function parity(ctx: Context, app: Awaited<ReturnType<typeof startTestApp>>) {
  const token = await issueToken(ctx.actor, {
    label: "Synthetic evaluation",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const client = new Client({ name: "eth-79-evaluation", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "apps/web/src/mcp.ts"],
        env: {
          PATH: process.env.PATH ?? "",
          SIGNAL_DESK_URL: app.origin,
          SIGNAL_DESK_TOKEN: token.secret,
        },
      }),
    );
    const fromMcp = await client.callTool({
      name: "get_workbench",
      arguments: { opportunityId: opportunity },
    });
    assert.notEqual(fromMcp.isError, true);
    const content = z
      .object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1) })
      .parse(fromMcp);
    const fromHttp = await fetch(
      `${app.origin}/api/v1/desk/opportunities/${opportunity}/evidence`,
      { headers: { Cookie: app.cookie } },
    );
    assert.deepEqual(JSON.parse(content.content[0]!.text), await fromHttp.json());
    for (const id of ["evaluation-other", "does-not-exist"]) {
      const denied = await client.callTool({
        name: "get_assistance",
        arguments: { opportunityId: id },
      });
      assert.equal(denied.isError, true);
      assert.match(JSON.stringify(denied), /NOT_FOUND/);
    }
    const deniedWrite = await client.callTool({
      name: "create_draft",
      arguments: {
        opportunityId: opportunity,
        key: "readonly",
        input: {
          kind: "photo_request",
          revision: 0,
          recipientLabel: "Unverified seller",
          body: "Please provide evidence.",
        },
      },
    });
    assert.equal(deniedWrite.isError, true);
    assert.match(JSON.stringify(deniedWrite), /SCOPE_DENIED/);
    await revokeToken(ctx.actor, token.id);
    assert.equal(
      (await client.callTool({ name: "list_opportunities", arguments: {} })).isError,
      true,
    );
  } finally {
    await client.close();
  }
}

test("ETH-79 frozen corpus and connected real-stack acceptance", { skip: !url }, async (t) => {
  if (!url) return;
  const ctx = await setup(url);
  const rows: Row[] = [];
  const checks: { name: string; passed: boolean; milliseconds: number }[] = [];
  const check = async (name: string, run: () => Promise<void>) =>
    t.test(name, async () => {
      const start = performance.now();
      let passed = false;
      try {
        await run();
        passed = true;
      } finally {
        checks.push({ name, passed, milliseconds: performance.now() - start });
      }
    });
  let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
  let buyerApp: Awaited<ReturnType<typeof startTestApp>> | undefined;
  try {
    app = await startTestApp(specialist, session);
    buyerApp = await startTestApp(buyer, buyerSession);
    const runningBuyer = buyerApp;
    await check(
      "AE1 both conflicting originals persist without a public answer (saved synthetic)",
      async () => {
        const view = await getWorkbench(ctx.actor, opportunity);
        assert.deepEqual(
          view.claims
            .filter((c) => c.field === "tankCapacity")
            .map((c) => c.value)
            .sort(),
          ["500", "750"],
        );
        assert.equal(view.facts.find((f) => f.field === "tankCapacity")?.kind, "conflict");
        assert.equal((await getPublicVehicle(vehicle)).facts.length, 0);
        assert.equal(view.jobs[0]?.mode, "saved_example");
      },
    );
    for (const fixture of corpus.cases.filter((c) => c.stage === "conflict"))
      await check(fixture.id, () => runCase(runningBuyer, fixture, rows));
    await check(
      "AE2 seller availability remains seller-reported, not attached records",
      async () => {
        await review(ctx, "tankCapacity", "750");
        const view = await review(ctx, "serviceRecords", "available");
        const fact = view.facts.find((f) => f.field === "serviceRecords");
        assert.ok(fact?.kind === "reviewed");
        assert.equal(fact.sourceKind, "seller_note");
        assert.equal(
          view.sources.some((s) => /service record/i.test(s.name)),
          false,
        );
      },
    );
    for (const fixture of corpus.cases.filter((c) => c.stage === "reviewed"))
      await check(fixture.id, () => runCase(runningBuyer, fixture, rows));
    await check("AE5 repeat packet preserves correction and one opportunity", async () => {
      const before = await getWorkbench(ctx.actor, opportunity);
      assert.equal((await loadSavedEvidence(ctx.actor, opportunity)).id, ctx.saved.id);
      const after = await getWorkbench(ctx.actor, opportunity);
      assert.deepEqual(after.reviews, before.reviews);
      assert.equal(after.sources.length, 4);
      assert.equal(after.jobs.length, 1);
      assert.equal(
        (
          await ctx.db.query(
            "select count(*)::int as n from signal_desk.opportunities where id=$1",
            [opportunity],
          )
        ).rows[0].n,
        1,
      );
    });
    await check(
      "AE6 buyer and anonymous projections exclude private originals and specialist turns",
      async () => {
        await beginChatTurn(ctx.actor, opportunity, "INTERNAL PRICING CANARY", "private-turn");
        const response = await fetch(
          `${runningBuyer.origin}/api/v1/buyer/vehicles/${vehicle}/inquiries?opportunityId=${opportunity}`,
          { headers: { Cookie: runningBuyer.cookie } },
        );
        const text = await response.text();
        assert.equal(response.status, 200);
        assert.doesNotMatch(
          text,
          /INTERNAL PRICING CANARY|Internal pricing context|publish this note/,
        );
        assert.equal(
          (
            await fetch(
              `${runningBuyer.origin}/api/v1/buyer/vehicles/${vehicle}/inquiries?opportunityId=evaluation-other`,
              { headers: { Cookie: runningBuyer.cookie } },
            )
          ).status,
          404,
        );
        assert.doesNotMatch(
          JSON.stringify(await getPublicVehicle(vehicle)),
          /16500000|Internal pricing|Ignore all/,
        );
      },
    );
    await check(
      "AE7 request, controlled report import, human review and unsent cited follow-up",
      () => sellerLoop(ctx),
    );
    for (const fixture of corpus.cases.filter((c) => c.stage === "response"))
      await check(fixture.id, () => runCase(runningBuyer, fixture, rows));
    await check("AE8 ambiguous routing correction preserves input and original basis", async () => {
      const view = await getAssistance(ctx.actor, opportunity);
      const ambiguous = view.inquiries.find(
        (q) => q.input.text === "Maybe this could work for us?",
      );
      assert.ok(ambiguous);
      await correctInquiry(ctx.actor, opportunity, ambiguous.id, {
        field: null,
        reason: "Still no explicit offer or question",
        nextAction: "Ask buyer to clarify intent",
        revision: 0,
      });
      const corrected = (await getAssistance(ctx.actor, opportunity)).inquiries.find(
        (q) => q.id === ambiguous.id,
      );
      assert.equal(corrected?.input.text, "Maybe this could work for us?");
      assert.equal(corrected?.history.length, 2);
      assert.equal(corrected?.classification, "human_review");
    });
    await check(
      "strict tools resolve current evidence, retire one turn and reject fabricated values",
      () => presentation(ctx),
    );
    const running = app;
    await check("actual stdio MCP and HTTP parity, membership, read-only and revocation", () =>
      parity(ctx, running),
    );
    await check(
      "unconfigured arbitrary extraction fails durably and retries without saved substitution",
      async () => {
        const source = await addSource(ctx.actor, opportunity, {
          name: "Arbitrary synthetic note",
          kind: "seller_note",
          mediaType: "text/plain",
          content: Buffer.from("No additional findings supplied."),
          permission: "synthetic",
          provenance: "ETH-79 outage control",
          audience: "sales",
        });
        const job = await queueImport(ctx.actor, opportunity, {
          sourceIds: [source.id],
          model: "evaluation-controlled",
          key: "missing-adapter",
        });
        const lease = await claimImport(job.id);
        assert.ok(lease);
        await processImport(lease);
        assert.equal(
          (await getWorkbench(ctx.actor, opportunity)).jobs.find((j) => j.id === job.id)?.error,
          "NOT_CONFIGURED",
        );
        await retryImport(ctx.actor, job.id);
        assert.equal(
          (await getWorkbench(ctx.actor, opportunity)).jobs.find((j) => j.id === job.id)?.state,
          "queued",
        );
      },
    );
  } finally {
    await buyerApp?.stop();
    await app?.stop();
    const accounting = (
      await ctx.db.query(
        `select a.state,a.number,a.duration_ms,a.reserved_micro_usd,a.input_rate,a.output_rate,a.report->>'modelVersion' as model,
      a.report->>'inputTokens' as input_tokens,a.report->>'outputTokens' as output_tokens,a.report->>'reviewOutcome' as review_outcome
      from signal_desk.inference_attempts a join signal_desk.inference_operations o on o.id=a.operation_id where o.user_id=$1`,
        [specialist],
      )
    ).rows;
    if (process.env.EVALUATION_REPORT) {
      await mkdir(dirname(process.env.EVALUATION_REPORT), { recursive: true });
      await writeFile(
        process.env.EVALUATION_REPORT,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            node: process.version,
            corpusHash,
            mode: "real PostgreSQL and production HTTP/MCP; synthetic auth; saved and controlled provider only",
            rows,
            checks,
            accounting,
            budgets: (
              await ctx.db.query(
                "select scope,spent_micro_usd,reserved_micro_usd,active from signal_desk.inference_budgets where scope in ('installation',$1) order by scope",
                [specialist],
              )
            ).rows,
            paidProviderCalls: 0,
            billingNote:
              "Controlled callback token counts and synthetic rates test accounting only. They are not provider usage or an invoice.",
            unavailable: [
              "Live extraction accuracy and provider latency/cost",
              "Live Supabase auth",
              "Actual-photo readability/vision accuracy and AE3 actual-photo trial",
              "Jev versus single-model baseline",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    }
    if (process.env.EVALUATION_KEEP !== "synthetic-preview") await cleanup(ctx);
    else {
      ctx.db.release();
      await ctx.pool.end();
    }
  }
});
