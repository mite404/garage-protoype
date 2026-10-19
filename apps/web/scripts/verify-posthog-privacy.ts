import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const session = `ph-privacy-${process.pid}`;
const received: string[] = [];

function unpackString(value: string): unknown {
  return value.startsWith("\u001f\u008b")
    ? unpackReplay(JSON.parse(gunzipSync(Buffer.from(value, "latin1")).toString()))
    : value;
}

function unpackReplay(value: unknown): unknown {
  if (typeof value === "string") return unpackString(value);
  if (Array.isArray(value)) return value.map(unpackReplay);
  if (value instanceof Object)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unpackReplay(item)]),
    );
  return value;
}
const fixture = `<!doctype html><html><head><title>Privacy verification</title></head><body>
  <main data-replay-safe>
    <p title="PRIVATE_ATTRIBUTE">PRIVATE_CONTACT@example.com</p>
    <input aria-label="Diagnostic probe" value="PRIVATE_INPUT">
    <input type="hidden" value="PRIVATE_TOKEN">
    <a href="/private?token=PRIVATE_QUERY">PRIVATE_LINK</a>
    <img src="data:image/svg+xml,PRIVATE_IMAGE" alt="PRIVATE_IMAGE">
    <button id="mutate">Change representative content</button>
    <button id="navigate">Open private state</button>
  </main>
  <aside>PRIVATE_DOCUMENT</aside>
  <script type="module" src="/privacy-probe.ts"></script>
  </body></html>`;
const probe = `
  import { PostHog } from 'posthog-js/full/no-external';
  import { landingTelemetryOptions } from '/src/app/landing-telemetry.ts';
  const snapshots = [];
  window.__privacyProof = {snapshots, ready: false};
  const client = new PostHog();
  client.init('phc_controlled_privacy', {
    ...landingTelemetryOptions, api_host: location.origin,
    request_batching: false, disable_compression: true, opt_out_useragent_filter: true,
    before_send(event) {
      const projected = landingTelemetryOptions.before_send(event);
      if (projected?.event === '$snapshot') snapshots.push(projected);
      return projected;
    },
  });
  client.capture('overview_opened');
  client.startSessionRecording({sampling:true, linked_flag:true, url_trigger:true, event_trigger:true});
  const candidate = {uuid:'test', event:'overview_opened', properties: {
    distinct_id:'anonymous-test', $current_url: location.href,
    $referrer:'https://example.com/PRIVATE_REFERRER', email:'PRIVATE_EMAIL'
  }};
  window.__privacyProof.event = landingTelemetryOptions.before_send(candidate);
  document.querySelector('#mutate').onclick = () => {
    document.querySelector('p').textContent = 'PRIVATE_MUTATION';
    document.querySelector('p').setAttribute('data-contact', 'PRIVATE_NEW_ATTRIBUTE');
  };
  document.querySelector('#navigate').onclick = () => {
    history.pushState({}, '', '/desk/accounts?token=PRIVATE_NAV_QUERY');
    document.body.innerHTML = '<h1>PRIVATE_WORKSPACE</h1><input value="PRIVATE_PASSWORD">';
    window.__privacyProof.privateEvent = landingTelemetryOptions.before_send(candidate);
    client.capture('overview_opened');
    requestAnimationFrame(() => {
      client.stopSessionRecording(); client.opt_out_capturing();
      window.__privacyProof.ready = true;
    });
  };
`;

const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "posthog-controlled-privacy-fixture",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const url = String(request.url);
          if (request.method === "POST") {
            const chunks: Buffer[] = [];
            request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            request.on("end", () => {
              received.push(Buffer.concat(chunks).toString());
              response.setHeader("Content-Type", "application/json");
              response.end('{"status":"Ok"}');
            });
          } else if (url.includes("/config")) {
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                hasFeatureFlags: false,
                autocapture_opt_out: true,
                capturePerformance: false,
                sessionRecording: {
                  endpoint: "/s/",
                  sampleRate: 1,
                  minimumDurationMilliseconds: 0,
                },
              }),
            );
          } else if (url === "/?token=PRIVATE_QUERY") {
            response.setHeader("Content-Type", "text/html");
            response.end(fixture);
          } else next();
        });
      },
      resolveId(id) {
        if (id === "/privacy-probe.ts") return id;
      },
      load(id) {
        if (id === "/privacy-probe.ts") return probe;
      },
    },
  ],
});
try {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== "string");
  await run("agent-browser", [
    "--session",
    session,
    "open",
    `http://127.0.0.1:${address.port}/?token=PRIVATE_QUERY`,
  ]);
  await run("agent-browser", ["--session", session, "set", "viewport", "1280", "720", "2"]);
  await run("agent-browser", [
    "--session",
    session,
    "wait",
    "--fn",
    "!!window.__privacyProof?.snapshots.length",
  ]);
  await run("agent-browser", ["--session", session, "fill", "input[aria-label]", "PRIVATE_TYPED"]);
  await run("agent-browser", ["--session", session, "click", "#mutate"]);
  await run("agent-browser", [
    "--session",
    session,
    "wait",
    "--fn",
    "window.__privacyProof.snapshots.length > 1",
  ]);
  await run("agent-browser", ["--session", session, "click", "#navigate"]);
  await run("agent-browser", ["--session", session, "wait", "--fn", "window.__privacyProof.ready"]);
  const { stdout } = await run("agent-browser", [
    "--session",
    session,
    "eval",
    "JSON.stringify(window.__privacyProof)",
  ]);
  const decoded = JSON.stringify(unpackReplay(JSON.parse(JSON.parse(stdout))));
  assert.ok(decoded.includes("anonymous-test"), "the allowed event must survive projection");
  assert.ok(
    decoded.includes("data-contact"),
    "decode and inspect real recorded attribute mutations",
  );
  assert.match(decoded, /"source":5/);
  assert.match(decoded, /"privateEvent":null/);
  assert.equal(decoded.includes("PRIVATE_"), false);
  assert.ok(
    received.some((payload) => payload.includes("overview_opened")),
    "SDK must deliver the product event to the controlled collector",
  );
  assert.ok(
    received.some((payload) => payload.includes("$snapshot")),
    "SDK must deliver replay to the controlled collector",
  );
  assert.equal(
    JSON.stringify(received.map((payload) => unpackReplay(JSON.parse(payload)))).includes(
      "PRIVATE_",
    ),
    false,
  );
  console.log(
    "PASS: real rrweb snapshots mask text, attributes, initial/typed inputs and block private subtrees; URL query and referrer omitted; private-route events dropped.",
  );
} finally {
  await run("agent-browser", ["--session", session, "close"]).catch(() => undefined);
  await server.close();
}
