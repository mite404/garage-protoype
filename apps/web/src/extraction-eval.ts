import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { resolveActor, type Actor } from "./server/access";
import { addSource } from "./server/evidence";
import {
  corpusSchema,
  eth79Packet,
  predictedClaims,
  scoreClaims,
  scoreLocators,
  scoreRun,
  summarize,
  type Packet,
  type RunResult,
} from "./server/extraction-scoring";
import { documentBytes, pageImages } from "./server/extraction-fixtures";
import { claimImport, processImport, queueImport } from "./server/imports";
import { reconcileInference, runInference } from "./server/model";
import {
  openRouterChatRequest,
  openRouterOutcome,
  openRouterProvider,
  type OpenRouterReceipt,
} from "./server/openrouter";
import { prepareTestDatabase } from "./server/test-database";

// Synthetic evaluation identities, used only in a disposable *_test database.
const specialist = "79100000-0000-4000-8000-000000000001";
const buyer = "79100000-0000-4000-8000-000000000002";
const session = "79100000-0000-4000-8000-000000000003";
const defaultModels = [
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
  "deepseek/deepseek-v4.1-flash",
];
// The hard cap is US$1.00; stop with margin for usage that is reported late.
const capUsd = 0.9;
const api = "https://openrouter.ai/api/v1";
const corpusUrl = new URL("./server/extraction-corpus/corpus.json", import.meta.url);
const publicUrl = new URL("./server/extraction-corpus/public-documents.json", import.meta.url);
const fixtureUrl = (name: string) => new URL(`./server/extraction-corpus/${name}`, import.meta.url);
// Integer micro-USD rates cannot express sub-$1/M prices, so 1 per token overstates every model.
const policy = {
  max_input_bytes: 200000,
  max_photos: 2,
  photo_tokens: 8000,
  overhead_tokens: 3000,
  max_output_tokens: 6000,
  input_micro_usd: 1,
  output_micro_usd: 1,
  max_attempts: 1,
  retry_ms: 1000,
  // Below the worker's fixed 60-second lease, and the policy schema's 60-second ceiling.
  timeout_ms: 55000,
};
const endpoints = z.object({
  data: z.object({
    endpoints: z.array(
      z.object({ pricing: z.object({ prompt: z.coerce.number(), completion: z.coerce.number() }) }),
    ),
  }),
});
const batchSchema = z.object({
  id: z.string(),
  status: z.string(),
  created_at: z.number(),
  finalized_at: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  usage: z.object({ cost: z.number().optional() }).nullable().optional(),
  results: z
    .array(
      z.object({
        response: z.object({ status_code: z.number(), body: z.unknown() }).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});
const resultBody = z.object({ usage: z.record(z.string(), z.unknown()) }).passthrough();
const completedBatch = z.object({
  status: z.literal("completed"),
  created_at: z.number(),
  finalized_at: z.number(),
  usage: z.object({ cost: z.number() }),
  results: z.tuple([
    z.object({ response: z.object({ status_code: z.literal(200), body: resultBody }) }),
  ]),
});
const errorCode = z.object({ code: z.string() });
const terminal = new Set(["completed", "failed", "expired", "cancelled"]);
const exactly = "quote excerpts exactly as printed";
const settleMs = 10 * 60_000;
const probes = {
  scanned: {
    corpus: "synthetic",
    document: "D08",
    mediaType: "image/jpeg",
    note: `is a scanned page with no text layer. Read the image, cite page 1, and ${exactly}`,
    attachments: async () => [await readFile(fixtureUrl("scanned-page.jpg"))],
  },
  pdf: {
    corpus: "synthetic",
    document: "D05",
    mediaType: "application/pdf",
    note: `is a PDF file without a separate text layer. Cite its one-based pages and ${exactly}`,
    attachments: async (doc: Doc) => [(await documentBytes(doc)).content],
  },
  "public-image": {
    corpus: "public",
    document: "S1",
    mediaType: "image/jpeg",
    note: `are a brochure's page images in order, with no text layer. Cite one-based pages and ${exactly}`,
    attachments: pageImages,
  },
} as const;
type ProbeKind = keyof typeof probes;
// Unreconciled calls are carried at their worst case until a receipt replaces them.
type Ledger = {
  baselineKeyUsageUsd: number;
  entries: { tag: string; costUsd: number; uncertain?: boolean }[];
};
type Adapter = Parameters<typeof openRouterProvider>[0];
type Context = {
  pool: Pool;
  db: PoolClient;
  actor: Actor;
  out: string;
  runId: string;
  prices: Map<string, { prompt: number; completion: number }>;
  ledger: Ledger;
  adapter: Adapter;
  corpora: Record<"synthetic" | "public", z.infer<typeof corpusSchema>>;
};
type Batch = z.infer<typeof batchSchema>;
type BatchState = { batch?: Batch; attemptId?: string; submit?: object };
type Doc = Packet["documents"][number];
type ClaimRow = {
  source_id: string;
  field: string;
  value: string;
  unit: string;
  page: number;
  start_offset: number;
  end_offset: number;
  excerpt: string;
};

function slug(text: string) {
  return text.replace(/\W+/g, "-");
}

function spent(ledger: Ledger) {
  return ledger.entries.reduce((total, entry) => total + entry.costUsd, 0);
}

function code(error: unknown) {
  return errorCode.safeParse(error).data?.code ?? String(error);
}

function corpusDocument(corpus: z.infer<typeof corpusSchema>, id: string) {
  const packet = corpus.packets.find((p) => p.documents.some((doc) => doc.id === id));
  const doc = packet?.documents.find((d) => d.id === id);
  if (!packet || !doc) throw new Error(`Corpus lacks ${id}.`);
  return { packet, doc };
}

// Batch results report the charge at batch level; this probe sends one request per batch.
function batchOutcome(batch: Batch) {
  const done = completedBatch.safeParse(batch);
  if (!done.success) return null;
  const { body } = done.data.results[0].response;
  const cost = z.number().catch(done.data.usage.cost).parse(body.usage.cost);
  const latency = (done.data.finalized_at - done.data.created_at) * 1000;
  return openRouterOutcome({ ...body, usage: { ...body.usage, cost } }, latency);
}

// Unsettled attempts have no report yet.
function completedOutput(report: { kind: string; output?: string } | null) {
  return report?.kind === "completed" ? (report.output ?? "") : "";
}

// No receipt for a dispatched call means the provider may still bill it at its worst case.
function charge(receipt: OpenRouterReceipt | undefined, dispatched: boolean, worst: number) {
  if (receipt) return { cost: receipt.costUsd, uncertain: false };
  return dispatched ? { cost: worst, uncertain: true } : { cost: 0, uncertain: false };
}

function batchBody(chat: NonNullable<ReturnType<typeof openRouterChatRequest>>, model: string) {
  // Batch routing is chosen per batch; streaming and per-request routing are rejected.
  const { stream: _stream, provider: _provider, ...body } = chat;
  return { ...body, model };
}

function adapterOptions(effort?: string, sort?: string): Adapter {
  const efforts = z.enum(["none", "low", "medium", "high"]);
  const sorts = z.enum(["price", "throughput", "latency"]);
  return {
    ...(effort ? { reasoningEffort: efforts.parse(effort) } : {}),
    ...(sort ? { sort: sorts.parse(sort) } : {}),
  };
}

async function keyUsage() {
  const response = await fetch(`${api}/key`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  const body = z.object({ data: z.object({ usage: z.number() }) }).parse(await response.json());
  return body.data.usage;
}

async function loadLedger(out: string): Promise<Ledger> {
  const saved = await readFile(`${out}/ledger.json`, "utf8").catch(() => null);
  if (saved) return JSON.parse(saved) as Ledger;
  return { baselineKeyUsageUsd: await keyUsage(), entries: [] };
}

async function record(ctx: Context, tag: string, spend: { cost: number; uncertain: boolean }) {
  const entry = { tag, costUsd: spend.cost };
  // A settled receipt replaces the worst case carried for the same call.
  const others = ctx.ledger.entries.filter((e) => e.tag !== tag);
  ctx.ledger.entries = [...others, spend.uncertain ? { ...entry, uncertain: true } : entry];
  await writeFile(`${ctx.out}/ledger.json`, JSON.stringify(ctx.ledger, null, 2));
}

// Stops before any call whose worst case could cross the cap; returns that worst case.
function guard(ctx: Context, model: string, inputBytes: number) {
  const price = ctx.prices.get(model.replace(/:batch$/, ""));
  if (!price) throw new Error(`No OpenRouter pricing for ${model}.`);
  const worst =
    (inputBytes + policy.photo_tokens + policy.overhead_tokens) * price.prompt +
    policy.max_output_tokens * price.completion;
  if (spent(ctx.ledger) + worst > capUsd)
    throw new Error(`Spend cap: ${spent(ctx.ledger).toFixed(4)} spent, next up to ${worst}.`);
  return worst;
}

// Uses the most expensive endpoint serving each model as the worst case.
async function maxPrices(models: string[]) {
  const prices = new Map<string, { prompt: number; completion: number }>();
  for (const model of models) {
    const response = await fetch(`${api}/models/${model}/endpoints`);
    const list = endpoints.parse(await response.json()).data.endpoints;
    prices.set(model, {
      prompt: Math.max(...list.map((e) => e.pricing.prompt)),
      completion: Math.max(...list.map((e) => e.pricing.completion)),
    });
  }
  return prices;
}

function requireLocalTest(url: string) {
  const target = new URL(url);
  const local = ["", "localhost", "127.0.0.1"].includes(target.hostname);
  if (!local || !target.pathname.endsWith("_test"))
    throw new Error("Evaluation requires a local disposable database ending in _test.");
  const runtime = new URL(url);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  // Overrides any hosted DATABASE_URL before the first application query.
  process.env.DATABASE_URL = runtime.toString();
}

async function seed(db: PoolClient, models: string[]) {
  await db.query(
    `insert into signal_desk.identities(user_id,role,can_spend)
     values ($1,'specialist',true),($2,'buyer',false) on conflict do nothing`,
    [specialist, buyer],
  );
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2) on conflict do nothing", [
    session,
    specialist,
  ]);
  // Policy edits apply to existing rows so later runs never test a stale limit.
  for (const id of models.flatMap((model) => [model, `${model}:batch`]))
    await db.query(
      `insert into signal_desk.inference_models
       (id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,
        input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set max_input_bytes=excluded.max_input_bytes,
         max_photos=excluded.max_photos,timeout_ms=excluded.timeout_ms`,
      [id, ...Object.values(policy)],
    );
  // The accounting ledger persists across runs; integer rates make it an overestimate.
  await db.query(
    `insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent)
     values ('installation',1000000,12),($1,1000000,12) on conflict do nothing`,
    [specialist],
  );
}

async function prepare(url: string, models: string[]) {
  requireLocalTest(url);
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  await db.query("begin");
  await prepareTestDatabase(db);
  await db.query("commit");
  await seed(db, models);
  return { pool, db };
}

async function opportunity(db: PoolClient, tag: string, title: string) {
  await db.query("insert into signal_desk.vehicles(id,title) values ($1,$2)", [
    tag,
    `${title} (synthetic)`,
  ]);
  await db.query(
    "insert into signal_desk.opportunities(id,vehicle_id,buyer_id) values ($1,$1,$2)",
    [tag, buyer],
  );
  await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [tag, specialist]);
}

