import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { prepareTestDatabase } from "./test-database";
import { resolveActor } from "./access";
import { addSource, getWorkbench, reviewEvidence } from "./evidence";
import { getPublicVehicle, getPublicPhoto } from "./records";
import { queueImport, claimImport, processImport, retryImport } from "./imports";
import { photoCoverage } from "@signal-desk/contracts/photo-schema";
import { startTestApp } from "./test-app";

const url = process.env.TEST_DATABASE_URL;
const specialist = "76000000-0000-4000-8000-000000000001";
const buyer = "76000000-0000-4000-8000-000000000002";
const session = "76000000-0000-4000-8000-000000000003";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test(
  "photo review changes coverage without publishing private originals",
  { skip: !url },
  async (t) => {
    if (!url) return;
    const pool = new Pool({ connectionString: url });
    const db = await pool.connect();
    const runtime = new URL(url);
    runtime.searchParams.set("options", "-c role=signal_desk_runtime");
    process.env.DATABASE_URL = runtime.toString();
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    try {
      await db.query(
        "insert into signal_desk.identities(user_id,role) values ($1,'specialist'),($2,'buyer')",
        [specialist, buyer],
      );
      await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, specialist]);
      await db.query(
        "insert into signal_desk.vehicles(id,title,published_at) values ('photo-truck','Photo test',now())",
      );
      await db.query(
        "insert into signal_desk.opportunities(id,vehicle_id,buyer_id) values ('photo-deal','photo-truck',$1)",
        [buyer],
      );
      await db.query("insert into signal_desk.opportunity_members values ('photo-deal',$1)", [
        specialist,
      ]);
      const actor = await resolveActor({ userId: specialist, sessionId: session });
      const input = {
        name: "Actual supplied photo",
        kind: "photo",
        mediaType: "image/png",
        content: image,
        audience: "sales",
        shareable: true,
        permission: "synthetic",
        provenance: "Synthetic pixel for operation tests, not a vehicle photo",
      };
      const photo = await addSource(actor, "photo-deal", input);
      let view = await getWorkbench(actor, "photo-deal");
      assert.equal(view.photos[0]?.effective.view, "unknown");
      assert.equal(view.coverage.filter((c) => c.state === "covered").length, 0);
      assert.deepEqual(view.photoRequest.evidenceSourceIds, [photo.id]);
      assert.equal(
        view.photoRequest.gaps.find((g) => g.view === "front")?.blockerKey,
        "photo:front",
      );
      assert.deepEqual((await getPublicVehicle("photo-truck")).photos, []);
      await t.test(
        "HTTP photo review renders actual originals and revokes public media",
        async () => {
          const app = await startTestApp(specialist, session);
          try {
            const page = await fetch(`${app.origin}/desk/opportunities/photo-deal`, {
              headers: { Cookie: app.cookie },
            });
            const html = await page.text();
            assert.match(html, /See what is still missing/);
            assert.match(html, /Live vision unavailable/);
            assert.match(html, /0<!-- --> of 8 views reviewed readable/);
            const path = `/api/v1/desk/sources/${photo.id}/content`;
            const original = await fetch(app.origin + path, { headers: { Cookie: app.cookie } });
            assert.equal(original.headers.get("Content-Type"), "image/png");
            assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);
            assert.equal((await fetch(app.origin + path)).status, 401);
            const command = {
              kind: "reviewPhoto",
              sourceId: photo.id,
              view: "front",
              readable: true,
              approved: true,
              reason: "Controlled HTTP fixture review",
            };
            const review = (revision: number, body: unknown) =>
              fetch(
                `${app.origin}/api/v1/desk/vehicles/photo-truck/reviews?opportunityId=photo-deal`,
                {
                  method: "POST",
                  headers: {
                    Cookie: app.cookie,
                    Origin: "http://signal.test",
                    "Content-Type": "application/json",
                    "If-Match": `"${revision}"`,
                  },
                  body: JSON.stringify(body),
                },
              );
            assert.equal((await review(view.revision, command)).status, 200);
            assert.equal((await review(view.revision, command)).status, 412);
            const media = await fetch(`${app.origin}/api/v1/public/media/${photo.id}`);
            assert.equal(media.status, 200);
            assert.equal(media.headers.get("Cache-Control"), "no-store");
            assert.deepEqual(Buffer.from(await media.arrayBuffer()), image);
            view = await getWorkbench(actor, "photo-deal");
            assert.equal(
              (
                await review(view.revision, {
                  ...command,
                  view: "unknown",
                  readable: false,
                  approved: false,
                })
              ).status,
              200,
            );
            assert.equal(
              (await fetch(`${app.origin}/api/v1/public/media/${photo.id}`)).status,
              404,
            );
            view = await getWorkbench(actor, "photo-deal");
          } finally {
            await app.stop();
          }
        },
      );
      view = await reviewEvidence(actor, "photo-deal", view.revision, {
        kind: "reviewPhoto",
        sourceId: photo.id,
        view: "driver_side",
        readable: true,
        approved: false,
        reason: "Specialist inspected original",
      });
      assert.equal(view.coverage.find((c) => c.view === "driver_side")?.state, "covered");
      assert.equal(view.coverage.find((c) => c.view === "passenger_side")?.state, "missing");
      const oldRevision = view.revision;
      view = await reviewEvidence(actor, "photo-deal", view.revision, {
        kind: "reviewPhoto",
        sourceId: photo.id,
        view: "odometer",
        readable: false,
        approved: false,
        reason: "Digits cannot be read",
      });
      assert.equal(view.coverage.find((c) => c.view === "driver_side")?.state, "missing");
      assert.equal(view.coverage.find((c) => c.view === "odometer")?.state, "unreadable");
      assert.match(view.photoRequest.body, /readable replacement.*odometer/i);
      assert.ok(
        view.photoRequest.gaps.find((g) => g.view === "odometer")?.sourceIds.includes(photo.id),
      );
      assert.ok(view.photoRequest.gaps.every((g) => g.blockerId));
      assert.equal(view.photoRequest.opportunityId, "photo-deal");
      await t.test(
        "worker vision suggestions remain below admission and cannot replace a correction",
        async () => {
          await db.query("update signal_desk.identities set can_spend=true where user_id=$1", [
            specialist,
          ]);
          await db.query(`insert into signal_desk.inference_models
        (id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
        values ('photo-controlled',100000,2,100,100,1000,1,1,3,10,5000)`);
          await db.query(
            "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',1000000,2),($1,1000000,2)",
            [specialist],
          );
          const queued = await queueImport(actor, "photo-deal", {
            sourceIds: [photo.id],
            model: "photo-controlled",
            key: "vision",
          });
          const lease = await claimImport(queued.id);
          assert.ok(lease);
          await processImport(lease);
          assert.equal((await getWorkbench(actor, "photo-deal")).jobs[0]?.error, "NOT_CONFIGURED");
          await retryImport(actor, queued.id);
          const recovered = await claimImport(queued.id);
          assert.ok(recovered);
          await processImport(recovered, async (request) => {
            assert.equal(request.photos[0], `data:image/png;base64,${image.toString("base64")}`);
            return {
              kind: "completed",
              output: JSON.stringify({
                claims: [],
                classifications: [],
                photos: [
                  {
                    sourceId: photo.id,
                    view: "passenger_side",
                    readable: true,
                    reason: "Controlled suggestion, not live vision",
                  },
                ],
              }),
              modelVersion: "controlled-vision-v1",
              inputTokens: 10,
              outputTokens: 10,
              reviewOutcome: "needs_review",
            };
          });
          view = await getWorkbench(actor, "photo-deal");
          assert.equal(view.jobs[0]?.state, "ready");
          assert.equal(view.photos[0]?.suggestion?.view, "passenger_side");
          assert.equal(view.photos[0]?.effective.view, "odometer");
          assert.equal(view.photos[0]?.effective.readable, false);
          assert.equal(view.coverage.find((c) => c.view === "passenger_side")?.state, "missing");
          assert.deepEqual((await getPublicVehicle("photo-truck")).photos, []);
        },
      );
      await assert.rejects(
        reviewEvidence(actor, "photo-deal", oldRevision, {
          kind: "reviewPhoto",
          sourceId: photo.id,
          view: "front",
          readable: true,
          approved: true,
          reason: "Stale",
        }),
        { status: 412 },
      );
      assert.equal((await addSource(actor, "photo-deal", input)).id, photo.id);
      assert.equal((await getWorkbench(actor, "photo-deal")).photos[0]?.effective.readable, false);
      view = await reviewEvidence(actor, "photo-deal", view.revision, {
        kind: "reviewPhoto",
        sourceId: photo.id,
        view: "odometer",
        readable: true,
        approved: true,
        reason: "Readable after inspecting full original",
      });
      const published = await getPublicVehicle("photo-truck");
      assert.equal(published.photos.length, 1);
      assert.equal(published.coverage.find((c) => c.view === "odometer")?.state, "covered");
      assert.deepEqual((await getPublicPhoto(photo.id)).content, image);
      assert.doesNotMatch(
        JSON.stringify(published),
        /provenance|sha256|\/desk\/sources|Digits cannot/,
      );
      const privatePhoto = await addSource(actor, "photo-deal", {
        ...input,
        audience: "private",
        shareable: false,
      });
      view = await getWorkbench(actor, "photo-deal");
      await assert.rejects(
        reviewEvidence(actor, "photo-deal", view.revision, {
          kind: "reviewPhoto",
          sourceId: privatePhoto.id,
          view: "front",
          readable: true,
          approved: true,
          reason: "Private cannot publish",
        }),
        { status: 403 },
      );
      await assert.rejects(
        addSource(actor, "photo-deal", { ...input, content: Buffer.from("not a photo") }),
        { status: 415 },
      );
      view = await reviewEvidence(actor, "photo-deal", view.revision, {
        kind: "reviewPhoto",
        sourceId: photo.id,
        view: "unknown",
        readable: false,
        approved: false,
        reason: "Withdraw approval",
      });
      assert.deepEqual((await getPublicVehicle("photo-truck")).photos, []);
      await assert.rejects(getPublicPhoto(photo.id), { status: 404 });
    } finally {
      await db.query(
        "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
        [specialist],
      );
      await db.query("delete from signal_desk.inference_operations where user_id=$1", [specialist]);
      await db.query(
        "delete from signal_desk.inference_budgets where scope in ('installation',$1)",
        [specialist],
      );
      await db.query("delete from signal_desk.inference_models where id='photo-controlled'");
      await db.query("delete from signal_desk.public_facts where vehicle_id='photo-truck'");
      await db.query("delete from signal_desk.sources where opportunity_id='photo-deal'");
      await db.query("delete from signal_desk.import_jobs where opportunity_id='photo-deal'");
      await db.query("delete from signal_desk.evidence_blockers where opportunity_id='photo-deal'");
      await db.query(
        "delete from signal_desk.opportunity_members where opportunity_id='photo-deal'",
      );
      await db.query("delete from signal_desk.opportunities where id='photo-deal'");
      await db.query("delete from signal_desk.vehicles where id='photo-truck'");
      await db.query("delete from auth.sessions where id=$1", [session]);
      await db.query("delete from signal_desk.identities where user_id=any($1::uuid[])", [
        [specialist, buyer],
      ]);
      db.release();
      await pool.end();
    }
  },
);

test("one image cannot fill two views and suggestions are not reviewed coverage", () => {
  const photos = [
    {
      sourceId: "first",
      sha256: "same",
      effective: { view: "driver_side", readable: true, reviewed: true, revision: 1 },
    },
    {
      sourceId: "duplicate",
      sha256: "same",
      effective: { view: "passenger_side", readable: true, reviewed: true, revision: 2 },
    },
    {
      sourceId: "suggested",
      sha256: "other",
      effective: { view: "front", readable: true, reviewed: false, revision: 3 },
    },
  ] satisfies Parameters<typeof photoCoverage>[0];
  const coverage = photoCoverage(photos);
  assert.equal(coverage.find((c) => c.view === "driver_side")?.state, "missing");
  assert.equal(coverage.find((c) => c.view === "passenger_side")?.state, "covered");
  assert.equal(coverage.find((c) => c.view === "front")?.state, "needs_review");
  assert.equal(coverage.filter((c) => c.state === "covered").length, 1);
});
