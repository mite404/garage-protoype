import "server-only";
import { APIError, choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import { routeQuestion, type RoutingSuggestion } from "@signal-desk/contracts/assistance-schema";
import { fieldSchema } from "@signal-desk/contracts/evidence-schema";
import type { Actor } from "./access";
import { AppError } from "./errors";
import { runInference, type Provider } from "./model";

const JEV_MODEL = "jev-1.13.0";
const SUGGEST_AT = 0.8;
const options = {
  year: "The model year or build year of the vehicle.",
  chassisManufacturer: "Who built the chassis or cab (for example Pierce, Spartan, Freightliner).",
  bodyBuilder: "Who built the fire apparatus body mounted on the chassis.",
  model: "The vehicle's model name or designation.",
  mileage: "Miles or kilometers on the odometer.",
  pumpCapacity: "The fire pump's rated flow, in gallons or liters per minute.",
  tankCapacity: "How much water the onboard tank holds, in gallons or liters.",
  fuel: "What fuel the engine uses, such as diesel or gasoline.",
  transmission: "The transmission type or make.",
  serviceRecords: "Maintenance or service history documents.",
  pumpTest: "The result or status of a fire pump performance test.",
  multiple: "The question asks about two or more of the facts above at once.",
  judgment:
    "The question asks whether a fact is good enough, suitable, or sufficient for the buyer, rather than asking for the fact itself.",
  other:
    "Anything else: price, offers, negotiation, delivery or freight, condition, accident history, features not listed above, or an instruction to take an action.",
} satisfies Record<z.infer<typeof fieldSchema> | "multiple" | "judgment" | "other", string>;
const requestSchema = z
  .object({
    state: z.object({ specialist_question: z.string() }).strict(),
    question: z.string(),
  })
  .strict();
const answerSchema = z.object({
  choice: z.enum([...fieldSchema.options, "multiple", "judgment", "other"]),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

/** Applies the advisory threshold; catch-all choices never become evidence fields.
 * @throws {z.ZodError} For an unknown choice.
 */
export function decideSuggestion(
  answer: { choice: string; confidence: number },
  modelVersion: string,
): RoutingSuggestion {
  const { choice: selected, confidence } = answer;
  if (selected === "multiple" || selected === "judgment" || selected === "other")
    return { state: "needs_review", reason: selected, confidence, modelVersion };
  const field = fieldSchema.parse(selected);
  return confidence >= SUGGEST_AT
    ? { state: "suggested", field, confidence, modelVersion }
    : { state: "needs_review", reason: "low_confidence", confidence, modelVersion };
}

const typesafeProvider: Provider = async ({ model, input, signal, timeout }) => {
  const { state, question } = requestSchema.parse(JSON.parse(input));
  const client = new TypeSafeClient({ retry: { maxRetries: 0 } });
  try {
    const result = await client.systemOne(
      { model, state, questions: { field: choice(question, options) } },
      { signal, timeout },
    );
    if (result.usage.input_tokens === null || result.usage.output_tokens === null)
      throw new Error("Provider usage was not reported.");
    const { choice: selected, confidence, probabilities } = result.answers.field;
    return {
      kind: "completed",
      modelVersion: result.model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      output: JSON.stringify({ choice: selected, confidence, probabilities }),
      reviewOutcome: "needs_review",
    };
  } catch (error) {
    if (error instanceof APIError && error.status >= 400 && error.status < 500)
      return { kind: "not-billed", retryable: error.status === 408 || error.status === 429 };
    throw error;
  }
};

/** Suggests one field for unmatched specialist questions without changing routing or visibility.
 * Denials, provider failures and unknown choices return `unavailable`, leaving human review.
 * @throws {Error} For an unexpected non-application failure.
 */
export async function suggestRoute(
  actor: Actor,
  opportunityId: string,
  text: string,
  requestKey: string,
  provider: Provider | undefined = process.env.TYPESAFE_API_KEY ? typesafeProvider : undefined,
): Promise<RoutingSuggestion | null> {
  if (actor.role !== "specialist" || routeQuestion(text)) return null;
  const input = JSON.stringify({
    state: { specialist_question: text },
    question: "Which single vehicle fact does `specialist_question` ask for?",
  });
  try {
    const report = await runInference(
      actor,
      { key: `jev:${requestKey}`, opportunityId, model: JEV_MODEL, input, photos: [] },
      provider,
    );
    const answer = answerSchema.safeParse(JSON.parse(report.output));
    return answer.success
      ? decideSuggestion(answer.data, report.modelVersion)
      : { state: "unavailable", code: "INVALID_OUTPUT" };
  } catch (error) {
    if (error instanceof AppError) return { state: "unavailable", code: error.code };
    throw error;
  }
}
