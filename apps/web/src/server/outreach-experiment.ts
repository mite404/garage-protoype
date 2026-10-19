import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { requireSession, type Actor } from "./access";
import { orm } from "./db";
import { growthMessages, growthTelemetry, outreachExperiments } from "./db-schema";
import { AppError } from "./errors";
import { changeProspect, requireGrowthActor, requireProspect } from "./growth";
import { assignOutreachVariant } from "./posthog";
import { outreachWindowMs } from "./growth-measurement";

function draft(
  account: Awaited<ReturnType<typeof requireProspect>>,
  variant: "control" | "evidence_first",
) {
  const request = "Would a short conversation about the vehicle need be useful?";
  const evidence = `Your reviewed source says: “${account.buyingSignal?.quote}”.`;
  return {
    subject: "A question about your vehicle need",
    body: `${variant === "control" ? `${request}\n\n${evidence}` : `${evidence}\n\n${request}`}\n\nReply STOP to opt out.`,
  };
}

async function noteEligibility(
  client: PoolClient,
  account: Awaited<ReturnType<typeof requireProspect>>,
) {
  if (!account.contactable || account.fit !== "fit" || !account.buyingSignal || account.qualified)
    throw new AppError(
      409,
      "EXPERIMENT_INELIGIBLE",
      "Review an unqualified buyer account, cited need and permitted contact first.",
    );
  const prior = await orm(client)
    .select({ id: growthMessages.id })
    .from(growthMessages)
    .where(eq(growthMessages.accountId, account.id))
    .limit(1);
  if (prior.length)
    throw new AppError(
      409,
      "EXPERIMENT_INELIGIBLE",
      "Previously enrolled accounts are outside this experiment.",
    );
  await orm(client)
    .insert(growthTelemetry)
    .values({
      id: `${account.ownerId}:${account.id}:eligible`,
      accountId: account.id,
      scopeId: account.ownerId,
      synthetic: account.directory.synthetic,
      kind: "eligible",
    })
    .onConflictDoNothing();
}

/** Reads only the currently owned account allocation. No read assigns a variant or exposes it.
 * @throws {AppError} For revoked access or an inaccessible account.
 */
export async function readOutreachExperiment(actor: Actor, id: string) {
  await requireProspect(actor, id);
  const [row] = await orm()
    .select()
    .from(outreachExperiments)
    .where(eq(outreachExperiments.accountId, id));
  await requireProspect(actor, id);
  return row ?? null;
}

/** Allocates a never-contacted eligible buyer account once, freezing its reviewed approach.
 * Null means collection/assignment is unavailable; normal outreach stays available outside the trial.
 * @throws {AppError} For ineligible accounts, prior outreach or revoked interactive access.
 */
export async function prepareOutreachExperiment(actor: Actor, id: string, _input: unknown) {
  requireSession(actor);
  await requireProspect(actor, id);
  const existing = await readOutreachExperiment(actor, id);
  if (existing) return existing;
  if (process.env.POSTHOG_ENABLED !== "true") return null;
  const account = await changeProspect(actor, id, async (client, current) => {
    await noteEligibility(client, current);
    return current;
  });
  const variant = await assignOutreachVariant({
    scopeId: account.ownerId,
    accountId: id,
    synthetic: account.directory.synthetic,
  });
  if (!variant) return null;
  return changeProspect(actor, id, async (client, current) => {
    const [saved] = await orm(client)
      .select()
      .from(outreachExperiments)
      .where(eq(outreachExperiments.accountId, id));
    if (saved) return saved;
    await noteEligibility(client, current);
    // Routing may change while the vendor is evaluated. Never apply a different owner's allocation.
    if (current.ownerId !== account.ownerId)
      throw new AppError(409, "ACCOUNT_CHANGED", "Reload after routing.");
    const [assignment] = await orm(client)
      .insert(outreachExperiments)
      .values({
        accountId: id,
        scopeId: current.ownerId,
        synthetic: current.directory.synthetic,
        variant,
        ...draft(current, variant),
      })
      .returning();
    await orm(client)
      .insert(growthTelemetry)
      .values({
        id: `${id}:assigned`,
        accountId: id,
        scopeId: current.ownerId,
        synthetic: current.directory.synthetic,
        kind: "assigned",
        variant,
      })
      .onConflictDoNothing();
    return assignment ?? null;
  });
}

