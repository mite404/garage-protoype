import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { routeQuestion, type RoutingSuggestion } from "@signal-desk/contracts/assistance-schema";
import { fieldSchema } from "@signal-desk/contracts/evidence-schema";

type Field = z.infer<typeof fieldSchema>;
type Prediction = { field: Field | null; milliseconds: number; microUsd: number; tokens: number };
type Row = {
  id: string;
  split: string;
  gold: Field | null;
  matcher: Field | null;
  jev: (Prediction & { state: string; confidence: number | null }) | null;
  baseline: Prediction | null;
};

const corpusSchema = z.object({
  cases: z.array(
    z.object({
      id: z.string(),
      split: z.enum(["dev", "heldout"]),
      text: z.string(),
      field: fieldSchema.nullable(),
    }),
  ),
});
type Case = z.infer<typeof corpusSchema>["cases"][number];
const user = "79100000-0000-4000-8000-000000000001";
const buyer = "79100000-0000-4000-8000-000000000002";
const session = "79100000-0000-4000-8000-000000000003";
const baselineModel = "moonshotai/kimi-k3";
const baselineLabels = [...fieldSchema.options, "multiple", "judgment", "other"] as const;
const maxBaselineCalls = 60;
const { values: args } = parseArgs({
  options: {
    report: { type: "string", default: "../../.amp/in/artifacts/jev-routing-eval.json" },
    baseline: { type: "boolean", default: false },
  },
});

// Same option meanings Jev receives, so the baseline answers the identical question.
const baselinePrompt = (text: string) =>
  [
    "Classify a fire-apparatus sales specialist's question. Reply with exactly one label and",
    "nothing else.",
    `Labels: ${baselineLabels.join(", ")}.`,
    "Pick a field label only when the question asks for exactly that one recorded vehicle fact.",
    "multiple: two or more facts. judgment: whether a fact is good enough or suitable.",
    "other: price, offers, negotiation, delivery, condition, accidents, unlisted features, actions.",
    `Question: ${text}`,
  ].join("\n");

function rank(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
}

function score(rows: Row[], predict: (row: Row) => Prediction | null) {
  const scored = rows.flatMap((row) => {
    const prediction = predict(row);
    return prediction ? [{ row, prediction }] : [];
  });
  const fieldCases = scored.filter(({ row }) => row.gold !== null);
  const wrong = scored.filter(
    ({ row, prediction }) => prediction.field !== null && prediction.field !== row.gold,
  );
  const ms = scored.map(({ prediction }) => prediction.milliseconds);
  return {
    n: scored.length,
    correct: scored.filter(({ row, prediction }) => prediction.field === row.gold).length,
    fieldRouted: fieldCases.filter(({ row, prediction }) => prediction.field === row.gold).length,
    fieldCases: fieldCases.length,
    wrongSuggestions: wrong.map(({ row }) => row.id),
    p50ms: rank(ms, 0.5),
    p95ms: rank(ms, 0.95),
    microUsd: scored.reduce((sum, { prediction }) => sum + prediction.microUsd, 0),
    tokens: scored.reduce((sum, { prediction }) => sum + prediction.tokens, 0),
  };
}

function summarize(rows: Row[]) {
  const matcher = (row: Row): Prediction => ({
    field: row.matcher,
    milliseconds: 0,
    microUsd: 0,
    tokens: 0,
  });
  // The product path: exact matcher first, Jev only when it declines.
  const routed = (row: Row): Prediction | null => (row.matcher ? matcher(row) : row.jev);
  return {
    matcher: score(rows, matcher),
    matcherThenJev: score(rows, routed),
    jevOnMatcherMisses: score(rows, (row) => row.jev),
    baseline: rows.some((row) => row.baseline) ? score(rows, (row) => row.baseline) : null,
  };
}

async function askBaseline(text: string): Promise<Prediction> {
  const started = performance.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: baselineModel,
      messages: [{ role: "user", content: baselinePrompt(text) }],
      max_tokens: 2000,
      reasoning: { effort: "low" },
      provider: { allow_fallbacks: false },
      usage: { include: true },
    }),
  });
  if (!response.ok) throw new Error(`Baseline request failed with ${response.status}.`);
  const body = z
    .object({
      choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
      usage: z.object({ total_tokens: z.number(), cost: z.number() }),
    })
    .parse(await response.json());
  const label = (body.choices[0]?.message.content ?? "").trim().replace(/[^A-Za-z]/g, "");
  const field = fieldSchema.safeParse(label);
  return {
    field: field.success ? field.data : null,
    milliseconds: Math.round(performance.now() - started),
    microUsd: Math.round(body.usage.cost * 1_000_000),
    tokens: body.usage.total_tokens,
  };
}

