import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

/** Provider-reported accounting for one OpenRouter generation. */
export type Generation = {
  provider: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** OpenRouter-measured time to first token, in milliseconds. */
  providerTtftMs: number | null;
  /** OpenRouter-measured generation time, in milliseconds. */
  providerGenerationMs: number | null;
};
/** Milliseconds since turn submission for one admitted provider request. */
export type RequestTrace = {
  /** When Flue began the model operation, before Signal Desk admission. */
  flueStart?: number;
  /** When the admitted transport opened the OpenRouter request. */
  start: number;
  firstEvent?: number;
  firstThinking?: number;
  firstText?: number;
  firstToolCall?: number;
  end?: number;
  stopReason?: string;
  responseId?: string;
  payload?: Record<string, unknown>;
  generation?: Generation;
};
/** Milliseconds since turn submission for one Flue tool execution. */
export type ToolTrace = { name: string; start: number; end?: number };
/** Chat-completions transcript entries as captured from the admitted provider. */
export type OpenAIMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
/** One captured chat-completions request body. */
export type Payload = Record<string, unknown> & {
  messages: OpenAIMessage[];
  tools?: { function: { name: string; description?: string; parameters: unknown } }[];
};
/** Streaming events from either OpenRouter API format, narrowed to the fields timed here. */
export type SseEvent = {
  type?: string;
  choices?: { delta?: { content?: string; reasoning?: string; tool_calls?: unknown[] } }[];
  delta?: { type?: string };
  content_block?: { type?: string };
};

type AnthropicBlock = Record<string, unknown>;
type Ledger = z.infer<typeof ledgerSchema>;

// Total OpenRouter allowance across evaluation runs, with headroom for one in-flight unit.
const TOTAL_CAP_USD = Number(process.env.LATENCY_EVAL_CAP_USD ?? "1");
const SAFETY_MARGIN_USD = 0.05;
const REPO = new URL("../../../../", import.meta.url);
const LEDGER = new URL(process.env.LATENCY_EVAL_LEDGER ?? ".amp/in/latency/ledger.json", REPO);
const ledgerSchema = z.object({
  baselineKeyUsageUsd: z.number(),
  entries: z.array(z.object({ label: z.string(), usd: z.number(), at: z.string() })),
});
const generationSchema = z.object({
  data: z.object({
    provider_name: z.string().nullable(),
    total_cost: z.number(),
    tokens_prompt: z.number().nullable(),
    tokens_completion: z.number().nullable(),
    native_tokens_prompt: z.number().nullable(),
    native_tokens_completion: z.number().nullable(),
    native_tokens_reasoning: z.number().nullable(),
    native_tokens_cached: z.number().nullable(),
    latency: z.number().nullable(),
    generation_time: z.number().nullable(),
  }),
});
const keySchema = z.object({ data: z.object({ usage: z.number() }) });

