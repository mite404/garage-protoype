import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyResendEvent, normalizeFormResponse } from "./growth-integrations";
import { parseUsfaDirectory } from "./growth-scheduler";
import { boundedBody } from "./evidence-http";

test("Resend verifies original bytes, timestamp and rotated signatures", () => {
  const secret = `whsec_${Buffer.from("controlled-webhook-secret").toString("base64")}`;
  const raw = JSON.stringify({ type: "email.delivered", data: { email_id: "test-id" } });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`evt-1.${timestamp}.${raw}`)
    .digest("base64");
  const headers = new Headers({
    "svix-id": "evt-1",
    "svix-timestamp": timestamp,
    "svix-signature": `v1,invalid v1,${signature}`,
  });
  assert.equal(verifyResendEvent(raw, headers, secret).event.type, "email.delivered");
  assert.throws(() => verifyResendEvent(`${raw} `, headers, secret), { code: "INVALID_SIGNATURE" });
  headers.set("svix-timestamp", "1");
  assert.throws(() => verifyResendEvent(raw, headers, secret), { code: "INVALID_SIGNATURE" });
});

test("Forms maps the versioned labels and preserves original response IDs", () => {
  const response = {
    responseId: "form-response-1",
    lastSubmittedTime: "2026-10-19T12:00:00Z",
    answers: {
      reference: { textAnswers: { answers: [{ value: "opaque-ref" }] } },
      interest: { textAnswers: { answers: [{ value: "Need more information" }] } },
      blocker: { textAnswers: { answers: [{ value: "No blocker" }] } },
    },
  };
  const normalized = normalizeFormResponse(response, {
    reference: "reference",
    interest: "interest",
    blocker: "blocker",
    explanation: "explanation",
  });
  assert.equal(normalized.reference, "opaque-ref");
  assert.equal(normalized.original.blocker, "none");
  assert.equal(normalized.externalId, "form-response-1:2026-10-19T12:00:00Z");
});

test("USFA CSV keeps quoted names and state-qualified FDIDs without guessing contacts", () => {
  const snapshot = parseUsfaDirectory(
    'FDID, Fire dept name, HQ city, HQ state, HQ zip, Website\r\n001,"Example, District",Albany,NY,12207,https://example.test\r\n002,Excluded,Trenton,NJ,08608,\r\n',
  );
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0]!.name, "Example, District");
  assert.equal(snapshot.rows[0]!.sourceId, "NY:001");
  assert.equal("email" in snapshot.rows[0]!, false);
  assert.throws(
    () =>
      parseUsfaDirectory("FDID,Fire dept name,HQ city,HQ state,HQ zip\n,Missing,Albany,NY,12207"),
    { code: "DIRECTORY_INVALID" },
  );
});

test("provider bodies preserve signed bytes and cancel before retaining oversized chunks", async () => {
  assert.equal(await (await boundedBody(new Response("signed\r\n"), 8)).text(), "signed\r\n");
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(boundedBody(response, 8), { code: "TOO_LARGE" });
  assert.equal(cancelled, true);
});