async function addDocument(ctx: Context, tag: string, doc: Doc) {
  try {
    const source = await addSource(ctx.actor, tag, {
      name: doc.name,
      kind: doc.kind,
      ...(await documentBytes(doc)),
      audience: "sales",
      shareable: ["document", "seller_note"].includes(doc.kind),
      ...(doc.file
        ? { permission: "permissioned", provenance: "Public document fixture supplied by Ethan." }
        : { permission: "synthetic", provenance: "Synthetic extraction evaluation corpus." }),
    });
    return { id: source.id };
  } catch (error) {
    return { rejected: code(error) };
  }
}

async function addDocuments(ctx: Context, tag: string, packet: Packet) {
  const sources = new Map<string, string>();
  const rejected: { document: string; code: string }[] = [];
  for (const doc of packet.documents) {
    const added = await addDocument(ctx, tag, doc);
    if (added.id) sources.set(doc.id, added.id);
    else rejected.push({ document: doc.id, code: added.rejected ?? "" });
  }
  return { sources, rejected };
}

async function jobInput(db: PoolClient, jobId: string) {
  const row = await db.query<{ input: string }>(
    "select input from signal_desk.import_jobs where id=$1",
    [jobId],
  );
  return row.rows[0]?.input ?? "";
}

async function readJob(db: PoolClient, jobId: string, sourceIds: string[]) {
  const job = await db.query<{ state: string; error: string | null }>(
    "select state,error from signal_desk.import_jobs where id=$1",
    [jobId],
  );
  const attempt = await db.query<{
    state: string;
    report: { kind: string; output?: string } | null;
  }>(
    `select a.state,a.report from signal_desk.inference_attempts a
     join signal_desk.inference_operations o on o.id=a.operation_id where o.request_key=$1`,
    [`import:${jobId}`],
  );
  const claims = await db.query<ClaimRow>("select * from signal_desk.claims where job_id=$1", [
    jobId,
  ]);
  const pages = await db.query<{ id: string; pages: string[] }>(
    "select id,pages from signal_desk.sources where id=any($1)",
    [sourceIds],
  );
  return { job: job.rows[0], attempt: attempt.rows[0], claims: claims.rows, pages: pages.rows };
}

