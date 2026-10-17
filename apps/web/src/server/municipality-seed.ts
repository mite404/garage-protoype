import "server-only";
import type { PoolClient } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { orm } from "./db";
import {
  identities,
  opportunities,
  organizations,
  vehicles,
  municipalityInterests,
  opportunityDealTerms,
} from "./db-schema";

const seedInput = z
  .object({ buyerId: z.uuid(), opportunityId: z.string().min(1).max(200) })
  .strict();

/** Adds the synthetic Austin workspace to an explicitly selected existing buyer and acquisition.
 * Repeating the command preserves existing terms and metadata rather than resetting operator edits.
 * @throws For invalid IDs, mismatched buyers, or an organization already linked elsewhere.
 */
export async function seedMunicipality(client: PoolClient, input: unknown) {
  const { buyerId, opportunityId } = seedInput.parse(input);
  const db = orm(client);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73009)`);
    const [deal] = await tx
      .select({ vehicleId: opportunities.vehicle_id })
      .from(opportunities)
      .innerJoin(identities, eq(identities.userId, opportunities.buyer_id))
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.buyer_id, buyerId),
          eq(identities.role, "buyer"),
        ),
      );
    if (!deal) throw new Error("Select an existing opportunity and its buyer identity.");
    const [existing] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, "austin-fire-department"));
    if (existing && existing.buyerId !== buyerId)
      throw new Error("Austin is already linked to a different buyer.");
    await tx
      .insert(organizations)
      .values([
        {
          id: "austin-fire-department",
          buyerId,
          name: "Austin Fire Department",
          city: "Austin",
          region: "Texas",
          unit: "Engine 001",
          synthetic: true,
        },
        {
          id: "san-antonio-fire-department",
          name: "San Antonio Fire Department",
          city: "San Antonio",
          region: "Texas",
          unit: "",
          synthetic: true,
        },
      ])
      .onConflictDoNothing();
    await tx
      .update(vehicles)
      .set({ ownerOrganizationId: "san-antonio-fire-department" })
      .where(and(eq(vehicles.id, deal.vehicleId), sql`${vehicles.ownerOrganizationId} is null`));
    await tx
      .insert(vehicles)
      .values([
        {
          id: "demo-austin-owned",
          title: "Synthetic reserve pumper",
          ownerOrganizationId: "austin-fire-department",
          published_at: new Date("2026-10-01T12:00:00Z"),
        },
        {
          id: "demo-san-antonio-interest",
          title: "Synthetic rescue pumper",
          ownerOrganizationId: "san-antonio-fire-department",
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(opportunityDealTerms)
      .values({
        opportunityId,
        amountCents: 8400000,
        currency: "USD",
        stage: "contingent",
        conditions: ["Subject to review of the pump-test report."],
      })
      .onConflictDoNothing();
    await tx
      .insert(municipalityInterests)
      .values([
        {
          id: "demo-austin-favorite",
          organizationId: "austin-fire-department",
          vehicleId: "demo-san-antonio-interest",
          kind: "favorite",
          occurredAt: new Date("2026-10-15T10:00:00Z"),
        },
        {
          id: "demo-austin-contact",
          organizationId: "austin-fire-department",
          vehicleId: deal.vehicleId,
          kind: "contact",
          occurredAt: new Date("2026-10-16T10:00:00Z"),
        },
      ])
      .onConflictDoNothing();
  });
}