function percentile(sorted: number[], q: number) {
  const index = (sorted.length - 1) * q;
  const low = sorted[Math.floor(index)] ?? 0;
  const high = sorted[Math.ceil(index)] ?? 0;
  return low + (high - low) * (index - Math.floor(index));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function total(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function since(at: number | undefined, start: number) {
  return at === undefined ? null : at - start;
}

function earliest(...values: (number | undefined)[]) {
  const present = values.filter((value) => value !== undefined);
  return present.length ? Math.min(...present) : undefined;
}

function text(content: OpenAIMessage["content"]) {
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

function anthropicBlocks(message: OpenAIMessage): AnthropicBlock[] {
  if (message.role === "user") return [{ type: "text", text: text(message.content) }];
  if (message.role === "tool")
    return [
      { type: "tool_result", tool_use_id: message.tool_call_id, content: text(message.content) },
    ];
  const prose = text(message.content);
  const calls = (message.tool_calls ?? []).map((call) => ({
    type: "tool_use",
    id: call.id,
    name: call.function.name,
    input: JSON.parse(call.function.arguments || "{}"),
  }));
  return [...(prose ? [{ type: "text", text: prose }] : []), ...calls];
}

function apiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required.");
  return key;
}

function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readLedger(): Promise<Ledger | null> {
  try {
    return ledgerSchema.parse(JSON.parse(await readFile(LEDGER, "utf8")));
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function writeLedger(ledger: Ledger) {
  await mkdir(dirname(LEDGER.pathname), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
}

async function keyUsageUsd() {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  if (!response.ok) throw new Error(`OpenRouter key lookup failed: ${response.status}`);
  return keySchema.parse(await response.json()).data.usage; // → cumulative USD for the key
}

/** Summarizes finite samples as mean, interpolated p50 and max, rounded to 0.1. */
export function summarize(values: number[]) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return { n: 0, mean: null, p50: null, max: null };
  return {
    n: sorted.length,
    mean: round(total(sorted) / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** Records the first thinking, text and tool-call events of one provider stream. */
export function markEvent(trace: RequestTrace, type: string, at: number) {
  if (type === "thinking_delta") trace.firstThinking ??= at;
  if (type === "text_delta") trace.firstText ??= at;
  if (type === "toolcall_start") trace.firstToolCall ??= at;
  trace.firstEvent = earliest(trace.firstThinking, trace.firstText, trace.firstToolCall);
}

/** Classifies database work as before the first request, during a stream, or between them. */
export function queryPhase(requests: RequestTrace[]) {
  const started = requests.filter((request) => request.start);
  if (!started.length) return "pre";
  return started.some((request) => request.end === undefined) ? "streaming" : "gap";
}

/** Records the first observed text and card, returning whether the turn left its running states. */
export function observeView(
  observed: { firstText?: number; firstCard?: number },
  view: { text: string; cards: unknown[]; state: string } | undefined,
  at: number,
) {
  if (!view) return false;
  if (view.text) observed.firstText ??= at;
  if (view.cards.length) observed.firstCard ??= at;
  return !["queued", "running"].includes(view.state);
}

/** Groups SQL by caller scope, request phase and normalized leading text. */
export function queryKey(scope: string, phase: string, query: unknown) {
  const sql = typeof query === "string" ? query : String((query as { text?: unknown })?.text);
  return `${scope}:${phase}:${sql.replace(/\s+/g, " ").slice(0, 90)}`;
}

/** Converts one request trace into per-request latencies relative to its own start. */
export function requestMetrics(trace: RequestTrace) {
  const payload = trace.payload ?? {};
  return {
    start: trace.start,
    ttftMs: since(trace.firstEvent, trace.start),
    firstThinkingMs: since(trace.firstThinking, trace.start),
    firstVisibleMs: since(earliest(trace.firstText, trace.firstToolCall), trace.start),
    durationMs: (trace.end ?? trace.start) - trace.start,
    stopReason: trace.stopReason,
    responseId: trace.responseId,
    reasoning: payload.reasoning ?? null,
    routing: payload.provider ?? null,
    maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? null,
    ...trace.generation,
  };
}

/** Splits completed sequential provider requests from the Signal Desk work around them. */
export function turnBreakdown(requests: RequestTrace[], tools: ToolTrace[], completion: number) {
  const providerMs = total(requests.map((r) => (r.end ?? r.start) - r.start));
  return {
    providerMs,
    outsideProviderMs: completion - providerMs,
    beforeFirstRequestMs: requests[0]?.start ?? null,
    admissionMs: total(requests.map((r) => r.start - (r.flueStart ?? r.start))),
    betweenRequestsMs: total(
      requests.slice(1).map((r, i) => r.start - (requests[i]?.end ?? r.start)),
    ),
    toolMs: total(tools.map((tool) => (tool.end ?? tool.start) - tool.start)),
    afterLastRequestMs: completion - (requests.at(-1)?.end ?? 0),
  };
}

/** Parses complete server-sent `data:` lines, returning any trailing partial line. */
export function splitSse(buffer: string) {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as SseEvent);
  return { events, rest };
}

function anthropicKinds(event: SseEvent) {
  const tool = event.content_block?.type === "tool_use";
  return {
    content: tool || event.type === "content_block_delta",
    visible: tool || event.delta?.type === "text_delta",
  };
}

function openAIKinds(event: SseEvent) {
  const delta = event.choices?.[0]?.delta ?? {};
  const visible = Boolean(delta.content || delta.tool_calls);
  return { content: visible || Boolean(delta.reasoning), visible };
}

/** Reports whether an event carries any model content, and whether a user would see it. */
export function eventKinds(format: "openai" | "anthropic", event: SseEvent) {
  return format === "anthropic" ? anthropicKinds(event) : openAIKinds(event);
}

/** Records the first content and first visible output among one chunk's events. */
export function markChunk(
  timing: { ttftMs: number | null; firstVisibleMs: number | null },
  format: "openai" | "anthropic",
  events: SseEvent[],
  at: number,
) {
  const kinds = events.map((event) => eventKinds(format, event));
  if (kinds.some((kind) => kind.content)) timing.ttftMs ??= at;
  if (kinds.some((kind) => kind.visible)) timing.firstVisibleMs ??= at;
}

/** Formats one control sample as a single progress line. */
export function sampleLine(
  label: string,
  sample: Partial<Generation> & {
    ttftMs: number | null;
    firstVisibleMs: number | null;
    durationMs: number;
  },
) {
  const ms = (value: number | null | undefined) => (value == null ? "-" : value.toFixed(0));
  return `${label}: ttft=${ms(sample.ttftMs)} visible=${ms(sample.firstVisibleMs)} done=${ms(sample.durationMs)} ${sample.provider ?? "-"} reasoning=${sample.reasoningTokens ?? "-"} US$${(sample.costUsd ?? 0).toFixed(5)}\n`;
}

/** Converts a chat-completions request into Anthropic Messages fields, merging adjacent roles. */
export function toAnthropic(payload: Payload) {
  const system = payload.messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => text(message.content))
    .join("\n\n");
  const messages: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];
  const conversation = payload.messages.filter(
    (m) => m.role !== "system" && m.role !== "developer",
  );
  for (const message of conversation) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks = anthropicBlocks(message);
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  }
  const tools = (payload.tools ?? []).map(({ function: tool }) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  return { system, messages: messages.filter((m) => m.content.length), tools };
}

/** Normalizes OpenRouter's generation record, preferring native provider token counts. */
export function parseGeneration(raw: unknown): Generation {
  const { data } = generationSchema.parse(raw);
  return {
    provider: data.provider_name,
    costUsd: data.total_cost,
    inputTokens: data.native_tokens_prompt ?? data.tokens_prompt ?? 0,
    outputTokens: data.native_tokens_completion ?? data.tokens_completion ?? 0,
    reasoningTokens: data.native_tokens_reasoning ?? 0,
    cachedTokens: data.native_tokens_cached ?? 0,
    providerTtftMs: data.latency,
    providerGenerationMs: data.generation_time,
  };
}

/** Fetches OpenRouter's settled usage for one generation, waiting for delayed availability.
 * @throws When the generation record never becomes available.
 */
export async function fetchGeneration(id: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      { headers: { authorization: `Bearer ${apiKey()}` } },
    );
    if (response.ok) return parseGeneration(await response.json());
    await setTimeout(1500);
  }
  throw new Error(`OpenRouter generation ${id} was not available.`);
}

/** Creates the spend ledger before the first paid request so key usage has a baseline. */
export async function initializeLedger() {
  if (await readLedger()) return;
  await writeLedger({ baselineKeyUsageUsd: await keyUsageUsd(), entries: [] });
}

/** Stops before the evaluation allowance could be exceeded by the next paid unit.
 * Uses the larger of recorded provider costs and the key's own usage delta.
 * @throws When no ledger exists or the next estimated unit would cross the cap.
 */
export async function assertSpendRoom(nextEstimateUsd: number) {
  const ledger = await readLedger();
  if (!ledger) throw new Error("Initialize the spend ledger first.");
  const recorded = total(ledger.entries.map((entry) => entry.usd));
  const spent = Math.max(recorded, (await keyUsageUsd()) - ledger.baselineKeyUsageUsd);
  if (spent + nextEstimateUsd > TOTAL_CAP_USD - SAFETY_MARGIN_USD)
    throw new Error(
      `Spend cap reached: US$${spent.toFixed(4)} spent, next unit estimated US$${nextEstimateUsd.toFixed(4)}.`,
    );
  return spent;
}

/** Appends provider-reported spend to the evaluation ledger.
 * @throws When the ledger was not initialized.
 */
export async function recordSpend(label: string, usd: number) {
  const ledger = await readLedger();
  if (!ledger) throw new Error("Initialize the spend ledger first.");
  ledger.entries.push({ label, usd, at: new Date().toISOString() });
  await writeLedger(ledger);
}

/** Writes one JSON artifact under the repository's ignored `.amp/in/artifacts/latency/`. */
export async function writeArtifact(name: string, value: unknown) {
  const path = new URL(`.amp/in/artifacts/latency/${name}`, REPO);
  await mkdir(dirname(path.pathname), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path.pathname;
}

/** Resolves a repository-relative path, independent of the npm workspace directory. */
export function repoPath(relative: string) {
  return new URL(relative, REPO);
}