async function provision(db: PoolClient) {
  await db.query(
    "delete from signal_desk.inference_attempts where operation_id in (select id from signal_desk.inference_operations where user_id=$1)",
    [user],
  );
  await db.query("delete from signal_desk.inference_operations where user_id=$1", [user]);
  await db.query("delete from signal_desk.inference_denials where user_id=$1", [user]);
  await db.query("delete from signal_desk.inference_budgets where scope in ('installation',$1)", [
    user,
  ]);
  await db.query("delete from signal_desk.inference_models where id='jev-1.13.0'");
  await db.query("delete from signal_desk.opportunity_members where opportunity_id='jev-eval'");
  await db.query("delete from signal_desk.opportunities where id='jev-eval'");
  await db.query("delete from signal_desk.vehicles where id='jev-eval-truck'");
  await db.query("delete from auth.sessions where user_id in ($1,$2)", [user, buyer]);
  await db.query("delete from signal_desk.identities where user_id in ($1,$2)", [user, buyer]);
  await db.query(
    "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false)",
    [user, buyer],
  );
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, user]);
  await db.query(
    "insert into signal_desk.vehicles(id,title) values ('jev-eval-truck','Synthetic evaluation truck')",
  );
  await db.query(
    "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ('jev-eval','jev-eval-truck',$1,$2)",
    [buyer, user],
  );
  await db.query("insert into signal_desk.opportunity_members values ('jev-eval',$1)", [user]);
  // Documented provisioning row from docs/contracts.md; budgets cap this run at $0.10.
  await db.query(`insert into signal_desk.inference_models
    (id,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,rate_tokens,max_attempts,retry_ms,timeout_ms)
    values ('jev-1.13.0',4096,0,0,2048,512,42,0,1000,1,1000,5000)`);
  await db.query(
    "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',100000,1),($1,100000,1)",
    [user],
  );
}

const environmentSchema = z.object({
  TEST_DATABASE_URL: z.string().regex(/_test(\?|$)/, "Use a disposable *_test database."),
  TYPESAFE_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: args.baseline ? z.string().min(1) : z.string().optional(),
});

function requireEnvironment() {
  const url = environmentSchema.parse(process.env).TEST_DATABASE_URL;
  const runtime = new URL(url);
  runtime.searchParams.set("options", "-c role=signal_desk_runtime");
  return { url, runtime: runtime.toString() };
}

function jevPrediction(suggestion: RoutingSuggestion, milliseconds: number, tokens: number) {
  const cost = { milliseconds, microUsd: Math.ceil((tokens * 42) / 1000), tokens };
  if (suggestion.state === "unavailable")
    return { ...cost, field: null, state: `unavailable:${suggestion.code}`, confidence: null };
  const field = suggestion.state === "suggested" ? suggestion.field : null;
  return { ...cost, field, state: suggestion.state, confidence: suggestion.confidence };
}

async function measureCase(
  db: PoolClient,
  suggest: (text: string, key: string) => Promise<RoutingSuggestion | null>,
  run: string,
  item: Case,
): Promise<Row> {
  const key = `eval:${run}:${item.id}`;
  const started = performance.now();
  const suggestion = await suggest(item.text, key);
  const milliseconds = Math.round(performance.now() - started);
  const attempt = await db.query<{ tokens: number }>(
    "select coalesce((select (a.report->>'inputTokens')::int from signal_desk.inference_attempts a join signal_desk.inference_operations o on o.id=a.operation_id where o.user_id=$1 and o.request_key=$2),0) as tokens",
    [user, `jev:${key}`],
  );
  const tokens = Number(attempt.rows[0]?.tokens);
  return {
    id: item.id,
    split: item.split,
    gold: item.field,
    matcher: routeQuestion(item.text),
    jev: suggestion && jevPrediction(suggestion, milliseconds, tokens),
    baseline: args.baseline ? await askBaseline(item.text) : null,
  };
}

async function writeReport(db: PoolClient, rows: Row[]) {
  const ledger = await db.query(
    "select scope,spent_micro_usd::int as spent,reserved_micro_usd::int as reserved from signal_desk.inference_budgets order by scope",
  );
  const report = {
    generatedAt: new Date().toISOString(),
    model: "jev-1.13.0",
    baselineModel: args.baseline ? baselineModel : null,
    splits: {
      dev: summarize(rows.filter((row) => row.split === "dev")),
      heldout: summarize(rows.filter((row) => row.split === "heldout")),
    },
    ledger: ledger.rows,
    rows,
  };
  await writeFile(args.report, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ splits: report.splits, ledger: report.ledger }, null, 2));
}

async function main() {
  const { url, runtime } = requireEnvironment();
  // Server modules read DATABASE_URL, so they load after it points at the runtime role.
  process.env.DATABASE_URL = runtime;
  const { prepareTestDatabase } = await import("../src/server/test-database");
  const { resolveActor } = await import("../src/server/access");
  const { suggestRoute } = await import("../src/server/jev-routing");
  const corpus = corpusSchema.parse(
    JSON.parse(
      await readFile(new URL("../src/server/jev-routing-corpus.json", import.meta.url), "utf8"),
    ),
  );
  if (args.baseline && corpus.cases.length > maxBaselineCalls)
    throw new Error("Corpus exceeds the baseline call cap.");
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  const run = randomUUID();
  try {
    await db.query("begin");
    await prepareTestDatabase(db);
    await db.query("commit");
    await provision(db);
    const actor = await resolveActor({ userId: user, sessionId: session });
    const suggest = (text: string, key: string) => suggestRoute(actor, "jev-eval", text, key);
    const rows: Row[] = [];
    for (const item of corpus.cases) rows.push(await measureCase(db, suggest, run, item));
    await writeReport(db, rows);
  } finally {
    db.release();
    await pool.end();
  }
}

await main();
