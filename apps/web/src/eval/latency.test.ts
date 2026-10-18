import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventKinds,
  markChunk,
  markEvent,
  observeView,
  parseGeneration,
  queryKey,
  queryPhase,
  requestMetrics,
  splitSse,
  summarize,
  toAnthropic,
  turnBreakdown,
  type RequestTrace,
} from "./latency";

test("summaries interpolate p50 and ignore missing samples", () => {
  assert.deepEqual(summarize([30, Number.NaN, 10, 20, 100]), { n: 4, mean: 40, p50: 25, max: 100 });
  assert.deepEqual(summarize([Number.NaN]), { n: 0, mean: null, p50: null, max: null });
});

test("request metrics are relative to the request and keep the first of each event", () => {
  const trace: RequestTrace = { flueStart: 900, start: 1000 };
  markEvent(trace, "thinking_delta", 1400);
  markEvent(trace, "toolcall_start", 1900);
  markEvent(trace, "text_delta", 1700);
  markEvent(trace, "text_delta", 1800);
  Object.assign(trace, { end: 2500, payload: { reasoning: { effort: "none" }, max_tokens: 4096 } });
  assert.deepEqual(
    {
      ...requestMetrics(trace),
      stopReason: undefined,
      responseId: undefined,
    },
    {
      start: 1000,
      ttftMs: 400,
      firstThinkingMs: 400,
      firstVisibleMs: 700,
      durationMs: 1500,
      stopReason: undefined,
      responseId: undefined,
      reasoning: { effort: "none" },
      routing: null,
      maxTokens: 4096,
    },
  );
});

test("query phases distinguish preparation, streaming and gaps between requests", () => {
  assert.equal(queryPhase([{ flueStart: 5, start: 0 }]), "pre");
  assert.equal(queryPhase([{ start: 10 }]), "streaming");
  assert.equal(queryPhase([{ start: 10, end: 20 }]), "gap");
});

test("turn breakdown separates provider time from admission, tools and tail work", () => {
  const requests: RequestTrace[] = [
    { flueStart: 700, start: 1000, end: 3000 },
    { flueStart: 4000, start: 4500, end: 5000 },
  ];
  assert.deepEqual(turnBreakdown(requests, [{ name: "show_card", start: 3100, end: 3900 }], 6000), {
    providerMs: 2500,
    outsideProviderMs: 3500,
    beforeFirstRequestMs: 1000,
    admissionMs: 800,
    betweenRequestsMs: 1500,
    toolMs: 800,
    afterLastRequestMs: 1000,
  });
});

test("server-sent events keep a split trailing frame for the next chunk", () => {
  const { events, rest } = splitSse('data: {"type":"a"}\n\ndata: [DONE]\ndata: {"ty');
  assert.deepEqual(events, [{ type: "a" }]);
  assert.equal(rest, 'data: {"ty');
});

test("reasoning counts as content but only text or tool calls are visible", () => {
  assert.deepEqual(eventKinds("openai", { choices: [{ delta: { reasoning: "x" } }] }), {
    content: true,
    visible: false,
  });
  assert.deepEqual(eventKinds("openai", { choices: [{ delta: { tool_calls: [{}] } }] }), {
    content: true,
    visible: true,
  });
  assert.deepEqual(
    eventKinds("anthropic", { type: "content_block_delta", delta: { type: "thinking_delta" } }),
    { content: true, visible: false },
  );
  assert.deepEqual(eventKinds("anthropic", { content_block: { type: "tool_use" } }), {
    content: true,
    visible: true,
  });
});

test("Anthropic replay preserves tool calls and merges consecutive tool results", () => {
  const converted = toAnthropic({
    messages: [
      { role: "system", content: "Rules" },
      { role: "user", content: [{ type: "text", text: "Prepare" }] },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "a", function: { name: "prepare_draft", arguments: '{"kind":"seller_request"}' } },
          { id: "b", function: { name: "show_card", arguments: "" } },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "draft" },
      { role: "tool", tool_call_id: "b", content: "card" },
    ],
    tools: [
      { function: { name: "show_card", description: "Show", parameters: { type: "object" } } },
    ],
  });
  assert.equal(converted.system, "Rules");
  assert.deepEqual(converted.messages, [
    { role: "user", content: [{ type: "text", text: "Prepare" }] },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "a", name: "prepare_draft", input: { kind: "seller_request" } },
        { type: "tool_use", id: "b", name: "show_card", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "draft" },
        { type: "tool_result", tool_use_id: "b", content: "card" },
      ],
    },
  ]);
  assert.deepEqual(converted.tools, [
    { name: "show_card", description: "Show", input_schema: { type: "object" } },
  ]);
});

test("generation accounting prefers native provider token counts", () => {
  const generation = parseGeneration({
    data: {
      provider_name: "Wafer",
      total_cost: 0.0012,
      tokens_prompt: 900,
      tokens_completion: 40,
      native_tokens_prompt: 1000,
      native_tokens_completion: null,
      native_tokens_reasoning: 12,
      native_tokens_cached: null,
      latency: 480,
      generation_time: 900,
    },
  });
  assert.deepEqual(generation, {
    provider: "Wafer",
    costUsd: 0.0012,
    inputTokens: 1000,
    outputTokens: 40,
    reasoningTokens: 12,
    cachedTokens: 0,
    providerTtftMs: 480,
    providerGenerationMs: 900,
  });
});

test("observation records first text and card once and stops only after running states", () => {
  const observed: { firstText?: number; firstCard?: number } = {};
  assert.equal(observeView(observed, undefined, 100), false);
  assert.equal(observeView(observed, { text: "", cards: [], state: "queued" }, 200), false);
  assert.equal(observeView(observed, { text: "Hi", cards: [], state: "running" }, 300), false);
  assert.equal(observeView(observed, { text: "Hi", cards: [{}], state: "running" }, 400), false);
  assert.equal(
    observeView(observed, { text: "Hi.", cards: [{}], state: "interrupted" }, 500),
    true,
  );
  assert.deepEqual(observed, { firstText: 300, firstCard: 400 });
});

test("chunk marks keep the earliest content and visible output", () => {
  const timing = { ttftMs: null, firstVisibleMs: null };
  markChunk(timing, "openai", [{ choices: [{ delta: { reasoning: "r" } }] }], 50);
  markChunk(timing, "openai", [], 60);
  markChunk(timing, "openai", [{ choices: [{ delta: { content: "a" } }] }], 90);
  markChunk(timing, "openai", [{ choices: [{ delta: { content: "b" } }] }], 120);
  assert.deepEqual(timing, { ttftMs: 50, firstVisibleMs: 90 });
});

test("queries are grouped by scope, phase and normalized leading SQL", () => {
  assert.equal(
    queryKey("owner", "gap", { text: "select   1\n from t" }),
    "owner:gap:select 1 from t",
  );
  assert.equal(queryKey("observer", "pre", "begin"), "observer:pre:begin");
});
