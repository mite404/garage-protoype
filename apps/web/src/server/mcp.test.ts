import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { prepareTestDatabase } from "./test-database";
import { startTestApp } from "./test-app";
import { resolveActor } from "./access";
import { addSource } from "./evidence";
import { claimImport, loadSavedEvidence, processImport } from "./imports";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const specialist = "78000000-0000-4000-8000-000000000001";
const buyer = "78000000-0000-4000-8000-000000000002";
const session = "78000000-0000-4000-8000-000000000003";

test(
  "real stdio MCP client obeys shared HTTP token, draft and record controls",
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
    let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
    const clients: Client[] = [];
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
        [specialist, buyer],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, specialist]);
      await db.query(
        "insert into signal_desk.vehicles(id,title) values ('mcp-truck','Synthetic MCP pumper')",
      );
      await db.query(
        "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ('mcp-deal','mcp-truck',$1,$2),('mcp-private','mcp-truck',$1,$2)",
        [buyer, specialist],
      );
      await db.query("insert into signal_desk.opportunity_members values ('mcp-deal',$1)", [
        specialist,
      ]);
      process.env.EVIDENCE_MODEL = "mcp-controlled";
      app = await startTestApp(specialist, session);
      const running = app;
      const desk = await fetch(`${running.origin}/desk`, {
        headers: { Cookie: running.cookie },
      });
      assert.equal(desk.status, 200);
      assert.match(await desk.text(), /href="\/desk\/tokens"[^>]*>MCP tokens/);
      async function issue(scopes: string[] = ["read"]) {
        const response = await fetch(`${running.origin}/api/v1/desk/tokens`, {
          method: "POST",
          headers: {
            Cookie: running.cookie,
            Origin: "http://signal.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: "Controlled MCP test",
            scopes,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        });
        assert.equal(response.status, 200, await response.clone().text());
        return z
          .object({ data: z.object({ id: z.string(), secret: z.string() }) })
          .parse(await response.json()).data;
      }
      async function connect(secret: string) {
        const client = new Client({ name: "eth-78-real-client", version: "1.0.0" });
        clients.push(client);
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: ["--import", "tsx", "apps/web/src/mcp.ts"],
            env: {
              PATH: process.env.PATH ?? "",
              SIGNAL_DESK_URL: running.origin,
              SIGNAL_DESK_TOKEN: secret,
            },
          }),
        );
        return client;
      }
      const token = await issue();
      const stored = await db.query("select token_hash from signal_desk.app_tokens where id=$1", [
        token.id,
      ]);
      assert.match(stored.rows[0].token_hash, /^[0-9a-f]{64}$/);
      assert.notEqual(stored.rows[0].token_hash, token.secret);
      const client = await connect(token.secret);
      await t.test(
        "only bounded tools are exposed and another opportunity is concealed",
        async () => {
          const tools = (await client.listTools()).tools.map((tool) => tool.name);
          assert.deepEqual(tools.sort(), [
            "create_draft",
            "get_assistance",
            "get_growth_operations",
            "get_growth_profile",
            "get_job",
            "get_workbench",
            "list_opportunities",
            "queue_import",
            "retry_import",
          ]);
          const listed = await client.callTool({ name: "list_opportunities", arguments: {} });
          assert.match(JSON.stringify(listed), /mcp-deal/);
          assert.doesNotMatch(JSON.stringify(listed), /mcp-private/);
          const denied = await client.callTool({
            name: "get_workbench",
            arguments: { opportunityId: "mcp-private" },
          });
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /NOT_FOUND/);
        },
      );
      const draft = {
        opportunityId: "mcp-deal",
        key: "mcp-draft-once",
        input: {
          kind: "photo_request",
          revision: 0,
          recipientLabel: "Synthetic seller",
          body: "Please provide a readable odometer photo for specialist review.",
        },
      };
      await t.test(
        "read-only tokens cannot write through MCP or forge human approvals",
        async () => {
          const denied = await client.callTool({ name: "create_draft", arguments: draft });
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /SCOPE_DENIED/);
          const processing = await client.callTool({
            name: "queue_import",
            arguments: {
              opportunityId: "mcp-deal",
              vehicleId: "mcp-truck",
              sourceIds: ["any"],
              key: "readonly-processing",
            },
          });
          assert.equal(processing.isError, true);
          assert.match(JSON.stringify(processing), /SCOPE_DENIED/);
          const review = await fetch(
            `${running.origin}/api/v1/desk/vehicles/mcp-truck/reviews?opportunityId=mcp-deal`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token.secret}`, "If-Match": '"0"' },
              body: JSON.stringify({
                kind: "unknown",
                field: "tankCapacity",
                reason: "Forged approval",
              }),
            },
          );
          assert.equal(review.status, 403);
          assert.match(await review.text(), /HUMAN_SESSION_REQUIRED/);
          const management = await fetch(`${running.origin}/api/v1/desk/tokens`, {
            headers: { Authorization: `Bearer ${token.secret}` },
          });
          assert.equal(management.status, 403);
          const invalid = await fetch(`${running.origin}/api/v1/desk/opportunities`, {
            headers: { Cookie: running.cookie, Authorization: "Bearer invalid" },
          });
          assert.equal(invalid.status, 401);
        },
      );
      await t.test(
        "write opt-in persists exactly one unsent draft and detects payload reuse",
        async () => {
          const writer = await connect((await issue(["read", "write"])).secret);
          const first = await writer.callTool({ name: "create_draft", arguments: draft });
          assert.notEqual(first.isError, true);
          assert.match(JSON.stringify(first), /unsent/);
          assert.deepEqual(
            await writer.callTool({ name: "create_draft", arguments: draft }),
            first,
          );
          assert.equal(
            (
              await db.query(
                "select count(*)::int as n from signal_desk.assistance_drafts where opportunity_id='mcp-deal'",
              )
            ).rows[0].n,
            1,
          );
          const conflict = await writer.callTool({
            name: "create_draft",
            arguments: { ...draft, input: { ...draft.input, body: "Different request" } },
          });
          assert.match(JSON.stringify(conflict), /IDEMPOTENCY_CONFLICT/);
        },
      );
      await t.test(
        "expiry and revocation affect the next request of an already connected client",
        async () => {
          await db.query(
            "update signal_desk.app_tokens set expires_at=clock_timestamp()-interval '1 second' where id=$1",
            [token.id],
          );
          const expired = await client.callTool({ name: "list_opportunities", arguments: {} });
          assert.equal(expired.isError, true);
          assert.match(JSON.stringify(expired), /UNAUTHENTICATED/);
          const live = await issue();
          const connected = await connect(live.secret);
          const revoked = await fetch(`${running.origin}/api/v1/desk/tokens/${live.id}`, {
            method: "DELETE",
            headers: { Cookie: running.cookie, Origin: "http://signal.test" },
          });
          assert.equal(revoked.status, 200);
          assert.equal(
            (await connected.callTool({ name: "list_opportunities", arguments: {} })).isError,
            true,
          );
          const listing = await fetch(`${running.origin}/api/v1/desk/tokens`, {
            headers: { Cookie: running.cookie },
          });
          assert.equal(listing.status, 200);
          assert.doesNotMatch(await listing.text(), /sd_[A-Za-z0-9_-]{43}|token_hash|secret/);
        },
      );
      await t.test(
        "queued, retried and recovered jobs keep the original credential and shared budgets",
        async () => {
          const actor = await resolveActor({ userId: specialist, sessionId: session });
          const saved = await loadSavedEvidence(actor, "mcp-deal");
          const savedLease = await claimImport(saved.id);
          assert.ok(savedLease);
          await processImport(savedLease);
          const source = await addSource(actor, "mcp-deal", {
            name: "Synthetic seller note",
            kind: "seller_note",
            content: Buffer.from("Tank capacity 725 gal."),
            mediaType: "text/plain",
            audience: "sales",
            permission: "synthetic",
            provenance: "Controlled ETH-78 test",
          });
          const writer = await connect((await issue(["read", "write"])).secret);
          const workbench = await writer.callTool({
            name: "get_workbench",
            arguments: { opportunityId: "mcp-deal" },
          });
          assert.notEqual(workbench.isError, true);
          const packet = JSON.parse(
            z.object({ content: z.array(z.object({ text: z.string() })).min(1) }).parse(workbench)
              .content[0]!.text,
          );
          const sources = z
            .object({
              data: z.object({
                sources: z.array(z.object({ id: z.string(), pages: z.array(z.string()) })),
              }),
            })
            .parse(packet).data.sources;
          assert.deepEqual(sources.find((s) => s.id === source.id)?.pages, [
            "Tank capacity 725 gal.",
          ]);
          const citations = z
            .object({
              data: z.object({
                claims: z.array(
                  z.object({
                    excerpt: z.string(),
                    page: z.number(),
                    start: z.number(),
                    end: z.number(),
                  }),
                ),
              }),
            })
            .parse(packet).data.claims;
          assert.ok(citations.some((c) => c.excerpt === "Tank capacity: 750 gallons."));
          assert.deepEqual(
            citations.find((c) => c.excerpt === "Tank capacity: 750 gallons."),
            {
              excerpt: "Tank capacity: 750 gallons.",
              page: 1,
              start: 0,
              end: 27,
            },
          );
          const args = {
            opportunityId: "mcp-deal",
            vehicleId: "mcp-truck",
            sourceIds: [source.id],
            key: "bounded-import",
          };
          const forged = await writer.callTool({
            name: "queue_import",
            arguments: { ...args, model: "client-selected", canSpend: true },
          });
          assert.equal(forged.isError, true);
          const denied = await writer.callTool({ name: "queue_import", arguments: args });
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /SPENDING_DENIED/);
          const spenderToken = await issue(["read", "write", "spend"]);
          const spender = await connect(spenderToken.secret);
          const queued = await spender.callTool({ name: "queue_import", arguments: args });
          assert.notEqual(queued.isError, true);
          const textResult = z
            .object({
              content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
            })
            .parse(queued);
          const jobId = z
            .object({ data: z.object({ id: z.string() }) })
            .parse(JSON.parse(textResult.content[0]!.text)).data.id;
          assert.deepEqual(
            await spender.callTool({ name: "queue_import", arguments: args }),
            queued,
          );
          const job = await db.query(
            "select session_id,app_token_id from signal_desk.import_jobs where id=$1",
            [jobId],
          );
          assert.deepEqual(job.rows[0], { session_id: null, app_token_id: spenderToken.id });
          await db.query(
            `insert into signal_desk.inference_models(id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms) values ('mcp-controlled',10485760,0,0,0,10,1,1,2,10,1000)`,
          );
          let calls = 0;
          const provider = async () => {
            calls++;
            return { kind: "not-billed" as const, retryable: true };
          };
          for (const denial of ["installation", "user", "concurrency"]) {
            await db.query("delete from signal_desk.inference_budgets");
            await db.query(
              "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent,active) values ('installation',$1,1,$3),($4,$2,1,0)",
              [
                denial === "installation" ? 0 : 1000000,
                denial === "user" ? 0 : 1000000,
                denial === "concurrency" ? 1 : 0,
                specialist,
              ],
            );
            const lease = await claimImport(jobId);
            assert.ok(lease);
            await processImport(lease, provider);
            const status = await spender.callTool({ name: "get_job", arguments: { jobId } });
            assert.match(
              JSON.stringify(status),
              denial === "concurrency" ? /CONCURRENCY_LIMIT/ : /BUDGET_EXHAUSTED/,
            );
            assert.notEqual(
              (await spender.callTool({ name: "retry_import", arguments: { jobId } })).isError,
              true,
            );
          }
          assert.equal(calls, 0);
          const recovered = await claimImport(jobId);
          assert.ok(recovered);
          await db.query(
            "update signal_desk.import_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",
            [jobId],
          );
          await fetch(`${running.origin}/api/v1/desk/tokens/${spenderToken.id}`, {
            method: "DELETE",
            headers: { Cookie: running.cookie, Origin: "http://signal.test" },
          });
          const newLease = await claimImport(jobId);
          assert.ok(newLease);
          await processImport(newLease, provider);
          assert.equal(calls, 0);
          assert.equal(
            (await db.query("select error from signal_desk.import_jobs where id=$1", [jobId]))
              .rows[0].error,
            "UNAUTHENTICATED",
          );
          const fresh = await connect((await issue(["read", "write", "spend"])).secret);
          const retry = await fresh.callTool({ name: "retry_import", arguments: { jobId } });
          assert.equal(retry.isError, true);
          assert.match(JSON.stringify(retry), /UNAUTHENTICATED/);
          await assert.rejects(processImport(recovered, provider), { code: "STALE_WORKER" });
          assert.equal(
            (
              await db.query(
                "select count(*)::int as n from signal_desk.inference_attempts where operation_id in(select id from signal_desk.inference_operations where user_id=$1)",
                [specialist],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test(
        "token scope never survives lost membership, spending rights or identity",
        async () => {
          const live = await issue(["read", "write", "spend"]);
          const connected = await connect(live.secret);
          await db.query(
            "delete from signal_desk.opportunity_members where opportunity_id='mcp-deal' and user_id=$1",
            [specialist],
          );
          const denied = await connected.callTool({
            name: "get_workbench",
            arguments: { opportunityId: "mcp-deal" },
          });
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /NOT_FOUND/);
          await db.query("insert into signal_desk.opportunity_members values ('mcp-deal',$1)", [
            specialist,
          ]);
          await db.query("update signal_desk.identities set can_spend=false where user_id=$1", [
            specialist,
          ]);
          const spend = await connected.callTool({
            name: "queue_import",
            arguments: {
              opportunityId: "mcp-deal",
              vehicleId: "mcp-truck",
              sourceIds: ["any"],
              key: "lost-spend",
            },
          });
          assert.match(JSON.stringify(spend), /SPENDING_DENIED/);
          await db.query(
            "update signal_desk.identities set revoked_at=clock_timestamp() where user_id=$1",
            [specialist],
          );
          const revoked = await connected.callTool({ name: "list_opportunities", arguments: {} });
          assert.equal(revoked.isError, true);
          assert.match(JSON.stringify(revoked), /ACCESS_REVOKED/);
          await db.query(
            "update signal_desk.identities set revoked_at=null,can_spend=true where user_id=$1",
            [specialist],
          );
        },
      );
    } finally {
      for (const client of clients) await client.close();
      await app?.stop();
      await db.query("delete from signal_desk.inference_denials where user_id=$1", [specialist]);
      await db.query("delete from signal_desk.inference_operations where user_id=$1", [specialist]);
      await db.query("delete from signal_desk.inference_budgets");
      await db.query("delete from signal_desk.inference_models where id='mcp-controlled'");
      await db.query(
        "delete from signal_desk.sources where opportunity_id in ('mcp-deal','mcp-private')",
      );
      await db.query(
        "delete from signal_desk.import_jobs where opportunity_id in ('mcp-deal','mcp-private')",
      );
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id in ('mcp-deal','mcp-private')",
      );
      await db.query(
        "delete from signal_desk.opportunities where id in ('mcp-deal','mcp-private')",
      );
      await db.query("delete from signal_desk.vehicles where id='mcp-truck'");
      await db.query("delete from auth.sessions where id=$1", [session]);
      await db.query("delete from signal_desk.app_tokens where user_id=$1", [specialist]);
      await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [
        specialist,
        buyer,
      ]);
      db.release();
      await pool.end();
    }
  },
);