async function jobResult(db: PoolClient, jobId: string, sources: Map<string, string>) {
  const documents = new Map([...sources].map(([doc, source]) => [source, doc]));
  const docOf = (sourceId: string) => documents.get(sourceId) ?? "";
  const rows = await readJob(db, jobId, [...sources.values()]);
  const run: RunResult = {
    output: rows.attempt ? completedOutput(rows.attempt.report) : "",
    committed: rows.claims.map((claim) => ({
      document: docOf(claim.source_id),
      field: claim.field,
      value: claim.value,
      unit: claim.unit,
      page: claim.page,
      start: claim.start_offset,
      end: claim.end_offset,
      excerpt: claim.excerpt,
    })),
    pages: new Map(rows.pages.map((row) => [docOf(row.id), row.pages])),
    reached: new Set(sources.keys()),
    documents,
  };
  return { job: rows.job, attemptState: rows.attempt?.state, run };
}

async function leaseImport(ctx: Context, tag: string, model: string, sourceIds: string[]) {
  const job = await queueImport(ctx.actor, tag, { sourceIds, model, key: tag });
  const worst = guard(ctx, model, Buffer.byteLength(await jobInput(ctx.db, job.id)));
  const lease = await claimImport(job.id);
  if (!lease) throw new Error(`Import ${job.id} could not be leased.`);
  return { lease, worst };
}

