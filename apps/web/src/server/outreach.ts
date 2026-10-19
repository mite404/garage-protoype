import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireSession, type Actor } from "./access";
import { database, orm } from "./db";
import {
  credentialSchema,
  growthInvitations,
  growthMessages,
  growthReceipts,
  growthSuppressions,
} from "./db-schema";
import { AppError } from "./errors";
import { changeProspect, recordGrowthEvent, requireProspect } from "./growth";
import { parseInput } from "./validation";

const sourcingKey =
  /^pairing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$/i;
const enrollmentSchema = z
  .object({
    key: z.string().min(1).max(100),
    purpose: z.enum(["buyer", "sourcing"]).default("buyer"),
    invitationId: z.uuid().optional(),
    subject: z.string().trim().min(1).max(200),
    body: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .refine((body) => /\bstop\b/i.test(body)),
  })
  .strict()
  .refine(
    (input) => (input.purpose === "sourcing") === sourcingKey.test(input.key),
    "Sourcing purpose requires a versioned pairing key",
  );
const stopReason = z.enum(["reply", "opt_out", "bounce", "complaint", "disqualified"]);
type Message = typeof growthMessages.$inferSelect;
/** Server-owned delivery boundary. Test providers must be explicitly passed by controlled tests. */
export type MailProvider = (message: {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  replyReference?: string;
}) => Promise<{ id: string }>;

function publicMessage(message: Message) {
  const { credential: _credential, actorId: _actorId, ...safe } = message;
  return safe;
}

function messageActor(message: Message): Actor {
  return {
    userId: message.actorId,
    credential: credentialSchema.parse(message.credential),
    role: "specialist",
    canSpend: false,
  };
}

async function suppressed(email: string, client: Parameters<typeof orm>[0]) {
  const rows = await orm(client)
    .select()
    .from(growthSuppressions)
    .where(eq(growthSuppressions.email, email));
  return rows.length > 0;
}

