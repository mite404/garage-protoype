import assert from "node:assert/strict";
import { test } from "node:test";
import { landingTelemetryOptions, startLandingTelemetry } from "./landing-telemetry";

test("browser export drops private context and rejects private routes and replay plugins", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname: "/", origin: "https://signal.test" } },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const event = {
    uuid: "synthetic-event",
    event: "overview_opened",
    properties: {
      token: "phc_controlled",
      distinct_id: "opaque-test",
      $current_url: "https://signal.test/?token=PRIVATE",
      $referrer: "https://example.com/PRIVATE",
      email: "PRIVATE@example.com",
    },
  };
  const exported = landingTelemetryOptions.before_send(event);
  assert.equal(
    exported?.properties.token,
    "phc_controlled",
    "required SDK ingestion metadata survives",
  );
  assert.equal(exported?.properties.$current_url, "https://signal.test/");
  assert.equal(JSON.stringify(exported).includes("PRIVATE"), false);
  assert.equal(landingTelemetryOptions.before_send({ ...event, event: "$autocapture" }), null);
  const replay = landingTelemetryOptions.before_send({
    ...event,
    event: "$snapshot",
    properties: {
      ...event.properties,
      $snapshot_data: [
        {
          type: 4,
          timestamp: 123,
          data: { href: "https://signal.test/PRIVATE", width: 1280, height: 720 },
        },
        { type: 2, timestamp: 124, data: { node: { textContent: "********" } } },
        { type: 6, timestamp: 125, data: { plugin: "console", payload: "PRIVATE" } },
        { type: 5, timestamp: 126, data: { tag: "PRIVATE" } },
        null,
        "PRIVATE",
        {},
      ],
    },
  });
  assert.deepEqual(replay?.properties.$snapshot_data, [
    { type: 4, timestamp: 123, data: { href: "https://signal.test/", width: 1280, height: 720 } },
    { type: 2, timestamp: 124, data: { node: { textContent: "********" } } },
  ]);
  assert.equal(landingTelemetryOptions.before_send({ ...event, event: "$snapshot" }), null);
  window.location.pathname = "/desk/accounts/private";
  assert.equal(landingTelemetryOptions.before_send(event), null);
  window.location.pathname = "/";
  const controller = new AbortController();
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  delete process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  assert.equal(await startLandingTelemetry(false, controller.signal), null);
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "personal-secret-not-a-project-token";
  assert.equal(await startLandingTelemetry(false, controller.signal), null);
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_controlled";
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://unexpected-host.example";
  assert.equal(await startLandingTelemetry(false, controller.signal), null);
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://us.i.posthog.com";
  controller.abort();
  assert.equal(await startLandingTelemetry(false, controller.signal), null);
});
