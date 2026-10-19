import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { feedbackAnswer, feedbackSurvey } from "@signal-desk/contracts/feedback-schema";
import { database, orm } from "./db";
import { growthInvitations, growthMessages, growthReceipts } from "./db-schema";
import { AppError } from "./errors";
import { submitFeedback } from "./feedback";
import { recordGrowthEvent, requireProspect } from "./growth";
import {
  applyDeliveryFailure,
  lockOutreachRecipient,
  lockProviderReceipt,
  suppressRecipient,
} from "./outreach";
import type { Actor } from "./access";

const eventSchema = z.object({
  type: z.string().max(100),
  data: z.object({ email_id: z.string().min(1).max(200) }).passthrough(),
});
const formsResponse = z.object({
  responseId: z.string().min(1),
  lastSubmittedTime: z.iso.datetime(),
  answers: z.record(
    z.string(),
    z.object({
      textAnswers: z
        .object({ answers: z.array(z.object({ value: z.string().max(10000) })) })
        .optional(),
    }),
  ),
});
const formsQuestions = z.object({
  reference: z.string(),
  interest: z.string(),
  blocker: z.string(),
  explanation: z.string(),
});
const formsConfig = z.object({
  formId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  questions: formsQuestions,
});
const receivedEmail = z.object({
  id: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  text: z.string().max(10000).nullable(),
  created_at: z.iso.datetime(),
  headers: z.record(z.string(), z.string()).default({}),
});

/** Verifies the Svix signature against original bytes and a five-minute replay window.
 * @throws {AppError} For missing configuration, malformed payloads or invalid signatures.
 */
