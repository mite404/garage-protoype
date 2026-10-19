import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { Pool } from "pg";
import { prepareTestDatabase } from "./test-database";
import { resolveActor } from "./access";
import {
  importDirectory,
  listProspects,
  getProspect,
  reviewProspect,
  routeProspect,
} from "./growth";
import {
  enrollSequence,
  dispatchMessage,
  stopOutreach,
  readOutreach,
  reconcileMessage,
} from "./outreach";
import { getMunicipalityWorkspace } from "./municipalities";
import { getWorkbench } from "./evidence";
import { qualifySeller } from "./sourcing";
import { inviteFeedback, submitFeedback, readFeedback } from "./feedback";
import { analyzeGrowth, readGrowthInsights } from "../agents/growth";
import { configureGrowthSchedule, sweepGrowth } from "./growth-scheduler";
import { pollFeedbackForms, receiveResendEvent, readReceivedReplies } from "./growth-integrations";
import {
  getGrowthProfile,
  getGrowthOperations,
  getAccountProfile,
  linkProspectAccount,
} from "./growth-views";
import { startTestApp } from "./test-app";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");

test(
  "NY discovery preserves source identity, corrections and scoped routing",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const owner = "91000000-0000-4000-8000-000000000001";
    const specialist = "91000000-0000-4000-8000-000000000002";
    const session = "91000000-0000-4000-8000-000000000003";
    const otherSession = "91000000-0000-4000-8000-000000000004";
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role) values ($1,'specialist'),($2,'specialist')",
        [owner, specialist],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)", [
        session,
        owner,
        otherSession,
        specialist,
      ]);
      const actor = await resolveActor({ userId: owner, sessionId: session });
      const other = await resolveActor({ userId: specialist, sessionId: otherSession });
      const snapshot = {
        source: "usfa",
        snapshot: "synthetic-2026-10-19",
        synthetic: true,
        rows: [
          {
            sourceId: "NY-001",
            name: "  Example   Fire Department ",
            city: "Albany",
            state: "NY",
            postalCode: "12207",
            website: "https://example.test",
          },
          {
            sourceId: "NJ-001",
            name: "Excluded",
            city: "Trenton",
            state: "NJ",
            postalCode: "08608",
          },
        ],
      };
      const imported = await importDirectory(actor, snapshot);
      assert.equal(imported.imported, 1);
      assert.equal(imported.excluded, 1);
      await importDirectory(actor, snapshot);
      const items = await listProspects(actor);
      assert.equal(items.length, 1);
      const id = items[0]!.id;
      assert.equal(items[0]!.name, "Example Fire Department");
      assert.equal(items[0]!.qualified, false);
      assert.equal(items[0]!.contactable, false);
      assert.deepEqual(await listProspects(other), []);
      await assert.rejects(getProspect(other, id), { code: "NOT_FOUND" });
      await assert.rejects(routeProspect(actor, id), { code: "NO_ROUTE" });
      await db.query(
        "insert into signal_desk.growth_territories(id,postal_prefix,specialist_id) values ('test-ny','122',$1)",
        [specialist],
      );
      await reviewProspect(actor, id, {
        name: "Reviewed department",
        fit: "fit",
        identity: "confirmed",
        signal: {
          text: "Synthetic procurement request for a pumper",
          source: "permissioned fixture",
          quote: "request for a pumper",
          permission: "synthetic",
        },
        contact: {
          name: "Permissioned contact",
          email: "contact@example.test",
          permission: "allowlisted_test",
          provenance: "Synthetic fixture contact; controlled provider recipient only.",
        },
      });
      await importDirectory(actor, {
        ...snapshot,
        snapshot: "synthetic-update",
        rows: [{ ...snapshot.rows[0]!, name: "Changed directory name" }],
      });
      const corrected = await getProspect(actor, id);
      assert.equal(corrected.name, "Reviewed department");
      assert.equal(corrected.observations.length, 2);
      assert.equal(corrected.qualified, false);
      const assignment = await routeProspect(actor, id);
      assert.equal(assignment.ownerId, specialist);
      await assert.rejects(getProspect(actor, id), { code: "NOT_FOUND" });
      await routeProspect(other, id);
      assert.equal((await listProspects(other)).length, 1);
      assert.equal((await getProspect(other, id)).contactable, true);
      const enrollment = await enrollSequence(other, id, {
        key: "reviewed-first-contact",
        subject: "Synthetic follow-up",
        body: "Would a reviewed pumper specification help? Reply STOP to opt out.",
      });
      assert.equal(
        (
          await enrollSequence(other, id, {
            key: "reviewed-first-contact",
            subject: "Synthetic follow-up",
            body: "Would a reviewed pumper specification help? Reply STOP to opt out.",
          })
        ).id,
        enrollment.id,
      );
      let calls = 0;
      const controlled = async () => {
        calls++;
        return { id: "controlled-resend-001" };
      };
      await assert.rejects(dispatchMessage(enrollment.id, undefined), {
        code: "DELIVERY_DISABLED",
      });
      await dispatchMessage(enrollment.id, controlled);
      await dispatchMessage(enrollment.id, controlled);
      assert.equal(calls, 1);
      assert.equal((await readOutreach(other, id)).filter((m) => m.state === "sent").length, 1);
      const second = (await readOutreach(other, id)).find((m) => m.step === 1)!;
      await db.query("update signal_desk.growth_messages set due_at=now() where id=$1", [
        second.id,
      ]);
      await assert.rejects(
        dispatchMessage(second.id, async () => {
          throw new Error("lost receipt");
        }),
        { code: "SEND_UNCERTAIN" },
      );
      await assert.rejects(dispatchMessage(second.id, controlled), { code: "SEND_UNCERTAIN" });
      assert.equal(calls, 1);
      await db.query(
        "update signal_desk.growth_messages set dispatched_at=now()-interval '25 hours' where id=$1",
        [second.id],
      );
      await assert.rejects(dispatchMessage(second.id, controlled), { code: "SEND_UNCERTAIN" });
      await reconcileMessage(other, id, {
        messageId: second.id,
        providerId: null,
        evidence: "Controlled provider confirms this attempt was not accepted",
      });
      const replied = await enrollSequence(other, id, {
        key: "reply-stop",
        subject: "Synthetic reply check",
        body: "Reply STOP to opt out.",
      });
      const secret = `whsec_${Buffer.from("controlled-growth-signature").toString("base64")}`;
      process.env.RESEND_WEBHOOK_SECRET = secret;
      process.env.RESEND_API_KEY = "controlled-never-sent";
      const raw = JSON.stringify({
        type: "email.received",
        data: { email_id: "controlled-reply" },
      });
      const stamp = Math.floor(Date.now() / 1000).toString();
      const headers = new Headers({
        "svix-id": "growth-reply-event",
        "svix-timestamp": stamp,
        "svix-signature": `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
          .update(`growth-reply-event.${stamp}.${raw}`)
          .digest("base64")}`,
      });
      let receivedCalls = 0;
      const receiving: typeof fetch = async () => {
        receivedCalls++;
        return Response.json({
          id: "controlled-reply",
          from: "contact@example.test",
          to: [`outreach+${replied.id.replace(":", "-")}@example.test`],
          text: "Yes, please send specifications",
          created_at: "2026-10-19T04:00:00Z",
        });
      };
      await receiveResendEvent(raw, headers, receiving);
      assert.equal((await receiveResendEvent(raw, headers, receiving)).duplicate, true);
      assert.equal(receivedCalls, 1);
      assert.equal(
        (await readOutreach(other, id)).filter(
          (m) => m.enrollmentKey === "reply-stop" && m.state === "stopped",
        ).length,
        2,
      );
      const publicProfile = await getGrowthProfile(other, id);
      assert.deepEqual(publicProfile.replies, [
        {
          receiptId: "growth-reply-event",
          prospectId: id,
          enrollmentKey: "reply-stop",
          channel: "email",
          receivedAt: "2026-10-19T04:00:00Z",
          text: "Yes, please send specifications",
          synthetic: true,
        },
      ]);
      await assert.rejects(readReceivedReplies(actor, id), { code: "NOT_FOUND" });
      assert.equal(JSON.stringify(publicProfile).includes("sessionId"), false);
      assert.equal(publicProfile.events.filter((e) => e.kind === "reply").length, 1);
      await stopOutreach(other, id, "opt_out");
      await assert.rejects(
        enrollSequence(other, id, { key: "another", subject: "No", body: "STOP" }),
        { code: "SUPPRESSED" },
      );
      // Qualification makes the prospect a seller: a draft listing, never a buyer opportunity.
      const sellerReply = {
        vehicleTitle: "2005 synthetic engine",
        reply: "Yes, the 2005 engine is for sale.",
        provenance: "Synthetic positive reply",
        permission: "synthetic",
      };
      await assert.rejects(qualifySeller(actor, id, sellerReply), { code: "NOT_FOUND" });
      const listing = await qualifySeller(other, id, sellerReply);
      assert.deepEqual(await qualifySeller(other, id, sellerReply), listing);
      const qualifiedSeller = await getProspect(other, id);
      assert.equal(qualifiedSeller.qualified, true);
      assert.equal(qualifiedSeller.listingVehicleId, listing.vehicleId);
      assert.equal(qualifiedSeller.opportunityId, null);
      assert.deepEqual(
        (
          await db.query(
            "select title, owner_organization_id, published_at from signal_desk.vehicles where id=$1",
            [listing.vehicleId],
          )
        ).rows,
        [
          {
            title: "2005 synthetic engine",
            owner_organization_id: listing.organizationId,
            published_at: null,
          },
        ],
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from signal_desk.opportunities where organization_id=$1",
            [listing.organizationId],
          )
        ).rows[0].count,
        0,
      );
      // The same department also buys through an assigned deal; buyer-side workflows follow it.
      await db.query(
        "insert into signal_desk.vehicles(id,title,published_at) values ('growth-truck','Synthetic pumper',now())",
      );
      const handoff = { organizationId: listing.organizationId, opportunityId: `growth-${id}` };
      await db.query(
        "insert into signal_desk.opportunities(id,organization_id,vehicle_id,assignee_id) values ($1,$2,'growth-truck',$3)",
        [handoff.opportunityId, handoff.organizationId, specialist],
      );
      await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [
        handoff.opportunityId,
        specialist,
      ]);
      await db.query("update signal_desk.growth_accounts set opportunity_id=$1 where id=$2", [
        handoff.opportunityId,
        id,
      ]);
      const workspace = await getMunicipalityWorkspace(other, handoff.organizationId);
      assert.equal(workspace.organization.name, "Reviewed department");
      assert.equal(workspace.acquisitions.length, 1);
      await getWorkbench(other, handoff.opportunityId);
      await assert.rejects(getWorkbench(actor, handoff.opportunityId), { code: "NOT_FOUND" });
      const invitation = await inviteFeedback(other, id, {
        callKey: "synthetic-call-1",
        stage: "post_call",
      });
      assert.equal(
        (await inviteFeedback(other, id, { callKey: "synthetic-call-1", stage: "post_call" })).id,
        invitation.id,
      );
      const email = {
        channel: "email",
        externalId: "reply-1",
        reference: invitation.id,
        original: "Interest: 2\nBlocker: 1",
        submittedAt: "2026-10-19T12:00:00Z",
      };
      await submitFeedback(email);
      await submitFeedback(email);
      await submitFeedback({
        channel: "forms",
        externalId: "form-1",
        reference: invitation.id,
        original: { interest: "need_information", blocker: "setup_effort", explanation: "" },
        submittedAt: "2026-10-19T12:01:00Z",
      });
      const feedback = await readFeedback(other, id);
      assert.equal(feedback.submissions.length, 2);
      assert.equal(feedback.respondents.length, 1);
      assert.equal(feedback.respondents[0]!.answer.blocker, "setup_effort");
      process.env.GROWTH_FORMS_CONFIG = JSON.stringify({
        formId: "controlled-form",
        questions: {
          reference: "ref",
          interest: "interest",
          blocker: "blocker",
          explanation: "explanation",
        },
      });
      process.env.GOOGLE_FORMS_ACCESS_TOKEN = "controlled-never-sent";
      const formRecord = (responseId: string) => ({
        responseId,
        lastSubmittedTime: "2026-10-19T12:01:30Z",
        answers: {
          ref: { textAnswers: { answers: [{ value: invitation.id }] } },
          interest: { textAnswers: { answers: [{ value: "Need more information" }] } },
          blocker: { textAnswers: { answers: [{ value: "Expected setup effort" }] } },
        },
      });
      const forms: typeof fetch = async (request) =>
        Response.json(
          new URL(String(request)).searchParams.has("pageToken")
            ? { responses: [formRecord("controlled-page-2")] }
            : { responses: [formRecord("controlled-page-1")], nextPageToken: "second" },
        );
      await pollFeedbackForms(new Date("2026-10-19T12:00:00Z"), forms);
      await pollFeedbackForms(new Date("2026-10-19T12:00:00Z"), forms);
      assert.equal((await readFeedback(other, id)).submissions.length, 4);
      assert.equal((await readFeedback(other, id)).respondents.length, 1);
      await submitFeedback({
        channel: "email",
        externalId: "reply-2",
        reference: invitation.id,
        original: "It sounds fine, but my team might struggle",
        submittedAt: "2026-10-19T12:02:00Z",
      });
      assert.equal((await readFeedback(other, id)).ambiguous.length, 1);
      assert.equal((await readFeedback(other, id)).respondents.length, 1);
      const unknown = await submitFeedback({
        ...email,
        externalId: "unknown-ref",
        reference: "unknown",
      });
      assert.equal(unknown.attributed, false);
      await db.query("update signal_desk.identities set can_spend=true where user_id=$1", [
        specialist,
      ]);
      await db.query(
        "insert into signal_desk.inference_models(id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms) values ('controlled-growth',100000,0,0,0,1000,1,1,1,100,5000) on conflict(id) do nothing",
      );
      await db.query(
        "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',10000000,2),($1,10000000,2) on conflict(scope) do nothing",
        [specialist],
      );
      let modelCalls = 0;
      const analysisProvider = async () => {
        modelCalls++;
        return {
          kind: "completed" as const,
          modelVersion: "controlled-growth",
          inputTokens: 100,
          outputTokens: 50,
          reviewOutcome: "needs_review" as const,
          output: JSON.stringify({
            themes: [
              {
                theme: "Expected effort is uncertain",
                quote: "my team might struggle",
                sourceId: "reply-2",
                uncertainty: "Not an explicit blocker selection",
                suggestion: "Offer a human-reviewed setup walkthrough",
              },
            ],
          }),
        };
      };
      await analyzeGrowth(other, id, { model: "controlled-growth", provider: analysisProvider });
      await analyzeGrowth(other, id, { model: "controlled-growth", provider: analysisProvider });
      assert.equal(modelCalls, 1);
      const insights = await readGrowthInsights(other, id);
      assert.equal(insights.length, 1);
      assert.equal(insights[0]!.result.themes[0]!.quote, "my team might struggle");
      await assert.rejects(readGrowthInsights(actor, id), { code: "NOT_FOUND" });
      await db.query(
        "update signal_desk.growth_events set created_at=now()-interval '8 days' where account_id=$1",
        [id],
      );
      await configureGrowthSchedule(other, { kind: "stalled", accountId: id });
      await sweepGrowth();
      await sweepGrowth();
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from signal_desk.evidence_blockers where id=$1",
            [`growth-stalled-${id}`],
          )
        ).rows[0].count,
        1,
      );
      assert.equal((await getGrowthOperations(other)).counts.qualified, 1);
      app = await startTestApp(
        specialist,
        otherSession,
        process.env.GROWTH_BROWSER_EVIDENCE ? 3917 : 0,
      );
      const httpHeaders = {
        Cookie: app.cookie,
        Origin: process.env.GROWTH_BROWSER_EVIDENCE ? app.origin : "http://signal.test",
        "Content-Type": "application/json",
      };
      const profileResponse = await fetch(`${app.origin}/api/v1/desk/growth?accountId=${id}`, {
        headers: httpHeaders,
      });
      assert.equal(profileResponse.status, 200);
      const httpProfile = (await profileResponse.json()).data;
      assert.equal(httpProfile.feedback.respondents.length, 1);
      assert.equal(httpProfile.insights[0].result.themes[0].quote, "my team might struggle");
      assert.equal(JSON.stringify(httpProfile).includes("sessionId"), false);
      const deniedWrite = await fetch(`${app.origin}/api/v1/desk/growth`, {
        method: "POST",
        headers: { ...httpHeaders, Origin: "https://untrusted.test" },
        body: JSON.stringify({ kind: "schedule", input: { kind: "forms" } }),
      });
      assert.equal(deniedWrite.status, 403);
      const outcome = await fetch(`${app.origin}/api/v1/desk/growth`, {
        method: "POST",
        headers: httpHeaders,
        body: JSON.stringify({
          kind: "outcome",
          accountId: id,
          input: {
            key: "controlled-outcome",
            kind: "intervention",
            detail: "Offered setup walkthrough",
            evidence: "Synthetic specialist note",
          },
        }),
      });
      assert.equal(outcome.status, 200);
      assert.equal((await getGrowthOperations(other)).counts.interventions, 1);
      if (process.env.GROWTH_BROWSER_EVIDENCE) {
        const browser = await promisify(execFile)(
          process.execPath,
          ["scripts/verify-growth-ui.mjs"],
          {
            env: {
              ...process.env,
              GROWTH_REVIEW_ORIGIN: app.origin,
              GROWTH_REVIEW_COOKIE: app.cookie,
              GROWTH_REVIEW_ACCOUNT: id,
              GROWTH_REVIEW_ORGANIZATION: handoff.organizationId,
            },
            timeout: 240000,
            maxBuffer: 100000,
          },
        );
        t.diagnostic(browser.stdout);
      }
      const scaleStarted = performance.now();
      await importDirectory(other, {
        source: "usfa",
        snapshot: "bounded-scale-synthetic",
        synthetic: true,
        rows: Array.from({ length: 120 }, (_, index) => ({
          sourceId: `growth-scale-${index}`,
          name: `Synthetic NY department ${index}`,
          city: "Albany",
          state: "NY",
          postalCode: "12207",
        })),
      });
      const page1 = await listProspects(other);
      const page2 = await listProspects(other, page1.at(-1)!.id);
      assert.equal(page1.length, 100);
      assert.equal(new Set([...page1, ...page2].map((account) => account.id)).size, 121);
      t.diagnostic(
        `Bounded synthetic exercise: 120 imports + 2 cursor pages in ${Math.round(performance.now() - scaleStarted)} ms. Not a production-scale claim.`,
      );
      await db.query(
        "insert into signal_desk.organizations(id,name,city,region,synthetic) values ('growth-seller','Synthetic seller','Albany','NY',true)",
      );
      await db.query(
        "update signal_desk.vehicles set owner_organization_id='growth-seller' where id='growth-truck'",
      );
      const sellerProspect = [...page1, ...page2].find(
        (account) => account.directory.sourceId === "growth-scale-0",
      )!;
      await assert.rejects(getAccountProfile(actor, "growth-seller"), { code: "NOT_FOUND" });
      await linkProspectAccount(other, sellerProspect.id, { organizationId: "growth-seller" });
      await linkProspectAccount(other, sellerProspect.id, { organizationId: "growth-seller" });
      const conflictingMatch = [...page1, ...page2].find(
        (account) => account.directory.sourceId === "growth-scale-1",
      )!;
      await assert.rejects(
        linkProspectAccount(other, conflictingMatch.id, { organizationId: "growth-seller" }),
        { code: "MATCH_CONFLICT" },
      );
      const seller = await getAccountProfile(other, "growth-seller");
      assert.equal(seller.deals[0]!.relationship, "seller");
      assert.equal(seller.growth!.account.id, sellerProspect.id);
      assert.equal(seller.growth!.account.qualified, false);
      assert.equal(
        (await getAccountProfile(other, handoff.organizationId)).deals[0]!.relationship,
        "buyer",
      );
      const reviewed = (await getProspect(other, id)).review!;
      await reviewProspect(other, sellerProspect.id, {
        ...reviewed,
        contact: { ...reviewed.contact!, email: "bounce@example.test" },
      });
      // A matched seller's listing belongs to its existing department, not a new organization.
      const matchedListing = await qualifySeller(other, sellerProspect.id, {
        ...sellerReply,
        vehicleTitle: "Matched seller's synthetic tanker",
      });
      assert.equal(matchedListing.organizationId, "growth-seller");
      assert.equal(
        (await getAccountProfile(other, "growth-seller")).growth!.account.qualified,
        true,
      );
      const bounceEnrollment = await enrollSequence(other, sellerProspect.id, {
        key: "bounce-stop",
        subject: "Controlled bounce",
        body: "Synthetic only. Reply STOP to opt out.",
      });
      await dispatchMessage(bounceEnrollment.id, async () => ({ id: "controlled-bounce" }));
      for (const kind of ["email.delivered", "email.bounced"]) {
        const eventId = `growth-delivery-${kind}`;
        const delivery = JSON.stringify({ type: kind, data: { email_id: "controlled-bounce" } });
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
          .update(`${eventId}.${timestamp}.${delivery}`)
          .digest("base64");
        const deliveryHeaders = new Headers({
          "svix-id": eventId,
          "svix-timestamp": timestamp,
          "svix-signature": `v1,${signature}`,
        });
        assert.equal((await receiveResendEvent(delivery, deliveryHeaders)).duplicate, false);
        assert.equal((await receiveResendEvent(delivery, deliveryHeaders)).duplicate, true);
        assert.equal(
          (await readOutreach(other, sellerProspect.id)).filter((m) => m.state === "queued").length,
          kind === "email.delivered" ? 1 : 0,
        );
      }
      await assert.rejects(
        enrollSequence(other, sellerProspect.id, {
          key: "after-bounce",
          subject: "Blocked",
          body: "STOP",
        }),
        { code: "SUPPRESSED" },
      );
      await reviewProspect(other, conflictingMatch.id, {
        ...reviewed,
        contact: { ...reviewed.contact!, email: "revoked@example.test" },
      });
      const revokedEnrollment = await enrollSequence(other, conflictingMatch.id, {
        key: "revoked-due",
        subject: "Must not dispatch",
        body: "Synthetic only. STOP",
      });
      await db.query("update signal_desk.identities set revoked_at=now() where user_id=$1", [
        specialist,
      ]);
      Object.assign(process.env, {
        GROWTH_DELIVERY_MODE: "allowlisted-test",
        RESEND_FROM: "synthetic@example.test",
        RESEND_REPLY_DOMAIN: "example.test",
        GROWTH_TEST_ALLOWLIST: "revoked@example.test",
      });
      const originalFetch = globalThis.fetch;
      let unauthorizedRequests = 0;
      globalThis.fetch = async () => {
        unauthorizedRequests++;
        throw new Error("No external requests are allowed in this revocation check");
      };
      try {
        await sweepGrowth();
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(unauthorizedRequests, 0);
      assert.equal(
        (
          await db.query("select state from signal_desk.growth_messages where id=$1", [
            revokedEnrollment.id,
          ])
        ).rows[0].state,
        "stopped",
      );
      await assert.rejects(getProspect(other, id), { code: "ACCESS_REVOKED" });
      await assert.rejects(getGrowthProfile(other, id), { code: "ACCESS_REVOKED" });
      await assert.rejects(readReceivedReplies(other, id), { code: "ACCESS_REVOKED" });
      await assert.rejects(dispatchMessage(replied.id, controlled), { code: "ACCESS_REVOKED" });
      assert.equal(
        (await fetch(`${app.origin}/api/v1/desk/growth?accountId=${id}`, { headers: httpHeaders }))
          .status,
        403,
      );
    } finally {
      await app?.stop();
      delete process.env.RESEND_WEBHOOK_SECRET;
      delete process.env.RESEND_API_KEY;
      delete process.env.GROWTH_DELIVERY_MODE;
      delete process.env.RESEND_FROM;
      delete process.env.RESEND_REPLY_DOMAIN;
      delete process.env.GROWTH_TEST_ALLOWLIST;
      delete process.env.GROWTH_FORMS_CONFIG;
      delete process.env.GOOGLE_FORMS_ACCESS_TOKEN;
      await db.query(
        "delete from signal_desk.growth_receipts where id='growth-reply-event' or id like 'growth-delivery-%' or id like 'forms:controlled-page-%' or message_id in (select id from signal_desk.growth_messages where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:growth-scale-%'))",
      );
      await db.query(
        "delete from signal_desk.growth_feedback where external_id like 'controlled-page-%'",
      );
      await db.query(
        "delete from signal_desk.growth_events where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:growth-scale-%')",
      );
      await db.query(
        "delete from signal_desk.growth_messages where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:growth-scale-%')",
      );
      await db.query(
        "delete from signal_desk.growth_observations where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:growth-scale-%')",
      );
      await db.query(
        "delete from signal_desk.growth_accounts where source_key like 'usfa:growth-scale-%'",
      );
      await db.query("delete from signal_desk.growth_schedules where actor_id in ($1,$2)", [
        owner,
        specialist,
      ]);
      await db.query(
        "delete from signal_desk.growth_insights where account_id in (select id from signal_desk.growth_accounts where source_key='usfa:NY-001')",
      );
      await db.query(
        "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
        [specialist],
      );
      await db.query("delete from signal_desk.inference_operations where user_id=$1", [specialist]);
      await db.query("delete from signal_desk.inference_models where id='controlled-growth'");
      await db.query(
        "delete from signal_desk.inference_budgets where scope in ('installation',$1)",
        [specialist],
      );
      await db.query(
        "delete from signal_desk.growth_feedback where external_id in ('reply-1','reply-2','form-1','unknown-ref')",
      );
      await db.query(
        "delete from signal_desk.growth_invitations where account_id in (select id from signal_desk.growth_accounts where source_key='usfa:NY-001')",
      );
      await db.query(
        "delete from signal_desk.growth_receipts where message_id in (select id from signal_desk.growth_messages where account_id in (select id from signal_desk.growth_accounts where source_key='usfa:NY-001'))",
      );
      await db.query(
        "delete from signal_desk.growth_messages where account_id in (select id from signal_desk.growth_accounts where source_key='usfa:NY-001')",
      );
      await db.query(
        "delete from signal_desk.growth_suppressions where email in ('contact@example.test','bounce@example.test')",
      );
      await db.query(
        "delete from signal_desk.growth_events where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:NY-001')",
      );
      await db.query(
        "delete from signal_desk.growth_observations where account_id in (select id from signal_desk.growth_accounts where source_key like 'usfa:NY-001')",
      );
      await db.query("delete from signal_desk.growth_accounts where source_key='usfa:NY-001'");
      await db.query("delete from signal_desk.sources where opportunity_id like 'growth-%'");
      await db.query(
        "delete from signal_desk.evidence_blockers where opportunity_id like 'growth-%'",
      );
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id like 'growth-%'",
      );
      await db.query("delete from signal_desk.opportunities where id like 'growth-%'");
      await db.query(
        "update signal_desk.vehicles set owner_organization_id=null where id='growth-truck'",
      );
      await db.query("delete from signal_desk.vehicles where id like 'listing-%'");
      await db.query("delete from signal_desk.organizations where id like 'growth-%'");
      await db.query("delete from signal_desk.vehicles where id='growth-truck'");
      await db.query("delete from signal_desk.growth_territories where id='test-ny'");
      await db.query("delete from auth.sessions where user_id in ($1,$2)", [owner, specialist]);
      await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [
        owner,
        specialist,
      ]);
      db.release();
      await pool.end();
    }
  },
);
