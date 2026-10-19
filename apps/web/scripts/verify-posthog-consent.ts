import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const session = `ph-consent-${process.pid}`;
const requests: { method: string; body: string }[] = [];
let gate = Promise.withResolvers<void>();
let releaseSdk = () => {};
let failNextCapture = false;

const fixture = `<!doctype html><html><body>
  <button id="away">Open private workspace</button><button id="back">Back to overview</button>
  <main id="controls" data-replay-safe></main>
  <script>
  // Model a regular visitor without disabling the SDK's production bot filter.
  Object.defineProperty(navigator, 'webdriver', {get: () => false});
  window.process = {env: {
    NEXT_PUBLIC_POSTHOG_ENABLED: 'true', NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_controlled_consent',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com', NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED: 'true'
  }};</script>
  <script type="module" src="/consent-probe.ts"></script>
  </body></html>`;
const probe = `
  import {createElement} from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {TelemetryPreferences} from '/src/app/telemetry-preferences.tsx';
  // Redirect only the transport. Component, startup, SDK queues and retries remain real.
  const originalFetch = window.fetch.bind(window);
  const destination = (url) => url.includes('.posthog.com/')
    ? location.origin + '/vendor' + new URL(url).pathname : url;
  window.fetch = (input, init) => originalFetch(destination(String(input)), init);
  const originalBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => originalBeacon(destination(String(url)), data);
  const root = createRoot(document.querySelector('#controls'));
  const mount = () => flushSync(() => root.render(createElement(TelemetryPreferences)));
  mount();
  document.querySelector('#away').onclick = () => {
    flushSync(() => root.render(null));
    history.pushState({}, '', '/desk/accounts?token=PRIVATE');
  };
  document.querySelector('#back').onclick = () => {
    history.pushState({}, '', '/'); mount();
  };
`;

const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "react-dom",
      "posthog-js/full/no-external",
      "@base-ui/react/button",
      "class-variance-authority",
      "cn",
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "posthog-consent-lifecycle",
      enforce: "pre",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const url = String(request.url);
          if (url === "/sdk-gate") {
            releaseSdk = () => response.end("released");
            gate.resolve();
          } else if (url.startsWith("/vendor")) {
            const chunks: Buffer[] = [];
            request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            request.on("end", () => {
              const raw = Buffer.concat(chunks);
              const body = raw[0] === 31 ? gunzipSync(raw).toString() : raw.toString();
              requests.push({ method: String(request.method), body });
              response.setHeader("Content-Type", "application/json");
              if (request.method === "POST") {
                response.statusCode = failNextCapture ? 503 : 200;
                failNextCapture = false;
              }
              response.end('{"sessionRecording":{"endpoint":"/s/","sampleRate":1}}');
            });
          } else if (url.startsWith("/?consent")) {
            response.setHeader("Content-Type", "text/html");
            response.end(fixture);
          } else next();
        });
      },
      resolveId(id, importer) {
        if (id === "posthog-js/full/no-external" && importer?.endsWith("landing-telemetry.ts"))
          return "/delayed-posthog.ts";
        if (["/consent-probe.ts", "/delayed-posthog.ts"].includes(id)) return id;
      },
      load(id) {
        if (id === "/consent-probe.ts") return probe;
        if (id === "/delayed-posthog.ts")
          return `await fetch('/sdk-gate'); window.__sdkReleased = true;
            export {PostHog} from 'posthog-js/full/no-external';`;
      },
    },
  ],
});

async function browser(...args: string[]) {
  return run("agent-browser", [
    "--session",
    session,
    "--user-agent",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ...args,
  ]);
}

try {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/?consent`;
  for (const returnToOverview of [false, true]) {
    gate = Promise.withResolvers<void>();
    requests.length = 0;
    await browser("open", url);
    await browser("set", "viewport", "1280", "720", "2");
    await browser("wait", "--text", "Allow diagnostics");
    await browser("click", '[aria-label="Usage diagnostics"] button');
    await Promise.race([
      gate.promise,
      delay(10_000, undefined, { ref: false }).then(() => {
        throw new Error("The real component must reach the delayed SDK import");
      }),
    ]);
    await browser("click", "#away");
    if (returnToOverview) await browser("click", "#back");
    releaseSdk();
    await browser("wait", "--fn", "window.__sdkReleased === true");
    await delay(250);
    assert.equal(requests.length, 0, "revoked startup must never initialize or contact PostHog");
  }

  gate = Promise.withResolvers<void>();
  requests.length = 0;
  failNextCapture = true;
  await browser("open", url);
  await browser("wait", "--text", "Allow diagnostics");
  await browser("click", '[aria-label="Usage diagnostics"] button');
  await gate.promise;
  releaseSdk();
  await browser("wait", "--text", "On for this page");
  for (let attempt = 0; attempt < 100 && failNextCapture; attempt++) await delay(100);
  assert.equal(failNextCapture, false, "a real SDK capture must fail before withdrawal");
  const acceptedBeforeStop = requests.map(({ body }) => body).join("\n");
  assert.ok(acceptedBeforeStop.includes("overview_opened"));
  await browser("click", '[aria-label="Usage diagnostics"] button');
  await browser("wait", "--text", "Off");
  await browser("click", "#away");
  await browser("click", "#back");
  await delay(4000);
  const afterStop = requests.map(({ body }) => body).join("\n");
  assert.equal(afterStop.includes("PRIVATE"), false);
  const countAfterDrain = requests.length;
  await delay(1000);
  assert.equal(
    requests.length,
    countAfterDrain,
    "disposed instance must stop retrying after drain",
  );
  await browser("click", '[aria-label="Usage diagnostics"] button');
  await browser("wait", "--text", "On for this page");
  await browser("click", '[aria-label="Usage diagnostics"] button');
  await browser("wait", "--text", "Off");
  console.log(
    "PASS: revoked lazy startup sends nothing, including away-and-back; real SDK failed/queued events drain without private content; re-consent works.",
  );
} catch (error) {
  console.error((await browser("errors")).stdout);
  console.error((await browser("console")).stdout);
  console.error((await browser("network", "requests")).stdout);
  console.error((await browser("eval", "document.body.innerText")).stdout);
  throw error;
} finally {
  releaseSdk();
  await browser("close").catch(() => undefined);
  await server.close();
}
