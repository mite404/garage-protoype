// Replays the exact provider bodies captured by turn-latency directly against OpenRouter, with
// no Flue, database or admission work, to separate model time from Signal Desk overhead.
// Usage: npm run eval:latency:control -- --payloads baseline.payloads.json --label control \
//   --variants same,latency-routing,yaklabs --runs 3 [--requests first]
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  assertSpendRoom,
  markChunk,
  sampleLine,
  fetchGeneration,
  initializeLedger,
  recordSpend,
  splitSse,
  summarize,
  toAnthropic,
  writeArtifact,
  type Generation,
  type Payload,
  type SseEvent,
} from "./latency";

type Format = "openai" | "anthropic";
type Variant = { format: Format; body: (payload: Payload) => unknown };
type Timing = {
  ttftMs: number | null;
  firstVisibleMs: number | null;
  durationMs: number;
  id: string;
  status: number;
};
type Sample = Timing &
  Partial<Generation> & { variant: string; scenario: string; run: number; request: number };
type Captured = z.infer<typeof capturedSchema>[number];

// The admitted integer rates (micro-USD per token) equal US$ per million tokens.
const ADMITTED_MAX_PRICE = { prompt: 1, completion: 12 };
const routed = (sort: string) => (payload: Payload) => ({
  ...payload,
  provider: { allow_fallbacks: false, sort, max_price: ADMITTED_MAX_PRICE },
});
const VARIANTS: Record<string, Variant> = {
  // Byte-identical to what the admitted provider sent through Flue.
  same: { format: "openai", body: (payload) => payload },
  // Kimi K3's provider-default reasoning, as an unconfigured client would get.
  "reasoning-default": {
    format: "openai",
    body: (payload) => ({ ...payload, reasoning: undefined }),
  },
  "throughput-routing": { format: "openai", body: routed("throughput") },
  "latency-routing": { format: "openai", body: routed("latency") },
  // Yaklabs' gateway shape: Anthropic Messages, 8,192 max tokens, a 1,024-token thinking
  // budget and no provider routing preferences.
  yaklabs: {
    format: "anthropic",
    body: (payload) => ({
      model: payload.model,
      max_tokens: 8192,
      thinking: { type: "enabled", budget_tokens: 1024 },
      stream: true,
      ...toAnthropic(payload),
    }),
  },
};
const capturedSchema = z.array(
  z.object({
    scenario: z.string(),
    run: z.number(),
    payloads: z.array(z.custom<Payload>((value) => typeof value === "object" && value !== null)),
  }),
);
const { values: args } = parseArgs({
  options: {
    payloads: { type: "string", default: "baseline.payloads.json" },
    label: { type: "string", default: "control" },
    variants: { type: "string", default: "same,latency-routing,yaklabs" },
    runs: { type: "string", default: "3" },
    requests: { type: "string", default: "all" },
    "request-estimate-usd": { type: "string", default: "0.01" },
  },
});

function limit() {
  return args.requests === "first" ? 1 : undefined;
}

function variant(name: string) {
  const selected = VARIANTS[name];
  if (!selected) throw new Error(`Unknown variant ${name}.`);
  return selected;
}

async function post(selected: Variant, payload: Payload) {
  const anthropic = selected.format === "anthropic";
  return fetch(`https://openrouter.ai/api/v1/${anthropic ? "messages" : "chat/completions"}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(selected.body(payload)),
  });
}

// Times one streamed request: first content of any kind, first visible text or tool call, end.
async function timeRequest(selected: Variant, payload: Payload): Promise<Timing> {
  const started = performance.now();
  const response = await post(selected, payload);
  // OpenRouter's settled-usage key for both formats; Anthropic events carry msg_ IDs.
  const id = response.headers.get("x-generation-id");
  const reader = response.body?.getReader();
  if (!response.ok || !reader || !id)
    throw new Error(`OpenRouter returned HTTP ${response.status}.`);
  const timing: Timing = {
    ttftMs: null,
    firstVisibleMs: null,
    durationMs: 0,
    id,
    status: response.status,
  };
  await readEvents(reader, (events) =>
    markChunk(timing, selected.format, events, performance.now() - started),
  );
  timing.durationMs = performance.now() - started;
  return timing;
}

async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvents: (events: SseEvent[]) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const { events, rest } = splitSse(buffer + decoder.decode(chunk.value, { stream: true }));
    buffer = rest;
    onEvents(events);
  }
}

async function replay(name: string, turn: Captured, run: number, samples: Sample[]) {
  let turnMs = 0;
  for (const [index, payload] of turn.payloads.slice(0, limit()).entries()) {
    await assertSpendRoom(Number(args["request-estimate-usd"]));
    const timing = await timeRequest(variant(name), payload);
    const generation = await fetchGeneration(timing.id);
    const label = `control:${args.label}:${name}:${turn.scenario}:${index}:${run}`;
    await recordSpend(label, generation.costUsd);
    turnMs += timing.durationMs;
    const sample = { variant: name, scenario: turn.scenario, run, request: index, ...timing };
    samples.push({ ...sample, ...generation });
    process.stdout.write(sampleLine(label, { ...timing, ...generation }));
  }
  return { variant: name, turnMs };
}

function summarizeVariant(
  name: string,
  samples: Sample[],
  turns: { variant: string; turnMs: number }[],
) {
  const requests = samples.filter((sample) => sample.variant === name);
  return {
    variant: name,
    ttftMs: summarize(requests.map((s) => s.ttftMs ?? Number.NaN)),
    firstVisibleMs: summarize(requests.map((s) => s.firstVisibleMs ?? Number.NaN)),
    requestMs: summarize(requests.map((s) => s.durationMs)),
    modelOnlyTurnMs: summarize(turns.filter((t) => t.variant === name).map((t) => t.turnMs)),
    reasoningTokens: summarize(requests.map((s) => s.reasoningTokens ?? Number.NaN)),
    providers: [...new Set(requests.map((s) => s.provider))],
    costUsd: requests.reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
  };
}

async function main() {
  const source = new URL(`../../../../.amp/in/artifacts/latency/${args.payloads}`, import.meta.url);
  const captured = capturedSchema.parse(JSON.parse(await readFile(source, "utf8")));
  const turns = captured.filter((turn) => turn.run === 1);
  const names = args.variants.split(",");
  names.forEach(variant);
  await initializeLedger();
  const samples: Sample[] = [];
  const turnTimes: { variant: string; turnMs: number }[] = [];
  for (let run = 1; run <= Number(args.runs); run++)
    for (const name of names)
      for (const turn of turns) turnTimes.push(await replay(name, turn, run, samples));
  const summary = names.map((name) => summarizeVariant(name, samples, turnTimes));
  const at = new Date().toISOString();
  const path = await writeArtifact(`${args.label}.json`, {
    label: args.label,
    at,
    summary,
    samples,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\nWrote ${path}\n`);
}

await main();
