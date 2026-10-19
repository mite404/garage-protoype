import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  feedbackAnswer,
  feedbackEmail,
  feedbackSurvey,
  parseFeedbackReply,
} from "@signal-desk/contracts/feedback-schema";
import { requireOpportunity, requireSession, type Actor } from "./access";
import { orm } from "./db";
import { growthFeedback, growthInvitations } from "./db-schema";
import { AppError } from "./errors";
import { changeProspect, recordGrowthEvent, requireProspect } from "./growth";
import { parseInput } from "./validation";

const submissionSchema = z
  .object({
    channel: z.enum(["email", "forms"]),
    externalId: z.string().min(1).max(200),
    reference: z.string().min(1).max(200),
    original: z.union([z.string().max(10000), feedbackAnswer]),
    submittedAt: z.iso.datetime(),
  })
  .strict();

function optionalForm(reference: string) {
  if (!process.env.GROWTH_FORMS_INVITATION_URL) return undefined;
  const url = new URL(process.env.GROWTH_FORMS_INVITATION_URL);
  const entry = process.env.GROWTH_FORMS_REFERENCE_ENTRY;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    !entry ||
    !/^entry\.\d+$/.test(entry)
  )
    throw new AppError(
      503,
      "FORMS_DISABLED",
      "A reviewed Google Forms URL and reference entry are required.",
    );
  url.searchParams.set(entry, reference);
  return url.toString();
}

/** Records a reviewed call and prepares a versioned invitation, never sends it.
 * @throws {AppError} For missing contact, missing deal access or invalid input.
 */
export async function inviteFeedback(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(
    z
      .object({
        callKey: z.string().trim().min(1).max(200),
        stage: z.enum(["post_call", "onboarding"]),
      })
      .strict(),
    raw,
  );
  return changeProspect(actor, id, async (client, account) => {
    if (!account.opportunityId || !account.review?.contact)
      throw new AppError(
        409,
        "CALL_REQUIRED",
        "A qualified deal and reviewed contact are required.",
      );
    await requireOpportunity(actor, account.opportunityId, "specialist", client);
    const [existing] = await orm(client)
      .select()
      .from(growthInvitations)
      .where(
        and(
          eq(growthInvitations.accountId, id),
          eq(growthInvitations.callKey, input.callKey),
          eq(growthInvitations.version, feedbackSurvey.version),
        ),
      );
    if (existing) {
      if (existing.stage !== input.stage)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Call already has a different feedback stage.",
        );
      return existing;
    }
    const reference = randomUUID();
    // Onboarding asks about actual effort only after a human records that stage.
    const body = feedbackEmail(reference, optionalForm(reference)).replace(
      "Expected setup effort",
      input.stage === "onboarding" ? "Actual onboarding effort" : "Expected setup effort",
    );
    const [invitation] = await orm(client)
      .insert(growthInvitations)
      .values({
        id: reference,
        accountId: id,
        callKey: input.callKey,
        recipient: account.review.contact.email.toLowerCase(),
        version: feedbackSurvey.version,
        stage: input.stage,
        body,
      })
      .returning();
    if (!invitation) throw new Error("Invitation insert did not return a row");
    await recordGrowthEvent(
      client,
      id,
      `invited:${reference}`,
      "invitation_prepared",
      "Prepared only; not sent. A reference is correlation, not authentication.",
    );
    return invitation;
  });
}

/** Normalizes a provider-verified submission. Call only from trusted inbound adapters.
 * Keeps unknown references unattributed and preserves every distinct original submission.
 * @throws {AppError} For malformed or conflicting provider response IDs.
 */
export async function submitFeedback(raw: unknown) {
  const input = parseInput(submissionSchema, raw);
  const [invitation] = await orm()
    .select()
    .from(growthInvitations)
    .where(eq(growthInvitations.id, input.reference));
  const answer =
    input.channel === "email" && typeof input.original === "string"
      ? parseFeedbackReply(input.original)
      : (feedbackAnswer.safeParse(input.original).data ?? null);
  const values = {
    id: randomUUID(),
    invitationId: invitation?.id ?? null,
    reference: input.reference,
    channel: input.channel,
    externalId: input.externalId,
    original: input.original,
    answer,
    submittedAt: new Date(input.submittedAt),
  };
  const inserted = await orm()
    .insert(growthFeedback)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    const [existing] = await orm()
      .select()
      .from(growthFeedback)
      .where(
        and(
          eq(growthFeedback.channel, input.channel),
          eq(growthFeedback.externalId, input.externalId),
        ),
      );
    if (
      !existing ||
      !isDeepStrictEqual(existing.original, input.original) ||
      existing.reference !== input.reference
    )
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Response ID already contains different source material.",
      );
  }
  return { attributed: Boolean(invitation), explicit: answer !== null };
}

/** Reads one latest explicit answer per invitation and flags prose separately.
 * Submitted references are unverified correlation and never a profile-access credential.
 * @throws {AppError} For revoked or reassigned accounts.
 */
export async function readFeedback(actor: Actor, id: string) {
  await requireProspect(actor, id);
  const invitations = await orm()
    .select()
    .from(growthInvitations)
    .where(eq(growthInvitations.accountId, id));
  const submissions = invitations.length
    ? await orm()
        .select()
        .from(growthFeedback)
        .where(
          inArray(
            growthFeedback.invitationId,
            invitations.map((invitation) => invitation.id),
          ),
        )
        .orderBy(asc(growthFeedback.submittedAt), asc(growthFeedback.id))
    : [];
  const latest = new Map<
    string,
    {
      invitationId: string;
      recipient: string;
      stage: string;
      channel: string;
      answer: z.infer<typeof feedbackAnswer>;
    }
  >();
  for (const submission of submissions) {
    const invitation = invitations.find((entry) => entry.id === submission.invitationId);
    if (!invitation || !submission.answer) continue;
    latest.set(`${invitation.recipient}:${invitation.stage}`, {
      invitationId: invitation.id,
      recipient: invitation.recipient,
      stage: invitation.stage,
      channel: submission.channel,
      answer: feedbackAnswer.parse(submission.answer),
    });
  }
  await requireProspect(actor, id);
  return {
    invitations,
    submissions,
    respondents: [...latest.values()],
    ambiguous: submissions.filter((submission) => !submission.answer),
    attribution: "Unverified invitation correlation; forwarded links do not verify identity",
  };
}
