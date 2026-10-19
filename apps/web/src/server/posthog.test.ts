import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { assignOutreachVariant, captureBusinessEvent, captureServerError } from "./posthog";

const account = {
  scopeId: "a27f79f2-a660-46cc-8039-13376a661cdd",
  accountId: "9de1dbd2-31f6-4d79-bf69-a1815ad52936",
  synthetic: true,
};

test("PostHog exports only pseudonymous committed facts and never makes flags an exposure", async (t) => {
  const requests: { url: string; body: unknown }[] = [];
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const body: unknown = JSON.parse(
      (request.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString(),
    );
    requests.push({ url: request.url ?? "", body });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.startsWith("/flags")
          ? { featureFlags: { "reviewed-outreach-v1": "evidence_first" } }
          : { status: "Ok" },
      ),
    );
  });
  await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
  t.after(() => collector.close());
  const address = collector.address();
  assert.ok(address && typeof address !== "string");
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.POSTHOG_ENABLED = "true";
  process.env.POSTHOG_PROJECT_TOKEN = "phc_controlled_collector";
  process.env.POSTHOG_HOST = "https://us.i.posthog.com";
  process.env.POSTHOG_ID_SALT = "controlled-only-salt-at-least-32-characters";
  // Intercept only the vendor transport. The actual SDK still serializes and delivers every event.
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (url, init) =>
    originalFetch(
      `http://127.0.0.1:${address.port}${new URL(String(url)).pathname}${new URL(String(url)).search}`,
      init,
    );
  const event = {
    ...account,
    key: "private@example.com/provider-token",
    kind: "eligible",
    occurredAt: "2026-10-19T12:00:00.000Z",
    detail: "PRIVATE source document and contact email private@example.com",
  };
  delete process.env.POSTHOG_ENABLED;
  assert.equal(await captureBusinessEvent(event), false);
  assert.equal(requests.length, 0);
  process.env.POSTHOG_ENABLED = "true";
  assert.equal(await captureBusinessEvent(event), true);
  assert.equal(await captureBusinessEvent(event), true);
  assert.equal(await assignOutreachVariant(account), "evidence_first");
  assert.equal(await assignOutreachVariant(account), "evidence_first");
  assert.equal(await captureServerError("request"), true);
  assert.equal(
    await captureBusinessEvent({
      ...event,
      key: "assignment",
      kind: "assigned",
      variant: "evidence_first",
    }),
    true,
  );
  assert.equal(
    await captureBusinessEvent({
      ...event,
      key: "receipt",
      kind: "exposed",
      variant: "evidence_first",
    }),
    true,
  );
  assert.equal(
    await captureBusinessEvent({ ...event, scopeId: "b27f79f2-a660-46cc-8039-13376a661cdd" }),
    true,
  );
  const serialized = JSON.stringify(requests);
  for (const secret of [
    account.accountId,
    account.scopeId,
    "private@example.com",
    "PRIVATE",
    "provider-token",
  ])
    assert.equal(serialized.includes(secret), false, secret);
  const captures = requests.filter(({ url }) => !url.startsWith("/flags"));
  assert.equal(captures.length, 6, "evaluating a flag must not capture exposure");
  const capture = JSON.stringify(captures[0]?.body);
  assert.match(capture, /growth_eligible/);
  assert.match(capture, /\$geoip_disable/);
  const firstUuid = /"uuid":"([a-f0-9-]+)"/.exec(capture)?.[1];
  assert.match(
    firstUuid ?? "",
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.equal(
    /"uuid":"([a-f0-9-]+)"/.exec(JSON.stringify(captures[1]?.body))?.[1],
    firstUuid,
    "the actual ingestion UUID must be identical on retry",
  );
  assert.equal(JSON.stringify(captures[3]?.body).includes(String(firstUuid)), false);
  assert.equal(JSON.stringify(captures[5]?.body).includes(String(firstUuid)), false);
  assert.ok(JSON.stringify(captures[1]?.body).includes("2026-10-19T12:00:00.000Z"));
  assert.match(JSON.stringify(captures[2]?.body), /\$exception/);
  assert.equal(JSON.stringify(captures[3]?.body).includes("$feature/"), false);
  assert.match(JSON.stringify(captures[4]?.body), /\$feature\/reviewed-outreach-v1/);
  const beforeInvalid = requests.length;
  assert.equal(await captureBusinessEvent({ ...event, accountId: "email@example.com" }), false);
  process.env.POSTHOG_HOST = "https://unknown-collector.example";
  assert.equal(await captureBusinessEvent(event), false);
  assert.equal(requests.length, beforeInvalid);
  process.env.POSTHOG_HOST = "https://us.i.posthog.com";
  globalThis.fetch = async () => {
    throw new Error("PRIVATE provider credentials");
  };
  assert.equal(await captureBusinessEvent(event), false);
  assert.equal(await assignOutreachVariant(account), null);
  assert.equal(await captureServerError("stream"), false);
});
