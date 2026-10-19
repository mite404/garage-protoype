import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createProvider,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { ConversationStreamStore } from "@flue/runtime/adapter";
import { z } from "zod";
import { approvedSalesTool } from "@signal-desk/contracts/assistance-schema";
import { runInference } from "./model";
import { noteActivity, streamContext, streamError } from "./streaming";
import { orm } from "./db";
import { streamTurns, inferenceAttempts, inferenceOperations } from "./db-schema";
import { eq, like } from "drizzle-orm";
import { AppError } from "./errors";

/** Carries trusted Flue execution identity, including compaction, to paid admission. */
export const modelExecution = new AsyncLocalStorage<{ id: string; requestId: string }>();

/** Requires durable Flue acknowledgement before another model step can spend.
 * @throws {AppError} For unknown charges or a paid response absent from Flue's completed history.
 */
export async function requireModelCheckpoint(
  id: string,
  store: ConversationStreamStore,
  currentRequestId?: string,
) {
  const prefix = `flue:${id}:`;
  const attempts = await orm()
    .select({ key: inferenceOperations.request_key, report: inferenceAttempts.report })
    .from(inferenceAttempts)
    .innerJoin(inferenceOperations, eq(inferenceOperations.id, inferenceAttempts.operation_id))
    .where(like(inferenceOperations.request_key, `${prefix}%`));
  if (attempts.some((attempt) => attempt.report === null))
    throw new AppError(409, "SPEND_UNCERTAIN", "Prior provider request requires reconciliation.");
  const prior = attempts.filter((attempt) => attempt.key !== `${prefix}${currentRequestId}`);
  if (!prior.length) return;
  const completed = new Set<string>();
  let offset: string | undefined;
  // Flue 2.3's durable stream path and canonical turn IDs, not its projected UI history.
  for (;;) {
    const page = await store.read(`agents/SpecialistStream/${id}`, { offset });
    for (const record of page.batches.flatMap((batch) => batch.records)) {
      if (
        record.type === "assistant_message_completed" &&
        record.stopReason !== "aborted" &&
        record.stopReason !== "error" &&
        record.turnId
      )
        completed.add(`${prefix}${record.turnId}`);
    }
    if (page.upToDate) break;
    offset = page.nextOffset;
  }
  if (prior.some((attempt) => !completed.has(attempt.key)))
    throw new AppError(
      409,
      "MODEL_CHECKPOINT_MISSING",
      "A paid response was not acknowledged. Review saved progress before asking again.",
    );
}

const usage = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
});
const messageSchema = z.object({
  role: z.literal("assistant"),
  api: z.string(),
  provider: z.string(),
  model: z.string(),
  timestamp: z.number(),
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string(), textSignature: z.string().optional() }),
      z.object({
        type: z.literal("thinking"),
        thinking: z.string(),
        thinkingSignature: z.string().optional(),
      }),
      z.object({
        type: z.literal("toolCall"),
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.string(), z.json()),
      }),
    ]),
  ),
  usage,
  stopReason: z.enum(["stop", "length", "toolUse", "deferred", "aborted", "error"]),
  responseId: z.string().optional(),
  responseModel: z.string().optional(),
});
// Tools each subject can actually run; the model is offered nothing else.
const subjectTools = {
  deal: new Set<string>(["show_card", "prepare_draft"]),
  sourcing: new Set<string>(["show_card", "propose_fact"]),
};
const permitted = (tools: Set<string>, name: string) =>
  approvedSalesTool.safeParse(name).success && tools.has(name);
const kimi = {
  id: "moonshotai/kimi-k3",
  name: "Kimi K3",
  api: "openai-completions" as const,
  provider: "signal-desk",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: true,
  input: ["text" as const],
  contextWindow: 1048576,
  maxTokens: 8192,
  cost: { input: 0.304, output: 11.936, cacheRead: 0.21, cacheWrite: 0.304 },
};

function emptyError(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: kimi.api,
    provider: kimi.provider,
    model: kimi.id,
    timestamp: Date.now(),
    stopReason: "error",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    errorMessage: "Signal Desk stopped this request. Review its execution status.",
  };
}