async function saveOutput(ctx: Context, tag: string, output: string | null) {
  await writeFile(`${ctx.out}/raw/${tag}.json`, output || "(no completed output)");
}

async function runPacket(ctx: Context, suite: string, packet: Packet, model: string, rep: number) {
  const tag = `${ctx.runId}-${suite}-${packet.id}-${slug(model)}-r${rep}`;
  await opportunity(ctx.db, tag, packet.title);
  const { sources, rejected } = await addDocuments(ctx, tag, packet);
  if (sources.size === 0) throw new Error(`${tag} has no importable sources.`);
  const { lease, worst } = await leaseImport(ctx, tag, model, [...sources.values()]);
  const receipts: OpenRouterReceipt[] = [];
  const provider = openRouterProvider({ ...ctx.adapter, onReceipt: (r) => receipts.push(r) });
  const started = performance.now();
  await processImport(lease, provider);
  const wallMs = Math.round(performance.now() - started);
  const result = await jobResult(ctx.db, lease.id, sources);
  const dispatched = !["not-billed", undefined].includes(result.attemptState);
  await record(ctx, tag, charge(receipts[0], dispatched, worst));
  await saveOutput(ctx, tag, result.run.output);
  return {
    suite,
    packet: packet.id,
    model,
    rep,
    documents: sources.size,
    rejected,
    jobState: result.job?.state,
    jobError: result.job?.error,
    attemptState: result.attemptState,
    wallMs,
    receipt: receipts[0],
    ...scoreRun(packet, result.run),
  };
}

async function frozenInstruction(db: PoolClient) {
  const row = await db.query<{ input: string }>(
    "select input from signal_desk.import_jobs where mode='provider' order by created_at desc limit 1",
  );
  if (!row.rows[0]) throw new Error("Run the eth79 suite first so a frozen instruction exists.");
  return z.object({ instruction: z.string() }).parse(JSON.parse(row.rows[0].input)).instruction;
}