/** Binds only the reviewed experimental enrollment, never sourcing or feedback, under its account lock.
 * @throws {AppError} For changed drafts, prior non-trial outreach or a different enrollment key.
 */
export async function bindOutreachExperiment(
  client: PoolClient,
  account: Awaited<ReturnType<typeof requireProspect>>,
  input: {
    key: string;
    subject: string;
    body: string;
    purpose: string;
    invitationId?: string;
    experiment: boolean;
  },
) {
  if (!input.experiment) return;
  if (process.env.POSTHOG_ENABLED !== "true")
    throw new AppError(
      409,
      "EXPERIMENT_PAUSED",
      "Trial collection is disabled. Do not queue a trial message.",
    );
  const accountId = account.id;
  const [assignment] = await orm(client)
    .select()
    .from(outreachExperiments)
    .where(eq(outreachExperiments.accountId, accountId));
  if (
    !assignment ||
    input.purpose !== "buyer" ||
    input.invitationId ||
    assignment.subject !== input.subject ||
    assignment.body !== input.body ||
    draft(account, assignment.variant).body !== assignment.body ||
    assignment.synthetic !== account.directory.synthetic
  )
    throw new AppError(
      409,
      "EXPERIMENT_REVIEW_REQUIRED",
      "Prepare and review the assigned approach without changing its text.",
    );
  if (assignment.enrollmentKey && assignment.enrollmentKey !== input.key)
    throw new AppError(
      409,
      "EXPERIMENT_ENROLLED",
      "This account already has an experimental enrollment.",
    );
  const prior = await orm(client)
    .select({ id: growthMessages.id })
    .from(growthMessages)
    .where(
      and(
        eq(growthMessages.accountId, accountId),
        sql`${growthMessages.enrollmentKey} <> ${input.key}`,
      ),
    )
    .limit(1);
  if (prior.length)
    throw new AppError(409, "EXPERIMENT_INELIGIBLE", "Other outreach excludes this account.");
  await orm(client)
    .update(outreachExperiments)
    .set({ enrollmentKey: input.key })
    .where(eq(outreachExperiments.accountId, accountId));
}

function uncertainty(successes: number, total: number) {
  if (!total) return "Not estimable";
  const p = successes / total,
    z = 1.96,
    d = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return `${(100 * (centre - half)).toFixed(1)}–${(100 * (centre + half)).toFixed(1)}% (95% Wilson)`;
}

/** Reports full scoped trial denominators, separating synthetic runs and immature windows.
 * Qualified means a human confirmed the evidence-qualified reply within the delivery window.
 * @throws {AppError} For ended specialist access.
 */
export async function readExperimentReport(actor: Actor) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select()
    .from(outreachExperiments)
    .where(eq(outreachExperiments.scopeId, current.userId));
  const eligible = await orm()
    .select()
    .from(growthTelemetry)
    .where(and(eq(growthTelemetry.scopeId, current.userId), eq(growthTelemetry.kind, "eligible")));
  await requireGrowthActor(actor);
  const cohorts = [false, true].flatMap((synthetic) =>
    (["control", "evidence_first"] as const).map((variant) => {
      const accounts = rows.filter((row) => row.synthetic === synthetic && row.variant === variant);
      const exposed = accounts.filter((row) => row.exposedAt);
      const mature = exposed.filter(
        (row) => Date.now() - row.exposedAt!.getTime() >= outreachWindowMs,
      );
      const qualified = mature.filter(
        (row) =>
          row.qualifiedAt &&
          row.qualifiedAt >= row.exposedAt! &&
          row.qualifiedAt.getTime() - row.exposedAt!.getTime() <= outreachWindowMs,
      ).length;
      return {
        synthetic,
        variant,
        assigned: accounts.length,
        exposed: exposed.length,
        pending: exposed.length - mature.length,
        mature: mature.length,
        qualified,
        interval: uncertainty(qualified, mature.length),
      };
    }),
  );
  return {
    cohorts,
    eligibility: [false, true].map((synthetic) => ({
      synthetic,
      eligible: eligible.filter((row) => row.synthetic === synthetic).length,
      unassigned: eligible.filter(
        (row) =>
          row.synthetic === synthetic &&
          !rows.some((assignment) => assignment.accountId === row.accountId),
      ).length,
    })),
  };
}
