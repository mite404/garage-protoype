// Synthetic local stack for browser e2e runs: a disposable *_test database, a controlled
// identity provider, a gated synthetic model provider, the streaming owner and `next dev`.
// It never reads hosted credentials and never reaches Supabase, OpenRouter or Garage.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { z } from "zod";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { prepareTestDatabase } from "./server/test-database";
import { migrateFlue } from "./server/flue-storage";
import { seedMunicipality } from "./server/municipality-seed";
import { startStreamingOwner } from "./server/streaming-owner";

const config = z
  .object({
    E2E_DATABASE_URL: z
      .url()
      .refine(
        (url) =>
          ["127.0.0.1", "localhost"].includes(new URL(url).hostname) &&
          new URL(url).pathname.endsWith("_test"),
        { message: "The e2e stack only resets a loopback database whose name ends in _test." },
      ),
    E2E_SPECIALIST_EMAIL: z.email(),
    E2E_SPECIALIST_PASSWORD: z.string().min(12),
    PORT: z.coerce.number().int().positive(),
    E2E_CONTROL_PORT: z.coerce.number().int().positive(),
  })
  .parse(process.env);
const specialist = "e2e00000-0000-4000-8000-000000000001";
const buyer = "e2e00000-0000-4000-8000-000000000002";
const session = "e2e00000-0000-4000-8000-000000000003";
const opportunity = "e2e-municipal-deal";
const origin = `http://127.0.0.1:${config.PORT}`;
const identityOrigin = `http://127.0.0.1:${config.E2E_CONTROL_PORT}`;
// The first part of the answer streams immediately; the rest waits for POST /release.
const answer = {
  partial: "The pump-test report is the open blocker. ",
  rest: "Ask the seller for the signed report before replying to the buyer.",
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function accessToken() {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const claims = encode({
    sub: specialist,
    session_id: session,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${claims}.${randomBytes(32).toString("base64url")}`; // → synthetic JWT
}

function sseChunk(delta: unknown, finish_reason: string | null = null) {
  const choice = { index: 0, delta, finish_reason };
  return `data: ${JSON.stringify({ id: "synthetic", model: "moonshotai/kimi-k3", choices: [choice] })}\n\n`;
}

async function readJson(request: IncomingMessage) {
  const body: Buffer[] = [];
  for await (const bytes of request) body.push(Buffer.from(bytes));
  return JSON.parse(Buffer.concat(body).toString() || "{}") as Record<string, unknown>;
}

async function resetDatabase() {
  const pool = new Pool({ connectionString: config.E2E_DATABASE_URL, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("drop schema if exists signal_desk, signal_desk_flue, auth cascade");
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    await db.query(
      "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
      [specialist, buyer],
    );
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, specialist]);
    await db.query(
      "insert into signal_desk.vehicles(id,title,published_at) values ('e2e-truck','Synthetic e2e acquisition',now())",
    );
    await db.query(
      "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ($1,'e2e-truck',$2,$3)",
      [opportunity, buyer, specialist],
    );
    await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [
      opportunity,
      specialist,
    ]);
    await seedMunicipality(db, { buyerId: buyer, opportunityId: opportunity });
    await db.query(`insert into signal_desk.inference_models
      (id,enabled,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
      values ('moonshotai/kimi-k3',true,100000,0,0,1000,1000,1,12,1,10,30000)`);
    await db.query(
      "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',10000000,5),($1,10000000,5)",
      [specialist],
    );
  } finally {
    db.release();
    await pool.end();
  }
  await migrateFlue(config.E2E_DATABASE_URL);
}

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void> | void;

const json = (response: ServerResponse, status: number, body: unknown) =>
  void response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

// Serves the identity endpoints supabase-js calls, the synthetic model and the release gate.
function startControlServer() {
  const token = accessToken();
  const user = { id: specialist, email: config.E2E_SPECIALIST_EMAIL, is_anonymous: false };
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => (release = resolve));
  const routes: Record<string, Handler> = {
    "POST /auth/v1/token": async (request, response) => {
      const body = await readJson(request); // → { email, password, ... }
      const valid =
        body.email === config.E2E_SPECIALIST_EMAIL &&
        body.password === config.E2E_SPECIALIST_PASSWORD;
      if (!valid) return json(response, 400, { error: "invalid_grant" });
      json(response, 200, {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "synthetic-only",
        user,
      });
    },
    "GET /auth/v1/user": (request, response) =>
      request.headers.authorization === `Bearer ${token}`
        ? json(response, 200, user)
        : json(response, 401, { message: "Controlled e2e auth denied" }),
    "POST /auth/v1/logout": (_request, response) => void response.writeHead(204).end(),
    "POST /release": (_request, response) => {
      release();
      gate = new Promise<void>((resolve) => (release = resolve));
      response.writeHead(204).end();
    },
    "POST /v1/chat/completions": async (request, response) => {
      await readJson(request);
      const turnGate = gate;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(sseChunk({ content: answer.partial }));
      await turnGate;
      response.write(sseChunk({ content: answer.rest }));
      response.write(sseChunk({}, "stop"));
      const usage = { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 };
      response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      response.end("data: [DONE]\n\n");
    },
  };
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", identityOrigin).pathname;
    const handler = routes[`${request.method} ${path}`];
    if (handler) await handler(request, response);
    else json(response, 404, { message: "Not part of the synthetic e2e stack" });
  }).listen(config.E2E_CONTROL_PORT, "127.0.0.1");
}

async function main() {
  delete process.env.OPENROUTER_API_KEY;
  await resetDatabase();
  const control = startControlServer();
  await once(control, "listening");
  const runtime = new URL(config.E2E_DATABASE_URL);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  process.env.DATABASE_URL = runtime.toString();
  const owner = await startStreamingOwner({
    transport: (model, context, options) =>
      streamSimple({ ...model, baseUrl: `${identityOrigin}/v1` }, context, {
        ...options,
        apiKey: "synthetic",
      }),
  });
  const next = spawn(
    process.execPath,
    [
      "../../node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(config.PORT),
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        DATABASE_URL: runtime.toString(),
        SUPABASE_URL: identityOrigin,
        SUPABASE_PUBLISHABLE_KEY: "synthetic-e2e-key",
        APP_ORIGIN: origin,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "development",
      },
      stdio: "inherit",
    },
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (next.exitCode === null && next.signalCode === null) {
      next.kill("SIGTERM");
      await Promise.race([once(next, "exit"), setTimeout(5000)]);
    }
    await owner.stop();
    control.closeAllConnections();
    control.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  next.once("exit", () => void stop());
  process.stdout.write(`Synthetic e2e stack serving ${origin}. External sending is disabled.\n`);
}

await main();
