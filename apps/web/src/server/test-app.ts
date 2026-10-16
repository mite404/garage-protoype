import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";

/** Starts a production app with a loopback-only, controlled identity provider for tests.
 * Never represents live Supabase verification; accepts only this run's exact synthetic token.
 * @throws If the build is absent or the app cannot start.
 */
export async function startTestApp(userId: string, sessionId: string) {
  const user = { id: userId, email: "review@example.test", is_anonymous: false };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: userId,
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.${randomBytes(32).toString("base64url")}`;
  const auth = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/v1/user" && request.headers.authorization === `Bearer ${token}`) {
      response.end(JSON.stringify(user));
    } else {
      response.writeHead(401).end(JSON.stringify({ message: "Controlled test auth denied" }));
    }
  }).listen(0, "127.0.0.1");
  await once(auth, "listening");
  const address = auth.address();
  assert.ok(address && typeof address === "object");
  let logs = "";
  const app = spawn(
    process.execPath,
    ["../../node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: new URL("../../", import.meta.url),
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${address.port}`,
        SUPABASE_PUBLISHABLE_KEY: "synthetic-test-key",
        APP_ORIGIN: "http://signal.test",
        NODE_OPTIONS: "--enable-source-maps",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  app.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const stop = async () => {
    if (app.exitCode === null && app.signalCode === null) {
      app.kill("SIGTERM");
      await once(app, "exit");
    }
    auth.closeAllConnections();
    await new Promise<void>((resolve) => auth.close(() => resolve()));
  };
  try {
    for (let i = 0; i < 300; i++) {
      const origin = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
      if (
        origin &&
        (await fetch(origin)
          .then((r) => r.ok)
          .catch(() => false))
      ) {
        const session = Buffer.from(
          JSON.stringify({
            access_token: token,
            refresh_token: "synthetic-only",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user,
          }),
        ).toString("base64url");
        return { origin, cookie: `sb-127-auth-token=base64-${session}`, stop };
      }
      assert.equal(app.exitCode, null, logs);
      await setTimeout(100);
    }
    throw new Error(`Test application did not become ready: ${logs}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