function capturingFetch(log: { status: number; error?: string }[]): typeof fetch {
  return async (url, init) => {
    const response = await fetch(url, init);
    const error = response.ok ? undefined : (await response.clone().text()).slice(0, 400);
    log.push({ status: response.status, ...(error ? { error } : {}) });
    return response;
  };
}

async function probeInference(ctx: Context, request: Parameters<typeof runInference>[1]) {
  const http: { status: number; error?: string }[] = [];
  const receipts: OpenRouterReceipt[] = [];
  const provider = openRouterProvider({
    ...ctx.adapter,
    fetch: capturingFetch(http),
    onReceipt: (r) => receipts.push(r),
  });
  const result = await runInference(ctx.actor, request, provider).then(
    (report) => ({ output: report.output, error: undefined }),
    (error: unknown) => ({ output: "", error: code(error) }),
  );
  return { ...result, http, receipt: receipts[0] };
}

async function probeRequest(ctx: Context, kind: ProbeKind, doc: Doc, tag: string) {
  const spec = probes[kind];
  const sourceId = `${kind}-probe`;
  const note = `PROBE: The attachments for source ${sourceId} ${spec.note}.`;
  const instruction = `${await frozenInstruction(ctx.db)} ${note}`;
  const source = { id: sourceId, kind: "document", mediaType: spec.mediaType, pages: [] };
  const input = JSON.stringify({ instruction, sources: [{ ...source, provenance: spec.corpus }] });
  const photos = (await spec.attachments(doc)).map(
    (bytes) => `data:${spec.mediaType};base64,${bytes.toString("base64")}`,
  );
  const request = { key: tag, opportunityId: tag, input, photos };
  const bytes = [input, ...photos].reduce((total, part) => total + Buffer.byteLength(part), 0);
  return { sourceId, request, bytes };
}

async function probe(ctx: Context, kind: ProbeKind, model: string) {
  const spec = probes[kind];
  const { packet, doc } = corpusDocument(ctx.corpora[spec.corpus], spec.document);
  const tag = `${ctx.runId}-probe-${kind}-${slug(model)}`;
  await opportunity(ctx.db, tag, `${kind} probe`);
  const { sourceId, request, bytes } = await probeRequest(ctx, kind, doc, tag);
  const worst = guard(ctx, model, bytes);
  const result = await probeInference(ctx, { ...request, model });
  // Admission can reject before any HTTP call; only an accepted request can bill.
  const dispatched = result.http.some((h) => h.status === 200);
  await record(ctx, tag, charge(result.receipt, dispatched, worst));
  await saveOutput(ctx, tag, result.output);
  const claims = predictedClaims(result.output, new Map([[sourceId, doc.id]])).claims;
  return {
    suite: kind,
    model,
    http: result.http,
    error: result.error,
    receipt: result.receipt,
    value: scoreClaims(packet, claims, new Set([doc.id])).value,
    // Judged against the true printed text; a scan has no stored text layer to cite.
    excerpts: scoreLocators(claims, new Map([[doc.id, doc.pages]])),
  };
}