/** Registers only the admitted provider; no built-in fallback can make an unaccounted request.
 * The optional transport is a server-owned boundary for controlled provider verification.
 */
export function admittedProvider(
  store: ConversationStreamStore,
  transport: typeof streamSimple = streamSimple,
) {
  const stream: ProviderStreams["streamSimple"] = (_model, context, options) => {
    const output = createAssistantMessageEventStream();
    const execution = modelExecution.getStore();
    void (async () => {
      try {
        if (!execution) throw new Error("Missing model admission identity");
        // Flue reenters its model interceptor per stream read; this runs once per request.
        noteActivity(execution.id, "checking_evidence");
        if (transport === streamSimple && !process.env.OPENROUTER_API_KEY)
          throw new AppError(503, "NOT_CONFIGURED", "OpenRouter is not configured.");
        const { actor, row } = await streamContext(execution.id);
        await requireModelCheckpoint(row.id, store, execution.requestId);
        const tools = subjectTools[row.sourcingCaseId ? "sourcing" : "deal"];
        const permittedContext = {
          ...context,
          messages: context.messages.map((message) =>
            message.role === "system"
              ? {
                  ...message,
                  toolsAdded: message.toolsAdded?.filter((tool) => permitted(tools, tool.name)),
                }
              : message,
          ),
        };
        let forwarded = false;
        const report = await runInference(
          actor,
          {
            key: `flue:${row.id}:${execution.requestId}`,
            ...(row.sourcingCaseId
              ? { sourcingCaseId: row.sourcingCaseId }
              : { opportunityId: row.opportunityId }),
            model: kimi.id,
            input: JSON.stringify(permittedContext),
            photos: [],
          },
          async ({ signal, maxOutputTokens, inputMicroUsd, outputMicroUsd }) => {
            noteActivity(row.id, "writing");
            const providerStream = transport(kimi, permittedContext, {
              apiKey: process.env.OPENROUTER_API_KEY,
              maxRetries: 0,
              maxTokens: maxOutputTokens,
              signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]),
              onPayload: (payload) => ({
                ...z.record(z.string(), z.unknown()).parse(payload),
                // Route only to endpoints priced within the reserved rates, fastest first.
                provider: {
                  allow_fallbacks: false,
                  sort: "latency",
                  max_price: { prompt: inputMicroUsd, completion: outputMicroUsd },
                },
                stream_options: { include_usage: true },
              }),
            });
            for await (const event of providerStream) {
              if (event.type !== "done" && event.type !== "error") {
                output.push(event);
                forwarded = true;
              }
            }
            const final = await providerStream.result();
            if (
              final.stopReason === "error" ||
              final.stopReason === "aborted" ||
              !final.usage.totalTokens
            )
              throw new Error("Provider result is not reconciled");
            return {
              kind: "completed",
              output: JSON.stringify(final),
              modelVersion: final.responseModel ?? final.model,
              inputTokens: final.usage.input + final.usage.cacheRead + final.usage.cacheWrite,
              outputTokens: final.usage.output,
              reviewOutcome: "needs_review",
            };
          },
        );
        const final = messageSchema.parse(JSON.parse(report.output));
        if (final.content.some((item) => item.type === "toolCall" && !permitted(tools, item.name)))
          throw new AppError(403, "TOOL_NOT_ALLOWED", "This sales capability is not available.");
        if (!forwarded) output.push({ type: "start", partial: final });
        if (final.stopReason === "error" || final.stopReason === "aborted")
          throw new Error("Invalid cached response");
        output.push({ type: "done", reason: final.stopReason, message: final });
      } catch (error) {
        if (execution)
          await orm()
            .update(streamTurns)
            .set({ errorCode: streamError(error) })
            .where(eq(streamTurns.id, execution.id));
        output.push({ type: "error", reason: "error", error: emptyError() });
      } finally {
        output.end();
      }
    })();
    return output;
  };
  return createProvider({
    id: kimi.provider,
    name: "Signal Desk admitted OpenRouter",
    auth: { apiKey: { name: "Application admission", resolve: async () => ({ auth: {} }) } },
    models: [kimi],
    api: { stream, streamSimple: stream },
  });
}
