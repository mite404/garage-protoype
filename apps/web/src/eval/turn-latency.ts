// Measures real specialist turns through Flue, the admitted provider and the app's own
// submit/observe operations, against a disposable local database and live OpenRouter Kimi K3.
// Usage: EVAL_DATABASE_URL=postgres://...@127.0.0.1:5433/signal_desk_eval_test \
//   npm run eval:latency -- --label baseline --runs 3 [--scenarios draft,blocker] [--db-rtt-ms 25]
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import pg, { Pool, type PoolClient } from "pg";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { instrument } from "@flue/runtime";
import {
  assertSpendRoom,
  fetchGeneration,
  initializeLedger,
  markEvent,
  observeView,
  queryKey,
  queryPhase,
  recordSpend,
  repoPath,
  requestMetrics,
  summarize,
  turnBreakdown,
  writeArtifact,
  type RequestTrace,
  type ToolTrace,
} from "./latency";

type Scenario = {
  id: string;
  message: string;
  // Synthetic, deterministic prior exchange inserted before the measured turn.
  prior?: { message: string; text: string };
};
type QueryStats = { count: number; ms: number; byPhase: Record<string, number> };
type TurnTrace = {
  t0: number;
  requests: RequestTrace[];
  tools: ToolTrace[];
  queries: Record<string, QueryStats>;
  fingerprints: Map<string, number>;
};
type StreamView = Awaited<ReturnType<Operations["readStreams"]>>[number];
type Observed = { submitted?: number; firstText?: number; firstCard?: number; completed?: number };
type Operations = Awaited<ReturnType<typeof loadOperations>>;
type Turn = Awaited<ReturnType<typeof runTurn>>;

const SPECIALIST = "90000000-0000-4000-8000-000000000001";
const SESSION = "90000000-0000-4000-8000-000000000002";
const BUYER = "90000000-0000-4000-8000-000000000003";
const OPPORTUNITY = "eval-deal";
const TURN_LIMIT_MS = 240000;
const SCENARIOS: Scenario[] = [
  { id: "blocker", message: "What is blocking this sale from closing right now?" },
  { id: "draft", message: "Prepare a seller request asking for the pump-test report." },
  {
    id: "followup",
    message: "Who needs to act on that condition, and what should happen next?",
    prior: {
      message: "What is this purchase subject to?",
      text: "The purchase is contingent on review of the pump-test report. No pump-test report is recorded yet, so that review cannot start.",
    },
  },
  {
    id: "no-tool",
    message: "Thanks. In one sentence, what does a contingent stage mean for this deal?",
  },
  { id: "evidence", message: "What is the model year?" },
];

const { values: args } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    runs: { type: "string", default: "3" },
    scenarios: { type: "string", default: SCENARIOS.map((s) => s.id).join(",") },
    // Matches the opportunity stream route's observation interval.
    "poll-ms": { type: "string", default: "350" },
    // Added to every database round trip to emulate a hosted pooler (measured ~25 ms).
    "db-rtt-ms": { type: "string", default: "0" },
    "turn-estimate-usd": { type: "string", default: "0.015" },
  },
});
const turnScope = new AsyncLocalStorage<"submit" | "observer">();
let active: TurnTrace | undefined;

function newTrace(): TurnTrace {
  return { t0: performance.now(), requests: [], tools: [], queries: {}, fingerprints: new Map() };
}

function elapsed(trace: TurnTrace) {
  return performance.now() - trace.t0;
}