/** Serializes recipient suppression with enrollment and dispatch admission across accounts. */
export async function lockOutreachRecipient(client: PoolClient, email: string) {
  await orm(client).execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${email.toLowerCase()},76002))`,
  );
}

/** Serializes an early webhook with the transaction establishing its provider-message mapping. */
export async function lockProviderReceipt(client: PoolClient, id: string) {
  await orm(client).execute(sql`select pg_advisory_xact_lock(hashtextextended(${id},76003))`);
}

/** Applies an idempotent recipient-wide stop within the caller's transaction. */
export async function suppressRecipient(client: PoolClient, email: string, reason: string) {
  const recipient = email.toLowerCase();
  await lockOutreachRecipient(client, recipient);
  await orm(client)
    .insert(growthSuppressions)
    .values({ email: recipient, reason })
    .onConflictDoNothing();
  await orm(client)
    .update(growthMessages)
    .set({ state: "stopped" })
    .where(and(eq(growthMessages.recipient, recipient), eq(growthMessages.state, "queued")));
}

/** Replays stored failure effects once a send receipt or human reconciliation establishes mapping. */
export async function applyDeliveryFailure(
  client: PoolClient,
  message: { providerId: string; recipient: string },
) {
  // ponytail: bounded prototype receipts use a JSON lookup; index provider IDs if volume warrants it.
  const [failure] = await orm(client)
    .select()
    .from(growthReceipts)
    .where(
      and(
        inArray(growthReceipts.kind, ["email.bounced", "email.complained", "email.suppressed"]),
        sql`${growthReceipts.original}->'data'->>'email_id' = ${message.providerId}`,
      ),
    )
    .limit(1);
  if (failure) await suppressRecipient(client, message.recipient, failure.kind);
}

/** Freezes two reviewed steps, now and three days later. Approval never activates delivery.
 * @throws {AppError} For suppression, missing reviewed contact/identity/signal or key reuse.
 */
export async function enrollSequence(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(enrollmentSchema, raw);
  return changeProspect(actor, id, async (client, account) => {
    const contact = account.review?.contact;
    if (
      !account.contactable ||
      !contact ||
      (input.purpose === "buyer" && (!account.buyingSignal || account.fit !== "fit"))
    )
      throw new AppError(
        409,
        "REVIEW_REQUIRED",
        "Confirm identity, account fit, cited need and contact permission first.",
      );
    const recipient = contact.email.toLowerCase();
    await lockOutreachRecipient(client, recipient);
    if (input.invitationId) {
      const [invitation] = await orm(client)
        .select()
        .from(growthInvitations)
        .where(
          and(eq(growthInvitations.id, input.invitationId), eq(growthInvitations.accountId, id)),
        );
      if (
        !invitation ||
        invitation.body !== input.body ||
        invitation.recipient !== recipient ||
        input.key !== `feedback:${invitation.id}`
      )
        throw new AppError(
          409,
          "INVITATION_CHANGED",
          "Queue only the original reviewed invitation and recipient.",
        );
    }
    if (await suppressed(recipient, client))
      throw new AppError(409, "SUPPRESSED", "This recipient is suppressed.");
    const messages = await orm(client)
      .select()
      .from(growthMessages)
      .where(and(eq(growthMessages.accountId, id), eq(growthMessages.enrollmentKey, input.key)))
      .orderBy(asc(growthMessages.step));
    if (messages[0]) {
      if (
        messages[0].subject !== input.subject ||
        messages[0].body !== input.body ||
        messages[0].recipient !== recipient
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Enrollment key already has different content.",
        );
      return publicMessage(messages[0]);
    }
    const active = await orm(client)
      .select({ id: growthMessages.id })
      .from(growthMessages)
      .where(
        and(
          eq(growthMessages.accountId, id),
          inArray(growthMessages.state, ["queued", "dispatched", "uncertain"]),
        ),
      );
    if (active.length)
      throw new AppError(
        409,
        "SEQUENCE_ACTIVE",
        "Stop or reconcile the existing sequence before enrolling again.",
      );
    const base = createHash("sha256").update(`${id}:${input.key}`).digest("hex");
    const first = {
      id: `${base}:0`,
      accountId: id,
      enrollmentKey: input.key,
      step: 0,
      actorId: actor.userId,
      credential: actor.credential,
      recipient,
      subject: input.subject,
      body: input.body,
      dueAt: new Date(),
    };
    await orm(client)
      .insert(growthMessages)
      .values(
        input.invitationId
          ? [first]
          : [
              first,
              {
                ...first,
                id: `${base}:1`,
                step: 1,
                subject: `Follow-up: ${input.subject}`,
                dueAt: new Date(Date.now() + 3 * 86400000),
              },
            ],
      );
    await recordGrowthEvent(
      client,
      id,
      `enrollment:${base}`,
      "enrolled",
      "Human-reviewed two-step sequence; external delivery disabled unless separately activated",
    );
    return publicMessage({
      ...first,
      state: "queued" as const,
      providerId: null,
      dispatchedAt: null,
      sentAt: null,
    });
  });
}

/** Reads reviewed steps only after current ownership checks.
 * @throws {AppError} For lost ownership or revoked credentials.
 */
export async function readOutreach(actor: Actor, id: string) {
  await requireProspect(actor, id);
  const messages = await orm()
    .select()
    .from(growthMessages)
    .where(eq(growthMessages.accountId, id))
    .orderBy(asc(growthMessages.dueAt))
    .limit(100);
  await requireProspect(actor, id);
  return messages.map(publicMessage);
}

/** Stops queued steps; only delivery failures and opt-outs suppress the reviewed address.
 * Does not erase uncertain attempts.
 * @throws {AppError} For invalid reasons or lost access.
 */
export async function stopOutreach(actor: Actor, id: string, reason: unknown) {
  const parsed = parseInput(stopReason, reason);
  return changeProspect(actor, id, async (client, account) => {
    if (account.review?.contact) {
      await lockOutreachRecipient(client, account.review.contact.email);
      if (["opt_out", "bounce", "complaint"].includes(parsed))
        await suppressRecipient(client, account.review.contact.email, parsed);
    }
    await orm(client)
      .update(growthMessages)
      .set({ state: "stopped" })
      .where(and(eq(growthMessages.accountId, id), eq(growthMessages.state, "queued")));
    await recordGrowthEvent(client, id, `stop:${parsed}`, "stopped", parsed);
  });
}

/** Records human-reviewed provider evidence without retrying an uncertain send.
 * A definitive not-sent outcome stops the attempt; only a new reviewed enrollment can send again.
 * @throws {AppError} For invalid evidence, noninteractive calls or a nonuncertain attempt.
 */
export async function reconcileMessage(actor: Actor, accountId: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(
    z
      .object({
        messageId: z.string().min(1).max(200),
        providerId: z.string().min(1).max(200).nullable(),
        evidence: z.string().trim().min(1).max(1000),
      })
      .strict(),
    raw,
  );
  return changeProspect(actor, accountId, async (client) => {
    const [message] = await orm(client)
      .select()
      .from(growthMessages)
      .where(and(eq(growthMessages.id, input.messageId), eq(growthMessages.accountId, accountId)));
    if (!message || !["dispatched", "uncertain"].includes(message.state))
      throw new AppError(
        409,
        "RECONCILIATION_REQUIRED",
        "Only an uncertain attempt can be reconciled.",
      );
    if (input.providerId) {
      await lockProviderReceipt(client, input.providerId);
      const [accepted] = await orm(client)
        .select()
        .from(growthReceipts)
        .where(eq(growthReceipts.id, `accepted:${input.providerId}`));
      if (accepted && accepted.messageId !== message.id)
        throw new AppError(
          409,
          "RECEIPT_CONFLICT",
          "Provider acceptance belongs to another attempt.",
        );
    }
    await lockOutreachRecipient(client, message.recipient);
    const updated = await orm(client)
      .update(growthMessages)
      .set({
        state: input.providerId ? "sent" : "stopped",
        providerId: input.providerId,
        sentAt: input.providerId ? new Date() : null,
      })
      .where(
        and(
          eq(growthMessages.id, message.id),
          inArray(growthMessages.state, ["dispatched", "uncertain"]),
        ),
      )
      .returning({ id: growthMessages.id });
    if (!updated.length)
      throw new AppError(
        409,
        "RECONCILIATION_REQUIRED",
        "Attempt settled concurrently. Reload its receipt before reviewing.",
      );
    if (input.providerId) {
      await applyDeliveryFailure(client, {
        providerId: input.providerId,
        recipient: message.recipient,
      });
      await recordGrowthEvent(
        client,
        accountId,
        `sent:${message.id}`,
        "sent",
        "Human-verified provider acceptance; delivery not yet confirmed",
      );
    } else
      await orm(client)
        .update(growthMessages)
        .set({ state: "stopped" })
        .where(
          and(
            eq(growthMessages.accountId, accountId),
            eq(growthMessages.enrollmentKey, message.enrollmentKey),
            eq(growthMessages.state, "queued"),
          ),
        );
    await recordGrowthEvent(
      client,
      accountId,
      `reconciled:${message.id}`,
      "reconciled",
      `Human-reviewed ${input.providerId ? "accepted receipt" : "definitive not-sent"} evidence: ${input.evidence}`,
    );
  });
}

// Never retry a provider request, including rate limits or 5xx responses.
function resendProvider(): MailProvider {
  const {
    RESEND_API_KEY: key,
    RESEND_FROM: from,
    RESEND_REPLY_DOMAIN: domain,
    GROWTH_TEST_ALLOWLIST: allowlist,
  } = process.env;
  if (
    process.env.GROWTH_DELIVERY_MODE !== "allowlisted-test" ||
    !key ||
    !from ||
    !allowlist ||
    !domain ||
    !/^[a-z0-9.-]+$/i.test(domain)
  )
    throw new AppError(503, "DELIVERY_DISABLED", "External email delivery is disabled.");
  const allowed = allowlist.split(",").map((email) => email.trim().toLowerCase());
  return async (message) => {
    if (!allowed.includes(message.recipient.toLowerCase()))
      throw new AppError(403, "RECIPIENT_DENIED", "Recipient is not allowlisted.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.id,
      },
      body: JSON.stringify({
        from,
        to: [message.recipient],
        subject: message.subject,
        text: message.body,
        reply_to: message.replyReference
          ? `feedback+${message.replyReference}@${domain}`
          : `outreach+${message.id.replace(":", "-")}@${domain}`,
      }),
    });
    if (!response.ok) throw new Error("Resend did not return an accepted receipt");
    return z.object({ id: z.string().min(1) }).parse(await response.json());
  };
}

/** Dispatches one numbered durable attempt. Lost receipts require operator reconciliation.
 * @throws {AppError} For disabled delivery, suppression, premature work or uncertain outcomes.
 */
export async function dispatchMessage(id: string, controlled?: MailProvider) {
  const provider = controlled ?? resendProvider();
  const [initial] = await orm().select().from(growthMessages).where(eq(growthMessages.id, id));
  if (!initial) throw new AppError(404, "NOT_FOUND", "Message not found.");
  const actor = messageActor(initial);
  const admitted = await changeProspect(actor, initial.accountId, async (client, account) => {
    await lockOutreachRecipient(client, initial.recipient);
    const [message] = await orm(client)
      .select()
      .from(growthMessages)
      .where(eq(growthMessages.id, id));
    if (!message) throw new AppError(404, "NOT_FOUND", "Message not found.");
    if (message.state === "sent" || message.state === "stopped") return null;
    if (message.state !== "queued")
      throw new AppError(
        409,
        "SEND_UNCERTAIN",
        "Prior dispatch may have sent. Reconcile the provider receipt; never blindly retry.",
      );
    if (
      !account.contactable ||
      account.review?.contact?.email.toLowerCase() !== message.recipient ||
      (!sourcingKey.test(message.enrollmentKey) &&
        (!account.buyingSignal || account.fit !== "fit")) ||
      (await suppressed(message.recipient, client))
    ) {
      await orm(client)
        .update(growthMessages)
        .set({ state: "stopped" })
        .where(eq(growthMessages.id, id));
      return null;
    }
    if (message.dueAt.getTime() > Date.now())
      throw new AppError(409, "NOT_DUE", "Message is not due.");
    const unfinished = await orm(client)
      .select()
      .from(growthMessages)
      .where(
        and(
          eq(growthMessages.accountId, message.accountId),
          eq(growthMessages.enrollmentKey, message.enrollmentKey),
          lt(growthMessages.step, message.step),
          ne(growthMessages.state, "sent"),
        ),
      );
    if (unfinished.length)
      throw new AppError(409, "PRIOR_STEP_PENDING", "Earlier sequence step has not completed.");
    const updated = await orm(client)
      .update(growthMessages)
      .set({ state: "dispatched", dispatchedAt: new Date() })
      .where(and(eq(growthMessages.id, id), eq(growthMessages.state, "queued")))
      .returning({ id: growthMessages.id });
    return updated.length ? message : null;
  });
  if (!admitted) return;
  try {
    const receipt = await provider({
      id,
      recipient: admitted.recipient,
      subject: admitted.subject,
      body: admitted.body,
      ...(admitted.enrollmentKey.startsWith("feedback:")
        ? { replyReference: admitted.enrollmentKey.slice(9) }
        : {}),
    });
    const client = await database().connect();
    try {
      await orm(client).execute(sql`begin`);
      await lockProviderReceipt(client, receipt.id);
      await lockOutreachRecipient(client, admitted.recipient);
      // Preserve contradictory late acceptance for subsequent webhooks without reviving stopped work.
      await orm(client)
        .insert(growthReceipts)
        .values({
          id: `accepted:${receipt.id}`,
          messageId: id,
          kind: "provider.accepted",
          original: receipt,
        })
        .onConflictDoNothing();
      const updated = await orm(client)
        .update(growthMessages)
        .set({ state: "sent", providerId: receipt.id, sentAt: new Date() })
        .where(
          and(
            eq(growthMessages.id, id),
            inArray(growthMessages.state, ["dispatched", "uncertain"]),
          ),
        )
        .returning({ id: growthMessages.id });
      await applyDeliveryFailure(client, { providerId: receipt.id, recipient: admitted.recipient });
      if (updated.length)
        await recordGrowthEvent(
          client,
          admitted.accountId,
          `sent:${id}`,
          "sent",
          controlled
            ? "Controlled provider receipt; no external delivery"
            : "Resend accepted; delivery not yet confirmed",
        );
      await orm(client).execute(sql`commit`);
    } catch (error) {
      await orm(client).execute(sql`rollback`);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    await orm()
      .update(growthMessages)
      .set({ state: "uncertain" })
      .where(and(eq(growthMessages.id, id), eq(growthMessages.state, "dispatched")));
    throw new AppError(
      409,
      "SEND_UNCERTAIN",
      "Dispatch outcome is uncertain. Do not retry; reconcile with provider evidence.",
    );
  }
}
