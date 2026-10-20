import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { Pool } from "pg";
import { prepareTestDatabase } from "./test-database";
import { startTestApp } from "./test-app";
import { resolveActor } from "./access";
import {
  importDirectory,
  listProspects,
  reviewProspect,
  getProspect,
  routeProspect,
} from "./growth";
import { dispatchMessage, enrollSequence, reconcileMessage, readOutreach } from "./outreach";
import { receiveResendEvent } from "./growth-integrations";
import { recordGrowthOutcome, linkProspectAccount } from "./growth-views";
import {
  prepareOutreachExperiment,
  readOutreachExperiment,
  readExperimentReport,
} from "./outreach-experiment";
import { drainGrowthTelemetry } from "./growth-measurement";
import { qualifySeller } from "./sourcing";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");

// Catches per-contact reassignment, queued/accepted exposure, early receipt loss and raw-data export.
test(
  "reviewed account experiment measures confirmed delivery, not enrollment or acceptance",
  { skip: !url },
  async () => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const env = { ...process.env };
    const originalFetch = globalThis.fetch;
    const owner = "b1000000-0000-4000-8000-000000000001";
    const session = "b1000000-0000-4000-8000-000000000002";
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    const captures: unknown[] = [];
    let variant = "control";
    const inspectUi = async (accountId: string, state: string) => {
      if (!process.env.POSTHOG_BROWSER_EVIDENCE) return;
      const controlledFetch = globalThis.fetch;
      globalThis.fetch = originalFetch;
      const token = process.env.POSTHOG_PROJECT_TOKEN;
      delete process.env.POSTHOG_PROJECT_TOKEN;
      const app = await startTestApp(owner, session);
      if (token) process.env.POSTHOG_PROJECT_TOKEN = token;
      try {
        const result = await promisify(execFile)(
          process.execPath,
          ["scripts/verify-posthog-experiment-ui.mjs"],
          {
            env: {
              ...process.env,
              POSTHOG_REVIEW_ORIGIN: app.origin,
              POSTHOG_REVIEW_COOKIE: app.cookie,
              POSTHOG_REVIEW_ACCOUNT: accountId,
              POSTHOG_REVIEW_STATE: state,
            },
            timeout: 180000,
          },
        );
        assert.match(result.stdout, /experiment UI passed/);
      } finally {
        await app.stop();
        globalThis.fetch = controlledFetch;
      }
    };
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/flags"))
        return Response.json({ featureFlags: { "reviewed-outreach-v1": variant } });
      const raw = Buffer.from(await new Response(init?.body).arrayBuffer());
      captures.push(JSON.parse((raw[0] === 31 ? gunzipSync(raw) : raw).toString()));
      return Response.json({ status: "Ok" });
    };
    try {
      await db.query("begin");
      await prepareTestDatabase(db);
      await db.query("commit");
      await db.query("insert into signal_desk.identities(user_id,role) values ($1,'specialist')", [
        owner,
      ]);
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, owner]);
      const actor = await resolveActor({ userId: owner, sessionId: session });
      await importDirectory(actor, {
        source: "usfa",
        snapshot: "posthog-contract",
        synthetic: true,
        rows: [
          {
            sourceId: "PH-CONTRACT",
            name: "Private department",
            city: "Albany",
            state: "NY",
            postalCode: "12207",
          },
        ],
      });
      const id = (await listProspects(actor))[0]!.id;
      await reviewProspect(actor, id, {
        name: "Private department",
        fit: "fit",
        identity: "confirmed",
        signal: {
          text: "Private needs a pumper",
          quote: "needs a pumper",
          source: "PRIVATE source",
          permission: "synthetic",
        },
        contact: {
          name: "PRIVATE person",
          email: "ph-contract@example.test",
          permission: "allowlisted_test",
          provenance: "PRIVATE provenance",
        },
      });
      assert.equal(
        await prepareOutreachExperiment(actor, id, {}),
        null,
        "disabled means no vendor allocation",
      );
      await inspectUi(id, "disabled");
      process.env.POSTHOG_ENABLED = "true";
      process.env.POSTHOG_PROJECT_TOKEN = "phc_contract";
      process.env.POSTHOG_HOST = "https://us.i.posthog.com";
      process.env.POSTHOG_ID_SALT = "controlled-only-32-character-contract-secret";
      variant = "unknown";
      assert.equal(await prepareOutreachExperiment(actor, id, {}), null);
      assert.deepEqual(
        (await readExperimentReport(actor)).eligibility.find((row) => row.synthetic),
        { synthetic: true, eligible: 1, unassigned: 1 },
      );
      variant = "control";
      const assignment = await prepareOutreachExperiment(actor, id, {});
      assert.equal(assignment?.variant, "control");
      variant = "evidence_first";
      assert.equal(
        (await prepareOutreachExperiment(actor, id, {}))?.variant,
        "control",
        "persisted assignment survives vendor changes",
      );
      assert.ok(assignment);
      await inspectUi(id, "assigned");
      await assert.rejects(
        enrollSequence(actor, id, {
          key: "changed-draft",
          experiment: true,
          subject: assignment.subject,
          body: "Changed reviewed text. Reply STOP",
        }),
        { code: "EXPERIMENT_REVIEW_REQUIRED" },
      );
      const message = await enrollSequence(actor, id, {
        key: "contract-sequence",
        experiment: true,
        subject: assignment.subject,
        body: assignment.body,
      });
      assert.equal((await readOutreachExperiment(actor, id))?.exposedAt, null);
      const secret = `whsec_${Buffer.from("controlled-posthog-secret").toString("base64")}`;
      process.env.RESEND_WEBHOOK_SECRET = secret;
      const raw = JSON.stringify({
        type: "email.delivered",
        data: { email_id: "ph-provider-private" },
      });
      const stamp = String(Math.floor(Date.now() / 1000));
      const eventId = "ph-private-receipt";
      const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
        .update(`${eventId}.${stamp}.${raw}`)
        .digest("base64");
      const headers = new Headers({
        "svix-id": eventId,
        "svix-timestamp": stamp,
        "svix-signature": `v1,${signature}`,
      });
      // Delivery can race ahead of settlement. No mapping yet, so it must not create exposure yet.
      await receiveResendEvent(raw, headers);
      await drainGrowthTelemetry();
      assert.equal((await readOutreachExperiment(actor, id))?.exposedAt, null);
      await dispatchMessage(message.id, async () => {
        await reconcileMessage(actor, id, {
          messageId: message.id,
          providerId: null,
          evidence: "Controlled contradictory not-sent evidence",
        });
        return { id: "ph-provider-private" };
      });
      await drainGrowthTelemetry();
      assert.equal(
        (await readOutreach(actor, id)).find((row) => row.id === message.id)?.state,
        "stopped",
      );
      assert.ok((await readOutreachExperiment(actor, id))?.exposedAt);
      await inspectUi(id, "delivered");
      await receiveResendEvent(raw, headers);
      await drainGrowthTelemetry();
      const exposures = captures.filter((value) =>
        JSON.stringify(value).includes('"growth_exposed"'),
      );
      assert.equal(exposures.length, 1, "duplicate webhook does not create another exposure");
      await db.query(
        "insert into signal_desk.vehicles(id,title,published_at) values ('ph-contract-truck','Synthetic pumper',now())",
      );
      const sellerReply = {
        vehicleTitle: "Synthetic pumper",
        reply: "Yes, the pumper is for sale.",
        provenance: "PRIVATE synthetic reply",
        permission: "synthetic",
      };
      const qualified = await qualifySeller(actor, id, sellerReply);
      await qualifySeller(actor, id, sellerReply);
      assert.equal(qualified.vehicleId, `listing-${id}`);
      await drainGrowthTelemetry();
      assert.equal(
        captures.filter((value) => JSON.stringify(value).includes('"growth_qualified_reply"'))
          .length,
        1,
      );
      const report = await readExperimentReport(actor);
      assert.equal(
        report.cohorts.find((row) => row.synthetic && row.variant === "control")?.pending,
        1,
      );
      // Fixed asymmetric boundary: mature at 14 days, qualification exactly at the endpoint counts.
      await db.query(
        `update signal_desk.outreach_experiments set
        exposed_at=now()-interval '15 days', qualified_at=now()-interval '1 day'
        where account_id=$1`,
        [id],
      );
      const mature = (await readExperimentReport(actor)).cohorts.find(
        (row) => row.synthetic && row.variant === "control",
      );
      assert.equal(mature?.mature, 1);
      assert.equal(mature?.pending, 0);
      assert.equal(mature?.qualified, 1);
      assert.equal(mature?.interval, "20.7–100.0% (95% Wilson)");
      assert.equal(
        (await readExperimentReport(actor)).cohorts.find(
          (row) => !row.synthetic && row.variant === "control",
        )?.mature,
        0,
      );
      await db.query(
        "update signal_desk.outreach_experiments set qualified_at=exposed_at+interval '14 days 0.001 seconds' where account_id=$1",
        [id],
      );
      assert.equal(
        (await readExperimentReport(actor)).cohorts.find(
          (row) => row.synthetic && row.variant === "control",
        )?.qualified,
        0,
      );
      for (const secret of [
        owner,
        id,
        "PRIVATE",
        "ph-contract@example.test",
        "ph-provider-private",
      ])
        assert.equal(JSON.stringify(captures).includes(secret), false, secret);
      const workingFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("vendor unavailable");
      };
      await recordGrowthOutcome(actor, id, {
        key: "private-progress",
        kind: "progressed",
        detail: "PRIVATE outcome",
        evidence: "PRIVATE evidence",
      });
      await assert.doesNotReject(drainGrowthTelemetry());
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from signal_desk.growth_telemetry where scope_id=$1 and delivered_at is null",
            [owner],
          )
        ).rows[0].n,
        1,
      );
      globalThis.fetch = workingFetch;
      await drainGrowthTelemetry();
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from signal_desk.growth_telemetry where scope_id=$1 and delivered_at is null",
            [owner],
          )
        ).rows[0].n,
        0,
      );
      await importDirectory(actor, {
        source: "usfa",
        snapshot: "posthog-regressions",
        synthetic: true,
        rows: [
          {
            sourceId: "PH-MATCH",
            name: "Private matched department",
            city: "Albany",
            state: "NY",
            postalCode: "12207",
          },
          {
            sourceId: "PH-ROUTE",
            name: "Private routed department",
            city: "Albany",
            state: "NY",
            postalCode: "12207",
          },
        ],
      });
      const accounts = await listProspects(actor);
      const matched = accounts.find((row) => row.name === "Private matched department")!;
      const routed = accounts.find((row) => row.name === "Private routed department")!;
      const review = (await getProspect(actor, id)).review!;
      await reviewProspect(actor, matched.id, review);
      await db.query(
        "insert into signal_desk.organizations(id,name,city,region,unit,synthetic) values ('ph-existing','Private existing buyer','Albany','NY','',true)",
      );
      await db.query(
        "insert into signal_desk.opportunities(id,organization_id,vehicle_id,assignee_id,next_action) values ('ph-existing','ph-existing','ph-contract-truck',$1,'Review')",
        [owner],
      );
      await db.query(
        "insert into signal_desk.opportunity_members(opportunity_id,user_id) values ('ph-existing',$1)",
        [owner],
      );
      await linkProspectAccount(actor, matched.id, { organizationId: "ph-existing" });
      await qualifySeller(actor, matched.id, {
        ...sellerReply,
        reply: "Yes, it is for sale",
        provenance: "PRIVATE matched reply",
      });
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from signal_desk.growth_telemetry where account_id=$1 and kind='opportunity_created'",
            [matched.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from signal_desk.growth_telemetry where account_id=$1 and kind='qualified'",
            [matched.id],
          )
        ).rows[0].n,
        1,
      );
      await reviewProspect(actor, routed.id, review);
      variant = "unknown";
      assert.equal(await prepareOutreachExperiment(actor, routed.id, {}), null);
      const otherId = "b1000000-0000-4000-8000-000000000003",
        otherSession = "b1000000-0000-4000-8000-000000000004";
      await db.query("insert into signal_desk.identities(user_id,role) values ($1,'specialist')", [
        otherId,
      ]);
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [
        otherSession,
        otherId,
      ]);
      await db.query(
        "insert into signal_desk.growth_territories(id,postal_prefix,specialist_id) values ('ph-route','122',$1)",
        [otherId],
      );
      await routeProspect(actor, routed.id);
      const other = await resolveActor({ userId: otherId, sessionId: otherSession });
      variant = "evidence_first";
      assert.equal(
        (await prepareOutreachExperiment(other, routed.id, {}))?.variant,
        "evidence_first",
      );
      await prepareOutreachExperiment(other, routed.id, {});
      assert.deepEqual(
        (await readExperimentReport(other)).eligibility.find((row) => row.synthetic),
        { synthetic: true, eligible: 1, unassigned: 0 },
      );
      assert.equal(
        (await readExperimentReport(other)).cohorts.find(
          (row) => row.synthetic && row.variant === "evidence_first",
        )?.assigned,
        1,
      );
      await db.query("update signal_desk.growth_accounts set owner_id=$1 where owner_id=$2", [
        owner,
        otherId,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env = env;
      await db.query("rollback");
      await db.query(
        "delete from signal_desk.growth_telemetry where scope_id in ($1,'b1000000-0000-4000-8000-000000000003')",
        [owner],
      );
      await db.query(
        "delete from signal_desk.outreach_experiments where scope_id in ($1,'b1000000-0000-4000-8000-000000000003')",
        [owner],
      );
      await db.query("delete from signal_desk.growth_territories where id='ph-route'");
      await db.query(
        "update signal_desk.growth_accounts set owner_id=$1 where owner_id='b1000000-0000-4000-8000-000000000003'",
        [owner],
      );
      await db.query(
        "delete from auth.sessions where user_id='b1000000-0000-4000-8000-000000000003'",
      );
      await db.query(
        "delete from signal_desk.identities where user_id='b1000000-0000-4000-8000-000000000003'",
      );
      await db.query(
        "delete from signal_desk.growth_receipts where id like 'ph-%' or message_id in (select id from signal_desk.growth_messages where actor_id=$1)",
        [owner],
      );
      await db.query("delete from signal_desk.growth_messages where actor_id=$1", [owner]);
      await db.query(
        "delete from signal_desk.growth_events where account_id in (select id from signal_desk.growth_accounts where owner_id=$1)",
        [owner],
      );
      await db.query(
        "delete from signal_desk.growth_observations where account_id in (select id from signal_desk.growth_accounts where owner_id=$1)",
        [owner],
      );
      await db.query("delete from signal_desk.growth_accounts where owner_id=$1", [owner]);
      await db.query(
        "delete from signal_desk.sources where opportunity_id in (select id from signal_desk.opportunities where vehicle_id='ph-contract-truck')",
      );
      await db.query(
        "delete from signal_desk.evidence_blockers where opportunity_id in (select id from signal_desk.opportunities where vehicle_id='ph-contract-truck')",
      );
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id in (select id from signal_desk.opportunities where vehicle_id='ph-contract-truck')",
      );
      await db.query("delete from signal_desk.opportunities where vehicle_id='ph-contract-truck'");
      await db.query(
        "delete from signal_desk.vehicles where owner_organization_id='ph-existing' or owner_organization_id in (select id from signal_desk.organizations where name='Private department')",
      );
      await db.query("delete from signal_desk.organizations where name='Private department'");
      await db.query("delete from signal_desk.organizations where id='ph-existing'");
      await db.query("delete from signal_desk.vehicles where id='ph-contract-truck'");
      await db.query("delete from auth.sessions where user_id=$1", [owner]);
      await db.query("delete from signal_desk.identities where user_id=$1", [owner]);
      db.release();
      await pool.end();
    }
  },
);
