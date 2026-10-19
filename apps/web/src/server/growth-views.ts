import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { organizationSchema } from "@signal-desk/contracts/municipality-schema";
import type { Actor } from "./access";
import { requireSession, requireOpportunity } from "./access";
import { orm } from "./db";
import {
  growthAccounts,
  growthEvents,
  growthSchedules,
  growthMessages,
  inferenceBudgets,
  organizations,
  opportunities,
  opportunityMembers,
  vehicles,
} from "./db-schema";
import { AppError } from "./errors";
import { readGrowthInsights } from "../agents/growth";
import { readFeedback } from "./feedback";
import { readReceivedReplies } from "./growth-integrations";
import {
  changeProspect,
  getProspect,
  listProspects,
  recordGrowthEvent,
  requireGrowthActor,
} from "./growth";
import { readOutreach } from "./outreach";
import { parseInput } from "./validation";

/** Reads durable enrichment, source provenance, answers and inferences for one owned account.
 * @throws {AppError} For revoked credentials or inaccessible accounts.
 */
export async function getGrowthProfile(actor: Actor, id: string) {
  const account = await getProspect(actor, id);
  const feedback = await readFeedback(actor, id);
  const replies = await readReceivedReplies(actor, id);
  const insights = await readGrowthInsights(actor, id);
  const outreach = await readOutreach(actor, id);
  const events = await orm()
    .select()
    .from(growthEvents)
    .where(eq(growthEvents.accountId, id))
    .orderBy(asc(growthEvents.createdAt))
    .limit(100);
  await getProspect(actor, id);
  return { account, feedback, replies, insights, outreach, events };
}

/** Finds an owned discovery record without exposing another specialist's enrichment.
 * @throws {AppError} For revoked specialist access.
 */
export async function getOrganizationGrowth(actor: Actor, organizationId: string) {
  const current = await requireGrowthActor(actor);
  const [account] = await orm()
    .select({ id: growthAccounts.id })
    .from(growthAccounts)
    .where(
      and(
        eq(growthAccounts.organizationId, organizationId),
        eq(growthAccounts.ownerId, current.userId),
      ),
    );
  return account ? getGrowthProfile(actor, account.id) : null;
}

/** Reads a buyer or seller account only through an assigned deal, retaining its actual relationship.
 * @throws {AppError} For missing membership or revoked access.
 */
export async function getAccountProfile(actor: Actor, id: string) {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select({
      organization: organizations,
      opportunityId: opportunities.id,
      title: vehicles.title,
      sellerId: vehicles.ownerOrganizationId,
    })
    .from(organizations)
    .innerJoin(opportunities, sql`true`)
    .innerJoin(vehicles, eq(vehicles.id, opportunities.vehicle_id))
    .innerJoin(
      opportunityMembers,
      and(
        eq(opportunityMembers.opportunity_id, opportunities.id),
        eq(opportunityMembers.user_id, current.userId),
      ),
    )
    .where(
      and(
        eq(organizations.id, id),
        or(
          eq(organizations.id, opportunities.organization_id),
          eq(organizations.buyerId, opportunities.buyer_id),
          eq(organizations.id, vehicles.ownerOrganizationId),
        ),
      ),
    )
    .limit(100);
  if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Account not found.");
  for (const row of rows) await requireOpportunity(actor, row.opportunityId, "specialist");
  const growth = await getOrganizationGrowth(actor, id);
  return {
    organization: organizationSchema.parse(rows[0].organization),
    deals: rows.map((row) => ({
      id: row.opportunityId,
      title: row.title,
      relationship: row.sellerId === id ? "seller" : "buyer",
    })),
    growth,
  };
}

/** Confirms a discovery match to an existing buyer or seller without changing its role or deal state.
 * @throws {AppError} For a different existing match or lack of assigned-deal access.
 */
export async function linkProspectAccount(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(z.object({ organizationId: z.string().min(1).max(200) }).strict(), raw);
  const profile = await getAccountProfile(actor, input.organizationId);
  return changeProspect(actor, id, async (client, account) => {
    await requireOpportunity(actor, profile.deals[0]!.id, "specialist", client);
    await orm(client).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${account.ownerId}:${input.organizationId}`}, 76051))`,
    );
    const duplicate = await orm(client)
      .select({ id: growthAccounts.id })
      .from(growthAccounts)
      .where(
        and(
          eq(growthAccounts.ownerId, account.ownerId),
          eq(growthAccounts.organizationId, input.organizationId),
          ne(growthAccounts.id, id),
        ),
      )
      .limit(1);
    if (duplicate.length)
      throw new AppError(
        409,
        "MATCH_CONFLICT",
        "Review the existing prospect match before linking another source.",
      );
    if (account.organizationId && account.organizationId !== input.organizationId)
      throw new AppError(409, "MATCH_CONFLICT", "Account already has another confirmed match.");
    await orm(client)
      .update(growthAccounts)
      .set({ organizationId: input.organizationId })
      .where(eq(growthAccounts.id, id));
    await recordGrowthEvent(
      client,
      id,
      `matched:${input.organizationId}`,
      "identity_matched",
      "Human-confirmed existing account match; buyer/seller relationship unchanged",
    );
  });
}

