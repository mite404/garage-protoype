import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  refreshActor,
  requireSession,
  requireWrite,
  requireOpportunity,
  type Actor,
} from "./access";
import { beginLocked, database, orm } from "./db";
import {
  growthAccounts,
  growthEvents,
  growthObservations,
  growthTerritories,
  identities,
  organizations,
  opportunities,
  opportunityMembers,
  sources,
  evidenceBlockers,
  vehicles,
} from "./db-schema";
import { AppError } from "./errors";
import { parseInput } from "./validation";
import { recordGrowthMeasurement } from "./growth-measurement";

const text = z.string().trim().min(1).max(1000);
const directoryRow = z.object({
  sourceId: text.max(100),
  name: text.max(200),
  city: text.max(100),
  state: z.string().trim().length(2),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  website: z.url().max(500).optional(),
});
const directorySchema = directoryRow.extend({ synthetic: z.boolean() });
const snapshotSchema = z
  .object({
    source: z.literal("usfa"),
    snapshot: text.max(200),
    synthetic: z.boolean(),
    rows: z.array(directoryRow).min(1).max(10000),
  })
  .strict();
const quoteRule = "Copy the supporting quote word for word from the original buying-signal text.";
const reviewSchema = z
  .object({
    name: text.max(200),
    fit: z.enum(["unknown", "fit", "not_fit"]),
    identity: z.enum(["confirmed", "needs_review", "rejected"]),
    signal: z
      .object({
        text,
        source: text,
        quote: text,
        permission: z.enum(["synthetic", "permissioned"]),
      })
      .refine((v) => v.text.includes(v.quote), quoteRule)
      .nullable(),
    contact: z
      .object({
        name: text.max(200),
        email: z.email().max(254),
        permission: z.enum(["unknown", "allowlisted_test", "permissioned"]),
        provenance: text,
      })
      .nullable(),
  })
  .strict();

function projection(row: typeof growthAccounts.$inferSelect) {
  const directory = directorySchema.parse(row.directory);
  const review = row.review === null ? null : reviewSchema.parse(row.review);
  return {
    id: row.id,
    ownerId: row.ownerId,
    organizationId: row.organizationId,
    opportunityId: row.opportunityId,
    name: review?.name ?? directory.name,
    directory,
    review,
    routing: row.routing,
    identityState: row.identityState,
    fit: review?.fit ?? "unknown",
    buyingSignal: review?.signal ?? null,
    contactable: Boolean(
      review?.contact && review.contact.permission !== "unknown" && review.identity === "confirmed",
    ),
    qualified: row.opportunityId !== null,
  };
}

/** Rechecks the credential and specialist role on every prospect operation.
 * @throws {AppError} For revoked credentials, missing write scope or a buyer role.
 */
export async function requireGrowthActor(actor: Actor, client?: PoolClient, write = false) {
  const current = write ? await requireWrite(actor, client) : await refreshActor(actor, client);
  if (current.role !== "specialist")
    throw new AppError(403, "FORBIDDEN", "Specialist access required.");
  return current;
}

/** Reads only an explicitly owned prospect, independently of opportunity membership.
 * @throws {AppError} For inaccessible accounts or revoked access.
 */
