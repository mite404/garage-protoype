import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { resolveActor } from "./access";
import { prepareTestDatabase } from "./test-database";
import {
  createBuyerNeed,
  getSourcingAccount,
  openSourcingCase,
  listSourcingCases,
  proposeSourcingFact,
  runSourcingCommand,
} from "./sourcing";
import { seedSourcing } from "./sourcing-seed";
import { cancelSourcingStream, readSourcingStreams, submitSourcingStream } from "./streaming";
import { nodeRuntime, type StreamingTestRuntime } from "./test-streaming-owner";
import { startTestApp } from "./test-app";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const owners: StreamingTestRuntime =
  process.env.STREAMING_RUNTIME === "cloudflare"
    ? (await import("../../cloudflare/test/runtime")).cloudflareRuntime
    : nodeRuntime;

async function removeFixtures(db: PoolClient, users: string[]) {
  // CI reruns this file against the same database under the Cloudflare owner.
  const cases = "select id from signal_desk.sourcing_cases where owner_id = any($1)";
  const accounts = "select id from signal_desk.growth_accounts where owner_id = any($1)";
  for (const statement of [
    "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id = any($1))",
    "delete from signal_desk.inference_operations where user_id = any($1)",
    "delete from signal_desk.inference_denials where user_id = any($1)",
    "delete from signal_desk.inference_budgets where scope = 'installation' or scope = any($1::text[])",
    "delete from signal_desk.chat_turns where actor_id = any($1)",
    `delete from signal_desk.pairing_events where case_id in (${cases})`,
    `delete from signal_desk.pairing_facts where case_id in (${cases})`,
    `delete from signal_desk.source_changes where case_id in (${cases})`,
    "delete from signal_desk.sourcing_cases where owner_id = any($1)",
    "delete from signal_desk.buyer_needs where owner_id = any($1)",
    `delete from signal_desk.growth_receipts where message_id in (select id from signal_desk.growth_messages where account_id in (${accounts}))`,
    `delete from signal_desk.growth_messages where account_id in (${accounts})`,
    `delete from signal_desk.growth_events where account_id in (${accounts})`,
    `delete from signal_desk.growth_insights where account_id in (${accounts})`,
    `delete from signal_desk.growth_invitations where account_id in (${accounts})`,
    `delete from signal_desk.growth_observations where account_id in (${accounts})`,
    "delete from signal_desk.growth_accounts where owner_id = any($1)",
    "delete from auth.sessions where user_id = any($1)",
    "delete from signal_desk.identities where user_id = any($1)",
  ])
    await db.query(statement, [users]);
  await db.query("delete from signal_desk.inference_models where id='moonshotai/kimi-k3'");
}