function selectScenarios() {
  return args.scenarios.split(",").map((id) => {
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown scenario ${id}.`);
    return scenario;
  });
}

// Only loopback, disposable *_test databases are accepted, never a hosted project.
function databaseUrl() {
  const url = new URL(process.env.EVAL_DATABASE_URL ?? "postgres://missing");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("EVAL_DATABASE_URL must point at a loopback PostgreSQL server.");
  if (!url.pathname.endsWith("_test"))
    throw new Error("EVAL_DATABASE_URL must name a disposable database ending in _test.");
  return url;
}

// Delays server-to-client bytes so each PostgreSQL round trip pays a fixed network latency.
// A zero delay forwards bytes unchanged, so local and emulated-hosted runs share one path.
function delayed(from: Socket, to: Socket, delayMs: number) {
  if (!delayMs) return void from.pipe(to);
  let last = 0;
  from.on("data", (chunk) => {
    last = Math.max(performance.now() + delayMs, last);
    void setTimeout(last - performance.now()).then(() => to.write(chunk));
  });
}

async function latencyProxy(target: URL, delayMs: number) {
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    client.pipe(upstream);
    delayed(upstream, client, delayMs);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) socket.on("error", close).on("close", close);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const proxied = new URL(target);
  proxied.port = String((server.address() as { port: number }).port);
  return { url: proxied, close: () => server.close() };
}

function scopeStats(trace: TurnTrace, scope: string) {
  return (trace.queries[scope] ??= { count: 0, ms: 0, byPhase: {} });
}

function bump(counts: Map<string, number> | Record<string, number>, key: string) {
  if (counts instanceof Map) counts.set(key, (counts.get(key) ?? 0) + 1);
  else counts[key] = (counts[key] ?? 0) + 1;
}

function queryTimer(trace: TurnTrace, query: unknown) {
  const scope = turnScope.getStore() ?? "owner";
  const stats = scopeStats(trace, scope);
  const phase = queryPhase(trace.requests);
  bump(stats.byPhase, phase);
  bump(trace.fingerprints, queryKey(scope, phase, query));
  const started = performance.now();
  return () => {
    stats.count++;
    stats.ms += performance.now() - started;
  };
}

// pg's pool uses the callback form internally; Drizzle uses the promise form.
function timedCallback(rest: unknown[], finish: () => void) {
  const callback = rest.at(-1);
  if (typeof callback !== "function") return false;
  rest[rest.length - 1] = (...result: unknown[]) => {
    finish();
    return Reflect.apply(callback, undefined, result);
  };
  return true;
}

// Counts every PostgreSQL round trip, attributed to the submitter, observer or owner.
function countQueries() {
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...rest: unknown[]) {
    const finish = active ? queryTimer(active, rest[0]) : () => {};
    const callback = timedCallback(rest, finish);
    const result: unknown = Reflect.apply(original, this, rest);
    return callback || !(result instanceof Promise) ? result : result.finally(finish);
  } as typeof original;
}

function claimTrace(trace: TurnTrace) {
  const pending = trace.requests.findLast((r) => r.flueStart !== undefined && !r.start);
  const request = pending ?? { start: 0 };
  if (!pending) trace.requests.push(request);
  request.start = elapsed(trace);
  return request;
}

// Wraps the real OpenRouter transport to timestamp events without altering the payload.
const tracedTransport: typeof streamSimple = (model, context, options) => {
  const trace = active ?? newTrace();
  const request = claimTrace(trace);
  const upstream = streamSimple(model, context, {
    ...options,
    onPayload: async (payload, target) => {
      const next = (await options?.onPayload?.(payload, target)) ?? payload;
      request.payload = next as Record<string, unknown>;
      return next;
    },
  });
  const output = createAssistantMessageEventStream();
  void (async () => {
    for await (const event of upstream) {
      markEvent(request, event.type, elapsed(trace));
      output.push(event);
    }
    const final = await upstream.result();
    Object.assign(request, {
      end: elapsed(trace),
      stopReason: final.stopReason,
      responseId: final.responseId,
    });
    output.end(final);
  })();
  return output;
};

function traceTool<T>(trace: TurnTrace, name: string, next: () => Promise<T>) {
  const tool: ToolTrace = { name, start: elapsed(trace) };
  trace.tools.push(tool);
  return next().finally(() => {
    tool.end = elapsed(trace);
  });
}

// Flue's model operation resolves before its stream ends, so only its start is recorded.
function observeFlue() {
  instrument({
    observe: () => {},
    dispose: () => {},
    interceptor: async (operation, _context, next) => {
      if (!active) return next();
      if (operation.type === "model")
        active.requests.push({ flueStart: elapsed(active), start: 0 });
      return operation.type === "tool" ? traceTool(active, operation.toolName, next) : next();
    },
  });
}

async function seed(client: PoolClient) {
  await client.query(
    "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
    [SPECIALIST, BUYER],
  );
  await client.query("insert into auth.sessions(id,user_id) values ($1,$2)", [SESSION, SPECIALIST]);
  await client.query(await readFile(repoPath("db/demo.sql"), "utf8"));
  await client.query(
    "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ($1,'demo-pumper',$2,$3)",
    [OPPORTUNITY, BUYER, SPECIALIST],
  );
  await client.query("insert into signal_desk.opportunity_members values ($1,$2)", [
    OPPORTUNITY,
    SPECIALIST,
  ]);
  // Integer micro-USD rates bound the admitted provider's list price (US$ per million tokens).
  await client.query(`insert into signal_desk.inference_models
    (id,enabled,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
    values ('moonshotai/kimi-k3',true,200000,0,0,1000,4096,1,12,1,10,60000)`);
  await client.query(
    "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',2000000,2),($1,2000000,2)",
    [SPECIALIST],
  );
}

// Recreates the disposable database, then applies the ordered migrations and synthetic seed.
async function prepareDatabase(url: URL) {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const name = url.pathname.slice(1);
  const server = new Pool({ connectionString: admin.toString(), max: 1 });
  await server.query(`drop database if exists "${name}" with (force)`);
  await server.query(`create database "${name}"`);
  await server.end();
  const { prepareTestDatabase } = await import("../server/test-database");
  const { migrateFlue } = await import("../server/flue-storage");
  const { seedMunicipality } = await import("../server/municipality-seed");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  await client.query("begin");
  await prepareTestDatabase(client);
  await client.query("commit");
  await seed(client);
  await seedMunicipality(client, { buyerId: BUYER, opportunityId: OPPORTUNITY });
  await migrateFlue(url.toString());
  return { pool, client };
}

async function loadOperations() {
  const { resolveActor } = await import("../server/access");
  const { submitStream, readStreams } = await import("../server/streaming");
  const { beginChatTurn } = await import("../server/assistance");
  const actor = await resolveActor({ userId: SPECIALIST, sessionId: SESSION });
  return { actor, submitStream, readStreams, beginChatTurn };
}

// Every turn starts from the same seeded state, so per-turn reads do not grow across runs.
async function resetConversation(client: PoolClient, scenario: Scenario, operations: Operations) {
  for (const table of ["chat_turns", "assistance_drafts", "inquiries"])
    await client.query(`delete from signal_desk.${table} where opportunity_id=$1`, [OPPORTUNITY]);
  if (!scenario.prior) return;
  const { actor, beginChatTurn } = operations;
  const prior = await beginChatTurn(actor, OPPORTUNITY, scenario.prior.message, randomUUID());
  await client.query(
    `insert into signal_desk.stream_turns(id,opportunity_id,actor_id,credential,inquiry_id,message,revision,state,text,created_at)
     values ($1,$2,$3,$4,$5,$6,0,'completed',$7,now()-interval '1 minute')`,
    [
      prior.id,
      OPPORTUNITY,
      SPECIALIST,
      JSON.stringify(actor.credential),
      prior.inquiryId,
      prior.message,
      scenario.prior.text,
    ],
  );
}

// Polls the same read the stream route serves until the turn leaves its running states.
async function observeTurn(
  trace: TurnTrace,
  id: string,
  observed: Observed,
  operations: Operations,
) {
  for (;;) {
    const views = await turnScope.run("observer", () =>
      operations.readStreams(operations.actor, OPPORTUNITY),
    );
    const view = views.find((item) => item.id === id);
    const at = elapsed(trace);
    if (observeView(observed, view, at)) return { view: view as StreamView, completed: at };
    if (at > TURN_LIMIT_MS) throw new Error(`Turn ${id} did not finish in time.`);
    await setTimeout(Number(args["poll-ms"]));
  }
}

async function settleUsage(trace: TurnTrace, label: string) {
  for (const request of trace.requests)
    if (request.responseId) request.generation = await fetchGeneration(request.responseId);
  const costUsd = trace.requests.reduce((sum, r) => sum + (r.generation?.costUsd ?? 0), 0);
  await recordSpend(label, costUsd);
  return costUsd;
}

async function runTurn(
  scenario: Scenario,
  run: number,
  operations: Operations,
  client: PoolClient,
) {
  await resetConversation(client, scenario, operations);
  const trace = newTrace();
  active = trace;
  const observed: Observed = {};
  const key = `eval:${args.label}:${scenario.id}:${run}`;
  const turn = await turnScope.run("submit", () =>
    operations.submitStream(operations.actor, OPPORTUNITY, scenario.message, key),
  );
  observed.submitted = elapsed(trace);
  const { view, completed } = await observeTurn(trace, turn.id, observed, operations);
  observed.completed = completed;
  active = undefined;
  // Let the owner's final writes settle before the next turn resets the conversation.
  await setTimeout(300);
  const requests = trace.requests.filter((request) => request.end !== undefined);
  return {
    scenario: scenario.id,
    run,
    state: view.state,
    errorCode: view.errorCode,
    text: view.text,
    cards: view.cards.map((card) => card.kind),
    costUsd: await settleUsage(trace, key),
    firstTextMs: observed.firstText ?? null,
    firstCardMs: observed.firstCard ?? null,
    completionMs: completed,
    submitMs: observed.submitted,
    providerRequests: requests.length,
    ...turnBreakdown(requests, trace.tools, completed),
    queries: trace.queries,
    topQueries: [...trace.fingerprints.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([query, count]) => ({ count, query })),
    tools: trace.tools.map((tool) => ({ ...tool, ms: (tool.end ?? tool.start) - tool.start })),
    requests: requests.map(requestMetrics),
    // Exact provider bodies, replayed by the direct OpenRouter control.
    payloads: requests.flatMap((request) => (request.payload ? [request.payload] : [])),
  };
}

function summarizeTurns(scenario: string, turns: Turn[]) {
  const requests = turns.flatMap((turn) => turn.requests);
  return {
    scenario,
    firstTextMs: summarize(turns.map((t) => t.firstTextMs ?? Number.NaN)),
    firstCardMs: summarize(turns.map((t) => t.firstCardMs ?? Number.NaN)),
    completionMs: summarize(turns.map((t) => t.completionMs)),
    providerRequests: summarize(turns.map((t) => t.providerRequests)),
    providerMs: summarize(turns.map((t) => t.providerMs)),
    outsideProviderMs: summarize(turns.map((t) => t.outsideProviderMs)),
    beforeFirstRequestMs: summarize(turns.map((t) => t.beforeFirstRequestMs ?? Number.NaN)),
    betweenRequestsMs: summarize(turns.map((t) => t.betweenRequestsMs)),
    afterLastRequestMs: summarize(turns.map((t) => t.afterLastRequestMs)),
    ownerQueries: summarize(turns.map((t) => t.queries.owner?.count ?? 0)),
    observerQueries: summarize(turns.map((t) => t.queries.observer?.count ?? 0)),
    requestTtftMs: summarize(requests.map((r) => r.ttftMs ?? Number.NaN)),
    requestDurationMs: summarize(requests.map((r) => r.durationMs)),
    reasoningTokens: summarize(requests.map((r) => r.reasoningTokens ?? 0)),
    costUsd: turns.reduce((sum, t) => sum + t.costUsd, 0),
  };
}

async function writeReport(turns: Turn[], rtt: number) {
  const groups = [...Map.groupBy(turns, (turn) => turn.scenario).entries(), ["all", turns]];
  const summary = groups.map(([scenario, items]) =>
    summarizeTurns(String(scenario), items as Turn[]),
  );
  const at = new Date().toISOString();
  const meta = { label: args.label, at, dbRttMs: rtt, pollMs: Number(args["poll-ms"]) };
  const report = {
    ...meta,
    summary,
    turns: turns.map((turn) => ({ ...turn, payloads: undefined })),
  };
  const path = await writeArtifact(`${args.label}.json`, report);
  await writeArtifact(
    `${args.label}.payloads.json`,
    turns.map(({ scenario, run, payloads }) => ({ scenario, run, payloads })),
  );
  process.stdout.write(`${JSON.stringify(summary.at(-1), null, 1)}\nWrote ${path}\n`);
}

function logTurn(turn: Turn) {
  const ms = (value: number | null) => (value === null ? "-" : value.toFixed(0));
  process.stdout.write(
    `${turn.scenario}#${turn.run}: ${turn.state} text=${ms(turn.firstTextMs)} card=${ms(turn.firstCardMs)} done=${ms(turn.completionMs)} requests=${turn.providerRequests} US$${turn.costUsd.toFixed(5)}\n`,
  );
}

async function main() {
  const url = databaseUrl();
  const scenarios = selectScenarios();
  const rtt = Number(args["db-rtt-ms"]);
  const proxy = await latencyProxy(url, rtt);
  // The owner, observer and spending admission use the restricted runtime role only.
  const runtime = new URL(proxy.url);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  process.env.DATABASE_URL = runtime.toString();
  await initializeLedger();
  countQueries();
  const { pool, client } = await prepareDatabase(url);
  observeFlue();
  const { startStreamingOwner } = await import("../server/streaming-owner");
  const owner = await startStreamingOwner({ transport: tracedTransport });
  const operations = await loadOperations();
  const turns: Turn[] = [];
  try {
    for (let run = 1; run <= Number(args.runs); run++)
      for (const scenario of scenarios) {
        await assertSpendRoom(Number(args["turn-estimate-usd"]));
        turns.push(await runTurn(scenario, run, operations, client));
        logTurn(turns.at(-1) as Turn);
      }
  } finally {
    await owner.stop();
    client.release();
    await pool.end();
    proxy.close();
    await writeReport(turns, rtt);
  }
  process.exit(0);
}

await main();
