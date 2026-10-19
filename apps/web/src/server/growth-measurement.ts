import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";
import { database, orm } from "./db";
import { growthAccounts, growthTelemetry, outreachExperiments } from "./db-schema";
import { captureBusinessEvent } from "./posthog";

/** Fixed reply-qualification window, inclusive at the endpoint. */
export const outreachWindowMs = 14 * 86400000;

/** Projects only newly committed allowlisted transitions, never the event's private detail. */
export async function recordGrowthMeasurement(
  client: PoolClient,
  accountId: string,
  key: string,
  kind: string,
) {
  if (process.env.POSTHOG_ENABLED !== "true") return;
  const kinds: Record<string, string> = {
    sent: "outreach_accepted",
    qualified: "qualified",
    opportunity_created: "opportunity_created",
    progressed: "progressed",
    closed_lost: "closed_lost",
  };
  const mapped = kinds[kind];
  if (!mapped) return;
  const [account] = await orm(client)
    .select()
    .from(growthAccounts)
    .where(eq(growthAccounts.id, accountId));
  if (!account) return;
  const { synthetic } = z.object({ synthetic: z.boolean() }).parse(account.directory);
  if (mapped) {
    await orm(client)
      .insert(growthTelemetry)
      .values({
        id: `${accountId}:${key}:${mapped}`,
        accountId,
        scopeId: account.ownerId,
        synthetic,
        kind: mapped,
        messageId: kind === "sent" ? key.slice(5) : null,
      })
      .onConflictDoNothing();
    if (kind === "qualified") {
      await orm(client)
        .update(outreachExperiments)
        .set({ qualifiedAt: new Date() })
        .where(
          and(
            eq(outreachExperiments.accountId, accountId),
            isNull(outreachExperiments.qualifiedAt),
          ),
        );
    }
  }
}

// Delivery receipts may arrive before acceptance is mapped. Only a new, scoped acceptance
// observation permits projection, so this never backfills historical scope from a current owner.
async function projectDeliveries() {
  const client = await database().connect();
  try {
    await client.query("begin");
    const rows = await client.query<{
      id: string;
      account_id: string;
      scope_id: string;
      synthetic: boolean;
      created_at: Date;
      enrollment_key: string;
    }>(`
      select r.id, t.account_id, t.scope_id, t.synthetic, r.created_at, m.enrollment_key
      from signal_desk.growth_receipts r
      left join signal_desk.growth_receipts accepted on accepted.id='accepted:' || (r.original->'data'->>'email_id')
      join signal_desk.growth_messages m on m.id=accepted.message_id or m.provider_id=r.original->'data'->>'email_id'
      join signal_desk.growth_telemetry t on t.message_id=m.id and t.kind='outreach_accepted'
      where r.kind='email.delivered' and not exists
        (select 1 from signal_desk.growth_telemetry done where done.id='delivery:' || r.id)
      order by r.created_at,r.id limit 100`);
    for (const row of rows.rows) {
      await orm(client)
        .insert(growthTelemetry)
        .values({
          id: `delivery:${row.id}`,
          accountId: row.account_id,
          scopeId: row.scope_id,
          synthetic: row.synthetic,
          kind: "outreach_delivered",
          occurredAt: row.created_at,
        })
        .onConflictDoNothing();
      const exposed = await orm(client)
        .update(outreachExperiments)
        .set({ exposedAt: row.created_at })
        .where(
          and(
            eq(outreachExperiments.accountId, row.account_id),
            eq(outreachExperiments.enrollmentKey, row.enrollment_key),
            isNull(outreachExperiments.exposedAt),
          ),
        )
        .returning();
      for (const assignment of exposed)
        await orm(client)
          .insert(growthTelemetry)
          .values({
            id: `${assignment.accountId}:exposure`,
            accountId: assignment.accountId,
            scopeId: assignment.scopeId,
            synthetic: assignment.synthetic,
            kind: "exposed",
            variant: assignment.variant,
            occurredAt: row.created_at,
          })
          .onConflictDoNothing();
    }
    // A human-qualified reply is an outcome only after confirmed delivery and within 14 days.
    await client.query(`insert into signal_desk.growth_telemetry
      (id,account_id,scope_id,synthetic,kind,variant,occurred_at)
      select account_id || ':qualified-window', account_id, scope_id, synthetic,
        'qualified_reply', variant, qualified_at from signal_desk.outreach_experiments
      where qualified_at >= exposed_at and qualified_at <= exposed_at + interval '14 days'
      on conflict do nothing`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Best-effort bounded delivery, outside business transactions. Vendor failure leaves durable work.
 * Concurrent workers may resend the same stable UUID; vendor ingestion is not exactly-once.
 */
export async function drainGrowthTelemetry() {
  if (process.env.POSTHOG_ENABLED !== "true") return;
  try {
    await projectDeliveries();
    const pending = await orm()
      .select()
      .from(growthTelemetry)
      .where(isNull(growthTelemetry.deliveredAt))
      .orderBy(
        sql`${growthTelemetry.attemptedAt} nulls first`,
        asc(growthTelemetry.occurredAt),
        asc(growthTelemetry.id),
      )
      .limit(25);
    for (const row of pending) {
      await orm()
        .update(growthTelemetry)
        .set({ attemptedAt: new Date() })
        .where(eq(growthTelemetry.id, row.id));
      const delivered = await captureBusinessEvent({
        scopeId: row.scopeId,
        accountId: row.accountId,
        synthetic: row.synthetic,
        key: row.id,
        kind: row.kind,
        occurredAt: row.occurredAt.toISOString(),
        ...(row.variant ? { variant: row.variant } : {}),
      });
      if (delivered)
        await orm()
          .update(growthTelemetry)
          .set({ deliveredAt: new Date() })
          .where(eq(growthTelemetry.id, row.id));
    }
  } catch {
    // Measurement never prevents operational work. Pending facts survive the next worker sweep.
  }
}