test(
  "a rejected pairing keeps the buyer need and the assistant only proposes cited answers",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const user = "93000000-0000-4000-8000-000000000001";
    const session = "93000000-0000-4000-8000-000000000002";
    const foreignUser = "93000000-0000-4000-8000-000000000003";
    const foreignSession = "93000000-0000-4000-8000-000000000004";
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    await owners.prepare(url);
    const providerInputs: { tools?: { function: { name: string } }[]; messages: unknown[] }[] = [];
    let noteId = "";
    // A synthetic model that opens the fit card, proposes the cited height, then answers.
    const provider = createServer(async (request, response) => {
      const body: Buffer[] = [];
      for await (const bytes of request) body.push(Buffer.from(bytes));
      const input = JSON.parse(Buffer.concat(body).toString());
      providerInputs.push(input);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: "synthetic", model: "moonshotai/kimi-k3", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (input.messages.some((message: { role: string }) => message.role === "tool")) {
        chunk({ content: "The note states 118 in; review the proposal before deciding." });
        chunk({}, "stop");
      } else {
        // Cites the latest recorded original, as a model reading the case record would.
        const latest = await pool.query(
          "select id from signal_desk.pairing_events where kind='original' order by created_at desc limit 1",
        );
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "fit-card",
              type: "function",
              function: { name: "show_card", arguments: '{"tool":"fit","props":{}}' },
            },
            {
              index: 1,
              id: "height-proposal",
              type: "function",
              function: {
                name: "propose_fact",
                arguments: JSON.stringify({
                  sourceRef: latest.rows[0]?.id,
                  field: "heightIn",
                  value: 118,
                }),
              },
            },
          ],
        });
        chunk({}, "tool_calls");
      }
      response.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    }).listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    assert.ok(address && typeof address === "object");
    let owner: Awaited<ReturnType<typeof owners.start>> | undefined;
    let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'specialist',false)",
        [user, foreignUser],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)", [
        session,
        user,
        foreignSession,
        foreignUser,
      ]);
      await db.query(`insert into signal_desk.inference_models
      (id,enabled,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
      values ('moonshotai/kimi-k3',true,100000,0,0,1000,1000,1,12,1,10,10000)
      on conflict(id) do update set enabled=true`);
      await db.query(
        "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',10000000,5),($1,10000000,5) on conflict(scope) do update set limit_micro_usd=10000000,max_concurrent=5,spent_micro_usd=0,reserved_micro_usd=0,active=0",
        [user],
      );
      const actor = await resolveActor({ userId: user, sessionId: session });
      const foreign = await resolveActor({ userId: foreignUser, sessionId: foreignSession });

      const caseId = await seedSourcing(actor);
      assert.equal(await seedSourcing(actor), caseId);
      // Growth's single owner per seller holds; the walkthrough is never duplicated.
      await assert.rejects(seedSourcing(foreign), { code: "SEED_OWNED" });
      assert.deepEqual(await listSourcingCases(foreign), []);
      await assert.rejects(getSourcingAccount(foreign, caseId), { code: "NOT_FOUND" });
      await assert.rejects(
        runSourcingCommand(foreign, caseId, { kind: "record_original", revision: 1, text: "x" }),
        { code: "NOT_FOUND" },
      );

      const opened = await getSourcingAccount(actor, caseId);
      assert.equal(opened.revision, 1);
      assert.equal(
        opened.account.trigger?.excerpt,
        "New pumper scheduled to enter service in November.",
      );
      assert.equal(opened.account.outreach.deliveryEnabled, false);
      assert.deepEqual(opened.account.facts, []);
      await assert.rejects(
        runSourcingCommand(actor, caseId, {
          kind: "decide",
          revision: 1,
          decision: "proceed",
          reason: "Looks good",
        }),
        { code: "DECISION_REFUSED" },
      );

      // A reviewed request enrolls through growth's sourcing purpose; nothing is delivered.
      await runSourcingCommand(actor, caseId, {
        kind: "draft",
        revision: 1,
        subject: "Pumper availability",
        body: "Is the pumper for sale, and what is its exact overall height? Reply STOP to opt out.",
      });
      const drafted = await getSourcingAccount(actor, caseId);
      assert.equal(drafted.stage, "awaiting_seller");
      assert.equal(drafted.account.outreach.state, "queued");
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from signal_desk.growth_messages where enrollment_key=$1",
            [`pairing:${caseId}:2`],
          )
        ).rows[0].count > 0,
        true,
      );

      // A recorded note keeps the original and turns its explicit height into a proposal only.
      await runSourcingCommand(actor, caseId, {
        kind: "record_original",
        revision: 2,
        text: "Maybe later. Our current pumper is 121 inches tall.",
      });
      const noted = await getSourcingAccount(actor, caseId);
      assert.equal(noted.account.replies[0]?.channel, "note");
      noteId = noted.account.replies[0]!.id;
      const [height] = noted.account.facts;
      assert.deepEqual(
        {
          field: height?.field,
          value: height?.value,
          basis: height?.basis,
          status: height?.status,
        },
        { field: "heightIn", value: 121, basis: "explicit_reply", status: "proposed" },
      );
      await assert.rejects(
        runSourcingCommand(actor, caseId, { kind: "accept", revision: 1, factIds: [height!.id] }),
        { code: "STALE_REVIEW" },
      );
      await assert.rejects(
        proposeSourcingFact(actor, caseId, noted.revision, {
          sourceRef: "invented-source",
          answer: { field: "heightIn", value: 100 },
        }),
        { code: "INVALID_INPUT" },
      );

      // The assistant runs a metered model turn on the same records and only proposes.
      app = await startTestApp(user, session, process.env.SOURCING_BROWSER_EVIDENCE ? 3918 : 0);
      owner = await owners.start(address.port);
      const turn = await submitSourcingStream(
        actor,
        caseId,
        "What does the note say about height?",
        "sourcing-key",
      );
      assert.equal(
        (
          await submitSourcingStream(
            actor,
            caseId,
            "What does the note say about height?",
            "sourcing-key",
          )
        ).id,
        turn.id,
      );
      await assert.rejects(submitSourcingStream(foreign, caseId, "Hi", "foreign-key"), {
        code: "SPENDING_DENIED",
      });
      let done;
      for (let i = 0; i < 400 && !done; i++) {
        done = (await readSourcingStreams(actor, caseId)).find(
          (item) => item.id === turn.id && item.state === "completed",
        );
        if (!done) await setTimeout(50);
      }
      assert.ok(done, JSON.stringify(await readSourcingStreams(actor, caseId)));
      assert.deepEqual(done.cards, [{ kind: "sourcing", view: "fit" }]);
      assert.match(done.text, /118 in/);
      assert.deepEqual(providerInputs[0]?.tools?.map((tool) => tool.function.name).sort(), [
        "propose_fact",
        "show_card",
      ]);
      assert.match(JSON.stringify(providerInputs[0]?.messages), /121 inches tall/);
      const proposed = (await getSourcingAccount(actor, caseId)).account.facts.find(
        (fact) => fact.value === 118,
      );
      assert.equal(proposed?.basis, "ai_interpretation");
      assert.equal(proposed?.status, "proposed");
      assert.equal(proposed?.sourceRef, noteId);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from signal_desk.inference_operations where sourcing_case_id=$1",
            [caseId],
          )
        ).rows[0].count,
        2,
      );
      const queued = await submitSourcingStream(actor, caseId, "Anything else?", "cancel-key");
      await cancelSourcingStream(actor, caseId, queued.id);

      // Accepting 121 in rejects this pairing; the buyer need stays active for other sellers.
      const current = await getSourcingAccount(actor, caseId);
      await runSourcingCommand(actor, caseId, {
        kind: "accept",
        revision: current.revision,
        factIds: [height!.id],
      });
      const reviewed = await getSourcingAccount(actor, caseId);
      await assert.rejects(
        runSourcingCommand(actor, caseId, {
          kind: "decide",
          revision: reviewed.revision,
          decision: "proceed",
          reason: "Fits",
        }),
        { code: "DECISION_REFUSED" },
      );
      await runSourcingCommand(actor, caseId, {
        kind: "decide",
        revision: reviewed.revision,
        decision: "reject",
        reason: "Reviewed height 121 in exceeds 120 in.",
      });
      const decided = await getSourcingAccount(actor, caseId);
      assert.equal(decided.stage, "rejected");
      assert.deepEqual(decided.account.decision?.basis, {
        needRevision: 1,
        factIds: [height!.id],
      });
      // A decided pairing never enrolls again, and a stale request never reaches growth.
      const draft = {
        kind: "draft",
        subject: "Again",
        body: "Still for sale? Reply STOP to opt out.",
      };
      await assert.rejects(
        runSourcingCommand(actor, caseId, { ...draft, revision: decided.revision }),
        { code: "PAIRING_CLOSED" },
      );
      await assert.rejects(runSourcingCommand(actor, caseId, { ...draft, revision: 1 }), {
        code: "STALE_REVIEW",
      });
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from signal_desk.growth_messages where enrollment_key like $1",
            [`pairing:${caseId}:%`],
          )
        ).rows[0].count,
        (
          await db.query(
            "select count(*)::int as count from signal_desk.growth_messages where enrollment_key=$1",
            [`pairing:${caseId}:2`],
          )
        ).rows[0].count,
      );
      await assert.rejects(
        runSourcingCommand(actor, caseId, {
          kind: "reject_fact",
          revision: decided.revision,
          factId: "fact:unknown",
        }),
        { code: "STALE_REVIEW" },
      );
      assert.deepEqual(
        (await listSourcingCases(actor)).map((item) => [
          item.stage,
          item.needState,
          item.nextAction,
        ]),
        [["rejected", "active", "Find another candidate for this buyer need."]],
      );

      // The page and its commands are served from the same records over HTTP.
      const headers = {
        cookie: app.cookie,
        Origin: process.env.SOURCING_BROWSER_EVIDENCE ? app.origin : "http://signal.test",
        "Content-Type": "application/json",
      };
      const page = await fetch(`${app.origin}/desk/sourcing/${caseId}`, { headers });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Cedar Valley Fire District/);
      const queue = await fetch(`${app.origin}/desk/sourcing`, { headers });
      assert.match(await queue.text(), /Pairing rejected/);
      const stale = await fetch(`${app.origin}/api/v1/desk/sourcing/${caseId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "record_original", revision: 1, text: "Late note" }),
      });
      assert.equal(stale.status, 412);

      if (process.env.SOURCING_BROWSER_EVIDENCE) {
        // A second need pairs with the same seller: the earlier rejection was pairing-only.
        const needId = await createBuyerNeed(actor, {
          buyerLabel: "Harbor Point FD",
          statement: "Harbor Point FD needs a pumper at most $200,000 all-in and 125 in high.",
          provenance: "Synthetic permissioned call note",
          constraints: {
            vehicleClass: "Pumper",
            budgetBasis: "total",
            maxBudgetCents: 20_000_000,
            maxHeightIn: 125,
          },
          inventory: { searchedAt: new Date("2026-10-19T00:00:00Z"), reviewedMatches: 0 },
          synthetic: true,
        });
        const open = await openSourcingCase(actor, {
          needId,
          sellerProspectId: decided.sellerHref.split("/").at(-1),
          nextAction: "Confirm height and all-in cost before buyer outreach.",
          sourceChange: {
            dedupeKey: "synthetic:cedar-valley:replacement-notice",
            sourceLabel: "Replacement notice · Synthetic source",
            url: "https://example.org/synthetic/cedar-valley-notice",
            excerpt: "New pumper scheduled to enter service in November.",
            observedAt: new Date("2026-10-18T00:00:00Z"),
            synthetic: true,
          },
        });
        const evidence = await promisify(execFile)(
          process.execPath,
          ["scripts/verify-sourcing-ui.mjs"],
          {
            env: {
              ...process.env,
              SOURCING_REVIEW_ORIGIN: app.origin,
              SOURCING_REVIEW_COOKIE: app.cookie,
              SOURCING_REVIEW_REJECTED: caseId,
              SOURCING_REVIEW_OPEN: open,
            },
            timeout: 240000,
            maxBuffer: 100000,
          },
        );
        t.diagnostic(evidence.stdout);
      }
      await db.query("update signal_desk.identities set revoked_at=now() where user_id=$1", [user]);
      await assert.rejects(getSourcingAccount(actor, caseId), { code: "ACCESS_REVOKED" });
    } finally {
      await owner?.stop();
      await app?.stop();
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await removeFixtures(db, [user, foreignUser]);
      db.release();
      await pool.end();
    }
  },
);