/** Returns reconciled page counts and operator diagnostics, never credentials.
 * Counts describe the displayed page, not a population-wide or causal estimate.
 * @throws {AppError} For revoked credentials.
 */
export async function getGrowthOperations(actor: Actor, cursor = "") {
  const current = await requireGrowthActor(actor);
  const accounts = await listProspects(actor, cursor);
  const events = accounts.length
    ? await orm()
        .select({
          kind: growthEvents.kind,
          count: sql<number>`count(distinct ${growthEvents.accountId})::int`,
        })
        .from(growthEvents)
        .innerJoin(growthAccounts, eq(growthAccounts.id, growthEvents.accountId))
        .where(
          and(
            eq(growthAccounts.ownerId, current.userId),
            inArray(
              growthEvents.accountId,
              accounts.map((account) => account.id),
            ),
          ),
        )
        .groupBy(growthEvents.kind)
    : [];
  const schedules = await orm()
    .select({
      id: growthSchedules.id,
      configuration: growthSchedules.configuration,
      nextAt: growthSchedules.nextAt,
      leaseUntil: growthSchedules.leaseUntil,
      lastCode: growthSchedules.lastCode,
      durationMs: growthSchedules.durationMs,
    })
    .from(growthSchedules)
    .where(eq(growthSchedules.actorId, current.userId))
    .limit(100);
  const count = (kind: string) => events.find((event) => event.kind === kind)?.count ?? 0;
  const backlog = accounts.length
    ? await orm()
        .select({
          state: growthMessages.state,
          count: sql<number>`count(*)::int`,
          oldestDue: sql<Date | null>`min(${growthMessages.dueAt})`,
        })
        .from(growthMessages)
        .innerJoin(growthAccounts, eq(growthAccounts.id, growthMessages.accountId))
        .where(
          and(
            eq(growthAccounts.ownerId, current.userId),
            inArray(
              growthMessages.accountId,
              accounts.map((account) => account.id),
            ),
          ),
        )
        .groupBy(growthMessages.state)
    : [];
  const [budget] = await orm()
    .select({
      spentMicroUsd: inferenceBudgets.spent_micro_usd,
      reservedMicroUsd: inferenceBudgets.reserved_micro_usd,
      active: inferenceBudgets.active,
    })
    .from(inferenceBudgets)
    .where(eq(inferenceBudgets.scope, current.userId));
  if (accounts.length) {
    const owned = await orm()
      .select({ id: growthAccounts.id })
      .from(growthAccounts)
      .where(
        and(
          eq(growthAccounts.ownerId, current.userId),
          inArray(
            growthAccounts.id,
            accounts.map((account) => account.id),
          ),
        ),
      );
    if (owned.length !== accounts.length)
      throw new AppError(404, "NOT_FOUND", "Account ownership changed. Reload operations.");
  }
  await requireGrowthActor(actor);
  return {
    accounts,
    schedules,
    backlog,
    budget: budget ?? null,
    counts: {
      discovered: accounts.length,
      fit: accounts.filter((account) => account.fit === "fit").length,
      contactable: accounts.filter((account) => account.contactable).length,
      qualified: accounts.filter((account) => account.qualified).length,
      sent: count("sent"),
      replied: count("reply"),
      closedLost: count("closed_lost"),
      interventions: count("intervention"),
      progressed: count("progressed"),
    },
    nextCursor: accounts.length === 100 ? accounts.at(-1)?.id : null,
    delivery:
      process.env.GROWTH_DELIVERY_MODE === "allowlisted-test"
        ? "Allowlisted test policy configured; not production delivery"
        : "External delivery disabled",
    analysis:
      process.env.GROWTH_ANALYSIS_ENABLED === "true"
        ? "Configured; spending admission required"
        : "Live background analysis disabled",
    forms:
      process.env.GROWTH_FORMS_CONFIG && process.env.GOOGLE_FORMS_ACCESS_TOKEN
        ? "Configured; scheduled reads required"
        : "Forms disabled; OAuth and versioned question mapping required",
  };
}

/** Records a human-reported intervention or outcome with its evidence, without claiming causation.
 * @throws {AppError} For invalid input, noninteractive actions or revoked access.
 */
export async function recordGrowthOutcome(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(
    z
      .object({
        key: z.string().min(1).max(100),
        kind: z.enum(["intervention", "progressed", "closed_lost"]),
        detail: z.string().trim().min(1).max(1000),
        evidence: z.string().trim().min(1).max(1000),
      })
      .strict(),
    raw,
  );
  return changeProspect(actor, id, async (client) => {
    const key = `outcome:${input.key}`;
    const detail = `${input.detail}\nHuman-reported evidence: ${input.evidence}. Association is not causation.`;
    const [existing] = await orm(client)
      .select()
      .from(growthEvents)
      .where(eq(growthEvents.id, `${id}:${key}`));
    if (existing && (existing.kind !== input.kind || existing.detail !== detail))
      throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Outcome key already has different content.");
    await recordGrowthEvent(client, id, key, input.kind, detail);
  });
}
