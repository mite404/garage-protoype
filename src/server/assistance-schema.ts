import { z } from "zod";
import { fieldSchema, fieldLabels } from "./evidence-schema";

const text = z.string().trim().min(1).max(2000);
/** Unsent drafts reference current evidence and inquiries; clients cannot fabricate a cited answer. */
export const draftCommand = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("seller_request"),
      inquiryId: z.string().trim().min(1).max(160),
      revision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("buyer_followup"),
      inquiryId: z.string().trim().min(1).max(160),
      revision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("photo_request"),
      revision: z.number().int().min(0),
      recipientLabel: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(10000),
    })
    .strict(),
]);
/** Structured terms preserve buyer intent without interpreting ambiguous prose as an offer. */
export const inquiryInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), text }).strict(),
  z.object({ kind: z.literal("fact"), text, field: fieldSchema }).strict(),
  z
    .object({
      kind: z.literal("offer"),
      text,
      amountMinor: z.number().int().positive().max(100000000000),
      currency: z.literal("USD"),
      timingText: text,
      conditions: z.array(text).max(20),
      unansweredQuestions: z.array(text).max(20),
    })
    .strict(),
]);
/** The finite inline catalog accepts references, never factual values or executable content. */
export const cardCall = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("answer"), props: z.object({ inquiryId: text }).strict() }).strict(),
  z.object({ tool: z.literal("review"), props: z.object({ inquiryId: text }).strict() }).strict(),
  z.object({ tool: z.literal("handoff"), props: z.object({ inquiryId: text }).strict() }).strict(),
  z.object({ tool: z.literal("draft"), props: z.object({ draftId: text }).strict() }).strict(),
]);
/** Server-resolved cards retain explicit variants for unsupported and disputed facts. */
export const inlineCard = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    inquiryId: z.string(),
    field: fieldSchema,
    value: z.string(),
    citation: z.object({ sourceLabel: z.string(), excerpt: z.string() }),
  }),
  z.object({
    kind: z.literal("review"),
    inquiryId: z.string(),
    state: z.enum(["unknown", "conflict", "needs_review", "human_review"]),
    blockerId: z.string(),
    question: z.string(),
    assigneeId: z.string(),
    nextAction: z.string(),
  }),
  z.object({
    kind: z.literal("handoff"),
    inquiryId: z.string(),
    amountMinor: z.number(),
    currency: z.literal("USD"),
    timingText: z.string(),
    conditions: z.array(z.string()),
    unansweredQuestions: z.array(z.string()),
    assigneeId: z.string(),
    nextAction: z.string(),
    status: z.literal("recorded_not_accepted"),
  }),
  z.object({
    kind: z.literal("draft"),
    draftId: z.string(),
    recipientLabel: z.string(),
    body: z.string(),
    status: z.literal("unsent"),
    reviewState: z.enum(["current", "stale"]),
    purpose: z.string(),
  }),
]);
export type InlineCard = z.infer<typeof inlineCard>;

/** Recognizes only whole, single-field questions. Other prose requires human interpretation. */
export function routeQuestion(question: string): z.infer<typeof fieldSchema> | null {
  const normalized = question
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/, "");
  for (const field of fieldSchema.options) {
    const label = fieldLabels[field].toLowerCase();
    if (
      [label, `what is the ${label}`, `what was the ${label}`, `show ${label}`].includes(normalized)
    )
      return field;
  }
  return null;
}
