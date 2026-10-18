import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveActor } from "./access";
import { prepareTestDatabase } from "./test-database";
import { getMunicipalityWorkspace, listMunicipalities } from "./municipalities";
import { seedMunicipality } from "./municipality-seed";
import { submitStream, streamPrompt } from "./streaming";
import { addSource, getWorkbench, reviewEvidence } from "./evidence";
import { startTestApp } from "./test-app";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");

test(
  "municipality projection persists metadata and excludes unassigned deals and private content",
  { skip: !url },
  async () => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const user = "81000000-0000-4000-8000-000000000001";
    const buyer = "81000000-0000-4000-8000-000000000002";
    const session = "81000000-0000-4000-8000-000000000003";
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
        [user, buyer],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, user]);
      await db.query(
        "insert into signal_desk.vehicles(id,title,internal_notes) values ('municipal-truck','Synthetic acquisition','PRIVATE VEHICLE NOTE')",
      );
      await db.query(
        "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,internal_notes) values ('municipal-deal','municipal-truck',$1,'PRIVATE DEAL NOTE'),('municipal-hidden','municipal-truck',$1,'HIDDEN DEAL')",
        [buyer],
      );
      await db.query("insert into signal_desk.opportunity_members values ('municipal-deal',$1)", [
        user,
      ]);
      await seedMunicipality(db, { buyerId: buyer, opportunityId: "municipal-deal" });
      await seedMunicipality(db, { buyerId: buyer, opportunityId: "municipal-deal" });
      await db.query(
        "insert into signal_desk.sources(id,opportunity_id,owner_id,name,media_type,content) values ('municipal-private','municipal-deal',$1,'Seller message','text/plain',$2)",
        [buyer, Buffer.from("PRIVATE SELLER MESSAGE BODY")],
      );
      const actor = await resolveActor({ userId: user, sessionId: session });
      const list = await listMunicipalities(actor);
      assert.equal(list.length, 1);
      const view = await getMunicipalityWorkspace(actor, "austin-fire-department");
      assert.equal(view.organization.name, "Austin Fire Department");
      assert.equal(view.organization.unit, "Engine 001");
      assert.equal(view.acquisitions.length, 1);
      assert.equal(view.acquisitions[0]?.terms?.amountCents, 8400000);
      assert.deepEqual(view.acquisitions[0]?.terms?.conditions, [
        "Subject to review of the pump-test report.",
      ]);
      assert.equal(view.activity.length, 2);
      assert.equal(view.ownedListings.length, 1);
      assert.doesNotMatch(
        JSON.stringify(view),
        /PRIVATE|HIDDEN|internal_notes|message|municipal-hidden/,
      );
      assert.deepEqual(view.thumbnails, {});
      const photo = await addSource(actor, "municipal-deal", {
        name: "Synthetic thumbnail permission check",
        kind: "photo",
        mediaType: "image/png",
        content: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
        audience: "sales",
        shareable: true,
        permission: "synthetic",
        provenance: "Synthetic pixel for permission testing, not vehicle evidence",
      });
      const review = {
        kind: "reviewPhoto",
        sourceId: photo.id,
        view: "front",
        readable: true,
        approved: true,
        reason: "Synthetic permission test",
      };
      const workbench = await getWorkbench(actor, "municipal-deal");
      await reviewEvidence(actor, "municipal-deal", workbench.revision, review);
      assert.deepEqual(
        (await getMunicipalityWorkspace(actor, "austin-fire-department")).thumbnails,
        {},
      );
      await db.query(
        "update signal_desk.vehicles set published_at=now() where id='municipal-truck'",
      );
      assert.deepEqual(
        (await getMunicipalityWorkspace(actor, "austin-fire-department")).thumbnails,
        {
          "municipal-truck": {
            url: `/api/v1/public/media/${photo.id}`,
            label: "Front supplied view · Reviewed readable",
          },
        },
      );
      const app = await startTestApp(user, session);
      try {
        const response = await fetch(`${app.origin}/desk/municipalities/austin-fire-department`, {
          headers: { Cookie: app.cookie },
        });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /aria-label="Municipal sales"/);
        assert.match(html, /Austin Fire Department/);
        assert.match(html, new RegExp(`/api/v1/public/media/${photo.id}`));
        assert.match(html, /Simulated deal. No payment or escrow funds held./);
        assert.doesNotMatch(
          html,
          /aria-label="Main navigation"|PRIVATE VEHICLE NOTE|PRIVATE DEAL NOTE/,
        );
      } finally {
        await app.stop();
      }
      const approved = await getWorkbench(actor, "municipal-deal");
      await reviewEvidence(actor, "municipal-deal", approved.revision, {
        ...review,
        approved: false,
      });
      assert.deepEqual(
        (await getMunicipalityWorkspace(actor, "austin-fire-department")).thumbnails,
        {},
      );
      await db.query(`insert into signal_desk.inference_models
        (id,enabled,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
        values ('moonshotai/kimi-k3',true,100000,0,0,1000,1000,1,12,1,10,10000)
        on conflict(id) do nothing`);
      for (let index = 0; index < 9; index++) {
        const turn = await submitStream(
          actor,
          "municipal-deal",
          `Earlier condition ${index}`,
          `municipality-history-${index}`,
        );
        await db.query(
          "update signal_desk.stream_turns set state='completed',text=$2,created_at=$3 where id=$1",
          [turn.id, `Prior reply ${index} ${"é".repeat(900)}`, new Date(2026, 0, index + 1)],
        );
      }
      const otherActor = await submitStream(
        actor,
        "municipal-deal",
        "OTHER ACTOR SECRET",
        "municipality-other-actor",
      );
      await db.query(
        "update signal_desk.stream_turns set actor_id=$2,state='completed' where id=$1",
        [otherActor.id, buyer],
      );
      const otherDeal = await submitStream(
        actor,
        "municipal-deal",
        "OTHER DEAL SECRET",
        "municipality-other-deal",
      );
      await db.query(
        "update signal_desk.stream_turns set opportunity_id='municipal-hidden',state='completed' where id=$1",
        [otherDeal.id],
      );
      const followup = await submitStream(
        actor,
        "municipal-deal",
        "What would clear that condition?",
        "municipality-followup",
      );
      const prompt = await streamPrompt(followup.id);
      assert.ok(prompt.history.length > 0 && prompt.history.length <= 6);
      assert.ok(Buffer.byteLength(JSON.stringify(prompt.history)) <= 8000);
      assert.equal(prompt.history.at(-1)?.message, "Earlier condition 8");
      const messages = prompt.history.map((turn) => turn.message);
      assert.deepEqual(messages, [...messages].sort());
      assert.doesNotMatch(
        JSON.stringify(prompt),
        /OTHER ACTOR|OTHER DEAL|PRIVATE|Earlier condition 0/,
      );
      assert.equal(prompt.inquiry?.input.text, "What would clear that condition?");
      assert.equal(prompt.deal?.acquisition?.terms?.amountCents, 8400000);
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id='municipal-deal'",
      );
      await assert.rejects(getMunicipalityWorkspace(actor, "austin-fire-department"), {
        code: "NOT_FOUND",
      });
      await assert.rejects(streamPrompt(followup.id), { code: "NOT_FOUND" });
      assert.deepEqual(await listMunicipalities(actor), []);
      await db.query("update signal_desk.identities set revoked_at=now() where user_id=$1", [user]);
      await assert.rejects(getMunicipalityWorkspace(actor, "austin-fire-department"), {
        code: "ACCESS_REVOKED",
      });
    } finally {
      await db.query("delete from signal_desk.sources where opportunity_id='municipal-deal'");
      await db.query(
        "delete from signal_desk.municipality_interests where organization_id='austin-fire-department'",
      );
      await db.query(
        "delete from signal_desk.opportunity_deal_terms where opportunity_id='municipal-deal'",
      );
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id='municipal-deal'",
      );
      await db.query(
        "delete from signal_desk.opportunities where id in ('municipal-deal','municipal-hidden')",
      );
      await db.query(
        "delete from signal_desk.vehicles where id in ('municipal-truck','demo-austin-owned','demo-san-antonio-interest')",
      );
      await db.query(
        "delete from signal_desk.organizations where id in ('austin-fire-department','san-antonio-fire-department')",
      );
      await db.query("delete from auth.sessions where user_id=$1", [user]);
      await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [user, buyer]);
      db.release();
      await pool.end();
    }
  },
);