async function submitBatch(body: object, model: string, attemptId: string) {
  const response = await fetch(`${api}/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    // The Batch API requires endpoint, model and provider before requests.
    body: JSON.stringify({
      endpoint: "/v1/chat/completions",
      model,
      provider: { allow_fallbacks: false },
      requests: [{ custom_id: attemptId, body }],
    }),
  });
  if (response.ok) return { batch: batchSchema.parse(await response.json()) };
  return { status: response.status, error: (await response.text()).slice(0, 400) };
}

async function pollBatch(id: string, signal?: AbortSignal) {
  for (;;) {
    const response = await fetch(`${api}/batches/${id}`, {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      signal,
    });
    const batch = batchSchema.parse(await response.json());
    if (terminal.has(batch.status)) return batch;
    await sleep(15000, undefined, { signal });
  }
}

function batchProvider(model: string, state: BatchState) {
  const provider: Parameters<typeof runInference>[2] = async (request) => {
    const chat = openRouterChatRequest(request);
    if (!chat) return { kind: "not-billed", retryable: false };
    state.attemptId = request.attemptId;
    const submitted = await submitBatch(batchBody(chat, model), model, request.attemptId);
    state.submit = submitted;
    if (!submitted.batch) return { kind: "not-billed", retryable: false };
    // Recorded before polling so an admission timeout still settles this batch.
    state.batch = submitted.batch;
    state.batch = await pollBatch(submitted.batch.id, request.signal);
    const outcome = batchOutcome(state.batch);
    if (!outcome) throw new Error(`Batch ${state.batch.status} without a usable result.`);
    return outcome.report;
  };
  return provider;
}

async function reconcileBatch(ctx: Context, attemptId: string, batch: Batch) {
  const outcome = batchOutcome(batch);
  if (!outcome) return null;
  const operator = await ctx.pool.connect();
  try {
    await reconcileInference(attemptId, outcome.report, `openrouter-batch:${batch.id}`, operator);
  } finally {
    operator.release();
  }
  return completedOutput(outcome.report);
}

// Admission timed out first: poll for a bounded time, then settle with the batch receipt.
// A batch still queued stays uncertain for the batch-settle suite to resume.
async function settleLateBatch(ctx: Context, state: BatchState) {
  if (!state.batch || !state.attemptId) return null;
  const id = state.batch.id;
  const batch = await pollBatch(id, AbortSignal.timeout(settleMs)).catch(() => null);
  if (!batch) return null;
  state.batch = batch;
  return reconcileBatch(ctx, state.attemptId, batch);
}

async function runBatch(ctx: Context, request: Parameters<typeof runInference>[1], model: string) {
  const state: BatchState = {};
  const first = await runInference(ctx.actor, request, batchProvider(model, state)).then(
    (report) => ({ output: report.output, error: undefined }),
    (error: unknown) => ({ output: "", error: code(error) }),
  );
  const late = first.error === "SPEND_UNCERTAIN" ? await settleLateBatch(ctx, state) : null;
  return { output: late ?? first.output, error: first.error, state, reconciled: late !== null };
}

function batchSpend(batch: Batch, worst: number) {
  if (!terminal.has(batch.status)) return { cost: worst, uncertain: true };
  return { cost: batch.usage?.cost ?? 0, uncertain: false };
}

function batchRow(batch: Batch) {
  const turnaround = batch.finalized_at ? batch.finalized_at - batch.created_at : null;
  return {
    batchId: batch.id,
    batchStatus: batch.status,
    batchProvider: batch.provider,
    turnaroundSeconds: turnaround,
  };
}

function batchSummary(state: BatchState, worst: number) {
  if (!state.batch) return { spend: { cost: 0, uncertain: false }, row: { submit: state.submit } };
  return { spend: batchSpend(state.batch, worst), row: batchRow(state.batch) };
}

async function batchProbe(ctx: Context, model: string) {
  const packet = eth79Packet();
  const batchModel = `${model}:batch`;
  const tag = `${ctx.runId}-batch-${packet.id}-${slug(model)}`;
  await opportunity(ctx.db, tag, packet.title);
  const { sources } = await addDocuments(ctx, tag, packet);
  // Queue only to freeze the production snapshot; the worker's 60-second lease cannot wait.
  const sourceIds = [...sources.values()];
  const job = await queueImport(ctx.actor, tag, { sourceIds, model: batchModel, key: tag });
  const input = await jobInput(ctx.db, job.id);
  const worst = guard(ctx, model, Buffer.byteLength(input));
  const request = { key: tag, opportunityId: tag, model: batchModel, input, photos: [] };
  const result = await runBatch(ctx, request, model);
  const summary = batchSummary(result.state, worst);
  await record(ctx, tag, summary.spend);
  await saveOutput(ctx, tag, result.output);
  const pages = new Map(packet.documents.map((doc) => [doc.id, doc.pages]));
  const documents = new Map([...sources].map(([doc, source]) => [source, doc]));
  const run = { output: result.output, committed: [], pages, documents };
  const { raw, locators, schema } = scoreRun(packet, { ...run, reached: new Set(sources.keys()) });
  return {
    suite: "batch",
    model: batchModel,
    ...summary.row,
    costUsd: summary.spend.cost,
    error: result.error,
    reconciled: result.reconciled,
    schema,
    value: raw.value,
    locators,
  };
}

async function batchAttempt(db: PoolClient, tag: string) {
  const row = await db.query<{ id: string }>(
    `select a.id from signal_desk.inference_attempts a
     join signal_desk.inference_operations o on o.id=a.operation_id where o.request_key=$1`,
    [tag],
  );
  return row.rows[0]?.id;
}

function batchTag(row: Row) {
  const model = String(row.model).replace(/:batch$/, "");
  return `${String(row.runId)}-batch-${eth79Packet().id}-${slug(model)}`;
}

// Polls briefly; a batch still queued resolves to null and keeps its worst case.
function finishedBatch(row: Row) {
  const id = z.object({ batch: z.object({ id: z.string() }) }).parse(row.submit).batch.id;
  return pollBatch(id, AbortSignal.timeout(20_000)).catch(() => null);
}

// Resumes batches left in flight: polls each once and settles finished ones from their receipt.
async function settleBatch(ctx: Context, row: Row) {
  const tag = batchTag(row);
  const [batch, attemptId] = await Promise.all([finishedBatch(row), batchAttempt(ctx.db, tag)]);
  if (!batch || !attemptId) return { ...row, settled: false };
  const output = await reconcileBatch(ctx, attemptId, batch);
  await record(ctx, tag, batchSpend(batch, 0));
  await saveOutput(ctx, tag, output);
  return { ...row, ...batchRow(batch), costUsd: batch.usage?.cost, settled: true, output };
}

async function settleBatches(ctx: Context, append: Append) {
  const rows = await readRows(ctx.out, "batch");
  const open = rows.filter((row) => row.submit && !terminal.has(String(row.batchStatus)));
  for (const row of open) await append({ ...(await settleBatch(ctx, row)), suite: "batch-settle" });
}

async function readRows(out: string, suite: string) {
  const text = await readFile(`${out}/${suite}.jsonl`, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

type Append = (row: object) => Promise<void>;
type Row = Record<string, unknown>;

function savedPacket(ctx: Context, suite: string, id: string) {
  const packets = suite === "eth79" ? [eth79Packet()] : packetsFor(ctx, suite);
  const packet = packets.find((p) => p.id === id);
  if (!packet) throw new Error(`Unknown packet ${id}.`);
  return packet;
}

function sourceEntry(packet: Packet, source: { id: string; name: string }) {
  const doc = packet.documents.find((d) => d.name === source.name);
  return doc ? [[doc.id, source.id] as const] : [];
}

// Re-derives scores for a saved run from the evaluation database, without provider calls.
async function rescoreRow(ctx: Context, row: Row) {
  const suite = String(row.suite);
  const packet = savedPacket(ctx, suite, String(row.packet));
  const tag = `${String(row.runId)}-${suite}-${packet.id}-${slug(String(row.model))}-r${String(row.rep)}`;
  const job = await ctx.db.query<{ id: string }>(
    "select id from signal_desk.import_jobs where opportunity_id=$1",
    [tag],
  );
  const stored = await ctx.db.query<{ id: string; name: string }>(
    "select id,name from signal_desk.sources where opportunity_id=$1",
    [tag],
  );
  const sources = new Map(stored.rows.flatMap((source) => sourceEntry(packet, source)));
  // Rows from before run tagging have no stored job; their original scores stand.
  if (!job.rows[0]) return row;
  const result = await jobResult(ctx.db, job.rows[0].id, sources);
  return { ...row, ...scoreRun(packet, result.run) };
}

async function rescore(ctx: Context) {
  for (const suite of ["eth79", "corpus", "public"]) {
    const rows = await readRows(ctx.out, suite);
    const scored = await Promise.all(rows.map((row) => rescoreRow(ctx, row)));
    const lines = scored.map((row) => `${JSON.stringify(row)}\n`).join("");
    await writeFile(`${ctx.out}/${suite}.rescored.jsonl`, lines);
  }
}

async function runPackets(
  ctx: Context,
  suite: string,
  models: string[],
  reps: number,
  append: Append,
) {
  const packets = suite === "eth79" ? [eth79Packet()] : packetsFor(ctx, suite);
  for (let rep = 1; rep <= reps; rep++)
    for (const packet of packets)
      await Promise.all(
        models.map(async (m) => append(await runPacket(ctx, suite, packet, m, rep))),
      );
}

// Image-only documents cannot enter the text pipeline; the image probe scores them instead.
function packetsFor(ctx: Context, suite: string) {
  const corpus = ctx.corpora[suite === "public" ? "public" : "synthetic"];
  return corpus.packets.filter((p) => p.documents.some((doc) => doc.format !== "image-pdf"));
}

async function runProbes(ctx: Context, kind: ProbeKind, models: string[], append: Append) {
  for (const model of models) await append(await probe(ctx, kind, model));
}

async function runSuite(ctx: Context, suite: string, models: string[], reps: number) {
  // Rows are appended as they finish so an interrupted run keeps every paid result.
  const append: Append = (row) =>
    appendFile(
      `${ctx.out}/${suite}.jsonl`,
      `${JSON.stringify({ runId: ctx.runId, adapter: ctx.adapter, ...row })}\n`,
    );
  const suites: Record<string, () => Promise<unknown>> = {
    eth79: () => runPackets(ctx, suite, models, reps, append),
    corpus: () => runPackets(ctx, suite, models, reps, append),
    public: () => runPackets(ctx, suite, models, reps, append),
    scanned: () => runProbes(ctx, "scanned", models, append),
    pdf: () => runProbes(ctx, "pdf", models, append),
    "public-image": () => runProbes(ctx, "public-image", models, append),
    rescore: () => rescore(ctx),
    "batch-settle": () => settleBatches(ctx, append),
    batch: () => Promise.all(models.map(async (model) => append(await batchProbe(ctx, model)))),
  };
  const run = suites[suite];
  if (!run) throw new Error(`Unknown suite ${suite}.`);
  await run();
}

async function context(url: string, models: string[], values: Record<string, string>) {
  const { pool, db } = await prepare(url, models);
  const corpusBytes = await readFile(corpusUrl);
  const publicBytes = await readFile(publicUrl);
  const ctx: Context = {
    pool,
    db,
    actor: await resolveActor({ userId: specialist, sessionId: session }),
    out: values.out ?? "",
    runId: new Date().toISOString().replace(/\D/g, "").slice(0, 14),
    prices: await maxPrices(models),
    ledger: await loadLedger(values.out ?? ""),
    adapter: adapterOptions(values.effort, values.sort),
    corpora: {
      synthetic: corpusSchema.parse(JSON.parse(corpusBytes.toString())),
      public: corpusSchema.parse(JSON.parse(publicBytes.toString())),
    },
  };
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const labels = `corpus ${sha(corpusBytes)}, public ${sha(publicBytes)}`;
  console.error(`labels ${labels}; spent ${spent(ctx.ledger).toFixed(6)} USD`);
  return ctx;
}

async function printSummary(out: string) {
  for (const suite of ["eth79", "corpus", "public"]) {
    const rescored = await readRows(out, `${suite}.rescored`);
    const rows = summarize(rescored.length ? rescored : await readRows(out, suite));
    console.log(`## ${suite}\n${JSON.stringify(rows, null, 1)}`);
  }
}