export async function requireProspect(actor: Actor, id: string, client?: PoolClient) {
  const current = await requireGrowthActor(actor, client);
  const [row] = await orm(client)
    .select()
    .from(growthAccounts)
    .where(and(eq(growthAccounts.id, id), eq(growthAccounts.ownerId, current.userId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Account not found.");
  return projection(row);
}

/** Serializes changes for one account, rechecking ownership before commit.
 * @throws {AppError} For revoked access, lost ownership or rejected operations.
 */
export async function changeProspect<T>(
  actor: Actor,
  id: string,
  action: (client: PoolClient, account: Awaited<ReturnType<typeof requireProspect>>) => Promise<T>,
) {
  const client = await database().connect();
  try {
    await beginLocked(client, sql`select pg_advisory_xact_lock(hashtextextended(${id},76001))`);
    await requireGrowthActor(actor, client, true);
    const account = await requireProspect(actor, id, client);
    const result = await action(client, account);
    await requireGrowthActor(actor, client, true);
    await orm(client).execute(sql`commit`);
    return result;
  } catch (error) {
    await orm(client).execute(sql`rollback`);
    throw error;
  } finally {
    client.release();
  }
}

/** Adds an idempotent outcome event within the caller's transaction. */
export async function recordGrowthEvent(
  client: PoolClient,
  accountId: string,
  key: string,
  kind: string,
  detail: string,
) {
  const inserted = await orm(client)
    .insert(growthEvents)
    .values({ id: `${accountId}:${key}`, accountId, kind, detail })
    .onConflictDoNothing()
    .returning({ id: growthEvents.id });
  if (inserted.length) await recordGrowthMeasurement(client, accountId, key, kind);
}

/** Imports an approved USFA snapshot, retaining NY source assertions only.
 * Directory presence grants neither buying intent nor email permission.
 * @throws {AppError} For invalid input, revoked access or changed write permissions.
 */
export async function importDirectory(actor: Actor, raw: unknown) {
  const input = parseInput(snapshotSchema, raw);
  const current = await requireGrowthActor(actor, undefined, true);
  const client = await database().connect();
  let imported = 0;
  try {
    await beginLocked(client, sql`select pg_advisory_xact_lock(76000)`);
    await requireGrowthActor(actor, client, true);
    for (const original of input.rows.filter((row) => row.state === "NY")) {
      const sourceKey = `usfa:${original.sourceId}`;
      let [existing] = await orm(client)
        .select()
        .from(growthAccounts)
        .where(eq(growthAccounts.sourceKey, sourceKey));
      if (existing) {
        await orm(client).execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${existing.id},76001))`,
        );
        [existing] = await orm(client)
          .select()
          .from(growthAccounts)
          .where(eq(growthAccounts.sourceKey, sourceKey));
      }
      // A global source identity must not become a way to claim another specialist's prospect.
      if (existing && existing.ownerId !== current.userId) continue;
      const directory = {
        ...original,
        name: original.name.replace(/\s+/g, " "),
        synthetic: input.synthetic,
      };
      const id = existing?.id ?? randomUUID();
      const fingerprint = createHash("sha256").update(JSON.stringify(original)).digest("hex");
      await orm(client)
        .insert(growthAccounts)
        .values({ id, sourceKey, ownerId: current.userId, directory })
        .onConflictDoUpdate({ target: growthAccounts.sourceKey, set: { directory } });
      await orm(client)
        .insert(growthObservations)
        .values({
          id: randomUUID(),
          accountId: id,
          snapshot: input.snapshot,
          fingerprint,
          original,
        })
        .onConflictDoNothing();
      await recordGrowthEvent(
        client,
        id,
        "discovered",
        "discovered",
        `USFA snapshot ${input.snapshot}; NY; ${input.synthetic ? "synthetic" : "official directory"}`,
      );
      imported++;
    }
    await requireGrowthActor(actor, client, true);
    await orm(client).execute(sql`commit`);
    return { imported, excluded: input.rows.filter((row) => row.state !== "NY").length };
  } catch (error) {
    await orm(client).execute(sql`rollback`);
    throw error;
  } finally {
    client.release();
  }
}

/** Lists a bounded page of owned prospects; an ID cursor supports repeatable traversal.
 * @throws {AppError} For ended specialist access.
 */
export async function listProspects(actor: Actor, cursor = "") {
  const current = await requireGrowthActor(actor);
  const rows = await orm()
    .select()
    .from(growthAccounts)
    .where(and(eq(growthAccounts.ownerId, current.userId), gt(growthAccounts.id, cursor)))
    .orderBy(asc(growthAccounts.id))
    .limit(100);
  await requireGrowthActor(actor);
  return rows.map(projection);
}

/** Returns original observations alongside reviewed account decisions.
 * @throws {AppError} For inaccessible accounts or revoked credentials.
 */
export async function getProspect(actor: Actor, id: string) {
  const account = await requireProspect(actor, id);
  const observations = await orm()
    .select()
    .from(growthObservations)
    .where(eq(growthObservations.accountId, id))
    .orderBy(asc(growthObservations.createdAt))
    .limit(100);
  await requireProspect(actor, id);
  return { ...account, observations };
}

/** Saves explicit human review without modifying directory assertions.
 * @throws {AppError} For invalid input, noninteractive review or inaccessible accounts.
 */
export async function reviewProspect(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  // The one rule a reviewer can't see from the field itself gets a specific message.
  const quoteIssue = reviewSchema
    .safeParse(raw)
    .error?.issues.some((issue) => issue.message === quoteRule);
  if (quoteIssue) throw new AppError(422, "INVALID_INPUT", quoteRule);
  const review = parseInput(reviewSchema, raw);
  return changeProspect(actor, id, async (client) => {
    await orm(client)
      .update(growthAccounts)
      .set({ review, identityState: review.identity })
      .where(eq(growthAccounts.id, id));
    await recordGrowthEvent(
      client,
      id,
      randomUUID(),
      "reviewed",
      `${review.fit}; ${review.identity}; ${review.signal ? "cited buying signal" : "no buying signal"}`,
    );
    return requireProspect(actor, id, client);
  });
}

/** Applies the longest matching, operator-provisioned postal-prefix route once.
 * @throws {AppError} When no active specialist route exists or access is revoked.
 */
export async function routeProspect(actor: Actor, id: string) {
  return changeProspect(actor, id, async (client, account) => {
    const routes = await orm(client)
      .select({ route: growthTerritories, identity: identities })
      .from(growthTerritories)
      .innerJoin(identities, eq(identities.userId, growthTerritories.specialistId));
    const match = routes
      .filter(
        ({ route, identity }) =>
          account.directory.postalCode.startsWith(route.postalPrefix) &&
          identity.role === "specialist" &&
          !identity.revokedAt,
      )
      .sort((a, b) => b.route.postalPrefix.length - a.route.postalPrefix.length)[0];
    if (!match)
      throw new AppError(
        409,
        "NO_ROUTE",
        "No approved NY territory route. Operator configuration required.",
      );
    const routing = `NY postal prefix ${match.route.postalPrefix}; rule ${match.route.id}`;
    await orm(client)
      .update(growthAccounts)
      .set({ ownerId: match.route.specialistId, routing })
      .where(eq(growthAccounts.id, id));
    await recordGrowthEvent(client, id, `route:${match.route.id}`, "assigned", routing);
    return { ownerId: match.route.specialistId, routing };
  });
}

async function requireBuyerMatch(
  actor: Actor,
  client: PoolClient,
  organizationId: string,
  opportunityId: string,
  vehicleId: string,
) {
  const existing = await requireOpportunity(actor, opportunityId, "specialist", client);
  const [organization] = await orm(client)
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (
    !organization ||
    existing.vehicle_id !== vehicleId ||
    !(
      existing.organization_id === organizationId ||
      (organization.buyerId && existing.buyer_id === organization.buyerId)
    )
  )
    throw new AppError(
      409,
      "MATCH_REQUIRED",
      "The selected deal does not identify this account as its buyer. Seller relationships are not relabeled.",
    );
}

/** Creates one human-qualified deal and evidence-review task without creating a login for a contact.
 * @throws {AppError} For unreviewed qualification, invalid vehicle, changed input or revoked access.
 */
export async function qualifyProspect(actor: Actor, id: string, raw: unknown) {
  requireSession(actor);
  const input = parseInput(
    z
      .object({
        vehicleId: text.max(200),
        existingOpportunityId: z.string().trim().max(200).optional(),
        reply: text,
        provenance: text,
        permission: z.enum(["synthetic", "permissioned"]),
      })
      .strict(),
    raw,
  );
  return changeProspect(actor, id, async (client, account) => {
    if (account.review?.identity !== "confirmed" || account.fit !== "fit" || !account.buyingSignal)
      throw new AppError(
        409,
        "REVIEW_REQUIRED",
        "Review identity, fit and cited buying need before qualification.",
      );
    if (account.opportunityId && account.organizationId) {
      const existing = await requireOpportunity(actor, account.opportunityId, "specialist", client);
      if (existing.vehicle_id !== input.vehicleId)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Account already has a different qualified deal.",
        );
      return { opportunityId: account.opportunityId, organizationId: account.organizationId };
    }
    const [vehicle] = await orm(client)
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, input.vehicleId), isNotNull(vehicles.published_at)));
    if (!vehicle) throw new AppError(404, "NOT_FOUND", "Vehicle not found.");
    const organizationId = account.organizationId ?? `growth-${id}`;
    const opportunityId = input.existingOpportunityId || `growth-${id}`;
    const nextAction =
      "Review the prospect's original need and reply before preparing a supported follow-up.";
    if (account.organizationId) {
      if (!input.existingOpportunityId)
        throw new AppError(
          409,
          "MATCH_REQUIRED",
          "Choose the existing assigned buyer opportunity for a matched account.",
        );
      await requireBuyerMatch(actor, client, organizationId, opportunityId, input.vehicleId);
    } else {
      if (input.existingOpportunityId)
        throw new AppError(409, "MATCH_REQUIRED", "Confirm the existing account match first.");
      await orm(client).insert(organizations).values({
        id: organizationId,
        name: account.name,
        city: account.directory.city,
        region: "NY",
        unit: "",
        synthetic: account.directory.synthetic,
      });
      await orm(client).insert(opportunities).values({
        id: opportunityId,
        organization_id: organizationId,
        vehicle_id: input.vehicleId,
        buyer_id: null,
        assignee_id: actor.userId,
        next_action: nextAction,
      });
      await orm(client)
        .insert(opportunityMembers)
        .values({ opportunity_id: opportunityId, user_id: actor.userId });
      await recordGrowthEvent(
        client,
        id,
        "opportunity_created",
        "opportunity_created",
        "Created a new reviewed buyer opportunity",
      );
    }
    const original = `${account.buyingSignal.text}\n\nOriginal reply: ${input.reply}`;
    await orm(client)
      .insert(sources)
      .values({
        id: `growth-source-${id}`,
        opportunity_id: opportunityId,
        owner_id: actor.userId,
        name: "Reviewed prospect handoff",
        media_type: "text/plain",
        content: Buffer.from(original),
        pages: [original],
        kind: "inquiry",
        audience: "sales",
        permission: input.permission,
        provenance: input.provenance,
        shareable: false,
      });
    await orm(client)
      .insert(evidenceBlockers)
      .values({
        id: `growth-blocker-${id}`,
        opportunity_id: opportunityId,
        blocker_key: `growth:${id}`,
        question: input.reply,
        assignee_id: actor.userId,
        next_action: nextAction,
      });
    await orm(client)
      .update(growthAccounts)
      .set({ organizationId, opportunityId })
      .where(eq(growthAccounts.id, id));
    await recordGrowthEvent(
      client,
      id,
      "qualified",
      "qualified",
      "Human-reviewed reply linked to a vehicle; original source requires evidence review",
    );
    return { opportunityId, organizationId };
  });
}