export function verifyResendEvent(
  raw: string,
  headers: Headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
) {
  if (!secret?.startsWith("whsec_"))
    throw new AppError(503, "WEBHOOK_DISABLED", "Resend webhook verification is not configured.");
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  if (
    !id ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    Buffer.byteLength(raw) > 100000
  )
    throw new AppError(400, "INVALID_SIGNATURE", "Invalid webhook signature.");
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${raw}`)
    .digest();
  const valid = (headers.get("svix-signature") ?? "").split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    const actual = Buffer.from(value ?? "", "base64");
    return (
      version === "v1" && actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
  if (!valid) throw new AppError(400, "INVALID_SIGNATURE", "Invalid webhook signature.");
  return { id, event: eventSchema.parse(JSON.parse(raw)) };
}

/** Maps configured Forms question IDs using exactly the email survey's versioned choice labels.
 * @throws For changed questions, invalid choices or malformed provider data.
 */
export function normalizeFormResponse(raw: unknown, questions: z.infer<typeof formsQuestions>) {
  const response = formsResponse.parse(raw);
  const value = (id: string) =>
    response.answers[id]?.textAnswers?.answers.map((answer) => answer.value).join("\n") ?? "";
  const interest = feedbackSurvey.interest.find(
    (choice) =>
      choice.label === value(questions.interest) || choice.id === value(questions.interest),
  );
  const blocker = feedbackSurvey.blockers.find(
    (choice) => choice.label === value(questions.blocker) || choice.id === value(questions.blocker),
  );
  const original = feedbackAnswer.parse({
    interest: interest?.id,
    blocker: blocker?.id,
    explanation: value(questions.explanation),
  });
  return {
    channel: "forms" as const,
    externalId: `${response.responseId}:${response.lastSubmittedTime}`,
    reference: value(questions.reference),
    original,
    submittedAt: response.lastSubmittedTime,
  };
}

/** Polls at most 20 Forms pages with an overlapping timestamp window and stable response IDs.
 * Caller persists the returned watermark only after success; replay is safe after partial failure.
 * @throws {AppError} For absent OAuth/configuration, provider errors or an oversized polling window.
 */
export async function pollFeedbackForms(since: Date, send: typeof fetch = fetch) {
  if (!process.env.GROWTH_FORMS_CONFIG || !process.env.GOOGLE_FORMS_ACCESS_TOKEN)
    throw new AppError(
      503,
      "FORMS_DISABLED",
      "Forms OAuth and question configuration are required.",
    );
  const config = formsConfig.parse(JSON.parse(process.env.GROWTH_FORMS_CONFIG));
  const filter = `timestamp >= ${new Date(since.getTime() - 300000).toISOString()}`;
  let pageToken = "";
  let count = 0;
  let watermark = since;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://forms.googleapis.com/v1/forms/${config.formId}/responses`);
    url.search = new URLSearchParams({
      filter,
      pageSize: "100",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await send(url, {
      headers: { Authorization: `Bearer ${process.env.GOOGLE_FORMS_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new AppError(503, "FORMS_UNAVAILABLE", "Forms read did not complete; cursor retained.");
    const result = z
      .object({
        responses: z.array(formsResponse).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(await response.json());
    for (const original of result.responses) {
      const normalized = normalizeFormResponse(original, config.questions);
      await submitFeedback(normalized);
      await orm()
        .insert(growthReceipts)
        .values({ id: `forms:${normalized.externalId}`, kind: "forms.original", original })
        .onConflictDoNothing();
      if (new Date(normalized.submittedAt) > watermark)
        watermark = new Date(normalized.submittedAt);
      count++;
    }
    pageToken = result.nextPageToken ?? "";
    if (!pageToken) return { count, watermark };
  }
  throw new AppError(
    413,
    "FORMS_WINDOW_TOO_LARGE",
    "Polling exceeded 2000 responses; narrow the operator-configured window.",
  );
}

async function correlateReply(email: z.infer<typeof receivedEmail>, reference?: string) {
  const alias = email.to.map((to) => to.match(/outreach\+([a-f0-9]{64})-([01])@/i)).find(Boolean);
  const [message] = alias
    ? await orm()
        .select()
        .from(growthMessages)
        .where(eq(growthMessages.id, `${alias[1]}:${alias[2]}`))
    : [];
  const [invitation] = reference
    ? await orm().select().from(growthInvitations).where(eq(growthInvitations.id, reference))
    : [];
  return {
    messageId: message?.id,
    accountId: message?.accountId ?? invitation?.accountId,
    recipient: message?.recipient ?? invitation?.recipient,
  };
}

async function receiveReply(id: string, emailId: string, send: typeof fetch) {
  if (!process.env.RESEND_API_KEY)
    throw new AppError(503, "RECEIVING_DISABLED", "Receiving API is not configured.");
  const response = await send(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new AppError(
      503,
      "RECEIVING_UNAVAILABLE",
      "Reply body is unavailable; retry the webhook later.",
    );
  const email = receivedEmail.parse(await response.json());
  const automatic = Object.entries(email.headers).some(
    ([name, value]) =>
      /^(auto-submitted|x-autoreply|x-autorespond)$/i.test(name) && !/^no$/i.test(value),
  );
  const reference = email.to
    .map((to) => to.match(/feedback\+([a-f0-9-]{36})@/i)?.[1])
    .find(Boolean);
  if (reference && !automatic && email.text)
    await submitFeedback({
      channel: "email",
      externalId: email.id,
      reference,
      original: email.text,
      submittedAt: email.created_at,
    });
  const { messageId, accountId, recipient } = await correlateReply(email, reference);
  const client = await database().connect();
  try {
    await client.query("begin");
    if (accountId)
      await orm(client).execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${accountId},76001))`,
      );
    const inserted = await orm(client)
      .insert(growthReceipts)
      .values({
        id,
        messageId,
        kind: automatic ? "email.automatic" : "email.reply",
        original: email,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length && accountId && recipient && !automatic) {
      await lockOutreachRecipient(client, recipient);
      const optOut = /^\s*(stop|unsubscribe|opt out)[.!\s]*$/i.test(email.text ?? "");
      if (optOut) await suppressRecipient(client, recipient, "opt_out");
      await orm(client)
        .update(growthMessages)
        .set({ state: "stopped" })
        .where(and(eq(growthMessages.accountId, accountId), eq(growthMessages.state, "queued")));
      await recordGrowthEvent(
        client,
        accountId,
        `reply:${email.id}`,
        "reply",
        `Provider-received ${optOut ? "opt-out" : "reply"}; unverified respondent correlation. Original receipt ${id}`,
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return { duplicate: false };
}

async function recordDelivery(id: string, event: z.infer<typeof eventSchema>) {
  const client = await database().connect();
  try {
    await client.query("begin");
    await lockProviderReceipt(client, event.data.email_id);
    const [accepted] = await orm(client)
      .select({ messageId: growthReceipts.messageId })
      .from(growthReceipts)
      .where(eq(growthReceipts.id, `accepted:${event.data.email_id}`));
    const [message] = await orm(client)
      .select({ id: growthMessages.id, recipient: growthMessages.recipient })
      .from(growthMessages)
      .where(
        accepted?.messageId
          ? eq(growthMessages.id, accepted.messageId)
          : eq(growthMessages.providerId, event.data.email_id),
      );
    const inserted = await orm(client)
      .insert(growthReceipts)
      .values({ id, messageId: message?.id, kind: event.type, original: event })
      .onConflictDoNothing()
      .returning();
    if (message)
      await applyDeliveryFailure(client, {
        providerId: event.data.email_id,
        recipient: message.recipient,
      });
    await client.query("commit");
    return { duplicate: inserted.length === 0 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Processes verified provider events once. Inbound body retrieval is read-only and retryable.
 * Delivery notifications never become customer replies or survey answers.
 * @throws {AppError} For invalid signatures, missing receiving configuration or incomplete retrieval.
 */
export async function receiveResendEvent(
  raw: string,
  headers: Headers,
  send: typeof fetch = fetch,
) {
  const { id, event } = verifyResendEvent(raw, headers);
  if (
    event.type === "email.received" &&
    (await orm().select().from(growthReceipts).where(eq(growthReceipts.id, id))).length
  )
    return { duplicate: true };
  return event.type === "email.received"
    ? receiveReply(id, event.data.email_id, send)
    : recordDelivery(id, event);
}

/** Reads correlated pre-opportunity reply originals without exposing addresses or provider headers.
 * A reply is unverified source material, not an authenticated respondent or accepted account fact.
 * @throws {AppError} For revoked credentials or inaccessible prospects.
 */
export async function readReceivedReplies(actor: Actor, id: string) {
  const account = await requireProspect(actor, id);
  const rows = await orm()
    .select({ receipt: growthReceipts, enrollmentKey: growthMessages.enrollmentKey })
    .from(growthReceipts)
    .innerJoin(growthMessages, eq(growthMessages.id, growthReceipts.messageId))
    .where(and(eq(growthMessages.accountId, id), eq(growthReceipts.kind, "email.reply")))
    .orderBy(asc(growthReceipts.createdAt), asc(growthReceipts.id))
    .limit(100);
  await requireProspect(actor, id);
  return rows.map(({ receipt, enrollmentKey }) => {
    const email = receivedEmail.parse(receipt.original);
    return {
      receiptId: receipt.id,
      prospectId: id,
      enrollmentKey,
      channel: "email" as const,
      receivedAt: email.created_at,
      text: email.text ?? "",
      synthetic: account.directory.synthetic,
    };
  });
}