function evaluationDatabase() {
  // Separate from TEST_DATABASE_URL: evaluation budgets and records would break test fixtures.
  const url = process.env.EVAL_DATABASE_URL;
  if (!url || url === process.env.TEST_DATABASE_URL)
    throw new Error("Set EVAL_DATABASE_URL to its own local disposable *_test database.");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  return url;
}

async function evaluate(values: Record<string, string>) {
  const models = (values.models ?? "").split(",");
  const ctx = await context(evaluationDatabase(), models, values);
  try {
    await runSuite(ctx, values.suite ?? "", models, Number(values.reps));
  } finally {
    const delta = (await keyUsage()) - ctx.ledger.baselineKeyUsageUsd;
    console.error(`ledger ${spent(ctx.ledger).toFixed(6)} USD; key usage delta ${delta} USD`);
    ctx.db.release();
    await ctx.pool.end();
  }
}

const { values } = parseArgs({
  options: {
    suite: { type: "string", default: "eth79" },
    models: { type: "string", default: defaultModels.join(",") },
    reps: { type: "string", default: "1" },
    effort: { type: "string" },
    sort: { type: "string" },
    out: {
      type: "string",
      default: fileURLToPath(
        new URL("../../../.amp/in/artifacts/extraction-eval", import.meta.url),
      ),
    },
  },
});
await mkdir(`${values.out}/raw`, { recursive: true });
await (values.suite === "summary" ? printSummary(values.out) : evaluate(values));
