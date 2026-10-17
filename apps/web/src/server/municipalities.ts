import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  organizationSchema,
  workspaceSchema,
  type MunicipalityWorkspace,
} from "@signal-desk/contracts/municipality-schema";
import { orm } from "./db";
import {
  organizations,
  opportunities,
  opportunityMembers,
  opportunityDealTerms,
  municipalityInterests,
  vehicles,
} from "./db-schema";
import { refreshActor, requireOpportunity, type Actor } from "./access";
import { evidenceTransaction } from "./evidence";
import { AppError } from "./errors";

/** Lists only departments with a currently assigned opportunity.
 * @throws {AppError} When the credential or specialist role is no longer valid.
 */
export async function listMunicipalities(actor: Actor) {
  const current = await refreshActor(actor);
  if (current.role !== "specialist")
    throw new AppError(403, "FORBIDDEN", "Specialist access required.");
  const rows = await orm()
    .select({ organization: organizations, opportunityId: opportunities.id })
    .from(organizations)
    .innerJoin(opportunities, eq(opportunities.buyer_id, organizations.buyerId))
    .innerJoin(
      opportunityMembers,
      and(
        eq(opportunityMembers.opportunity_id, opportunities.id),
        eq(opportunityMembers.user_id, current.userId),
      ),
    )
    .orderBy(asc(organizations.name));
  for (const row of rows) await requireOpportunity(current, row.opportunityId, "specialist");
  return [
    ...new Map(
      rows.map((row) => [row.organization.id, organizationSchema.parse(row.organization)]),
    ).values(),
  ];
}

/** Reads municipality metadata through assigned deals, never messages or internal notes.
 * @throws {AppError} For an unknown department, removed membership, or revoked credentials.
 */
export async function getMunicipalityWorkspace(
  actor: Actor,
  id: string,
): Promise<MunicipalityWorkspace> {
  const current = await refreshActor(actor);
  if (current.role !== "specialist")
    throw new AppError(403, "FORBIDDEN", "Specialist access required.");
  const [anchor] = await orm()
    .select({ opportunityId: opportunities.id })
    .from(organizations)
    .innerJoin(opportunities, eq(opportunities.buyer_id, organizations.buyerId))
    .innerJoin(
      opportunityMembers,
      and(
        eq(opportunityMembers.opportunity_id, opportunities.id),
        eq(opportunityMembers.user_id, current.userId),
      ),
    )
    .where(eq(organizations.id, id))
    .limit(1);
  if (!anchor) throw new AppError(404, "NOT_FOUND", "Department not found.");
  return evidenceTransaction(
    current,
    anchor.opportunityId,
    async (client) => {
      const db = orm(client);
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, id));
      if (!organization?.buyerId) throw new AppError(404, "NOT_FOUND", "Department not found.");
      const acquisitions = await db
        .select({
          id: opportunities.id,
          vehicleId: vehicles.id,
          title: vehicles.title,
          seller: organizations.name,
          terms: {
            amountCents: opportunityDealTerms.amountCents,
            currency: opportunityDealTerms.currency,
            stage: opportunityDealTerms.stage,
            conditions: opportunityDealTerms.conditions,
          },
        })
        .from(opportunities)
        .innerJoin(
          opportunityMembers,
          and(
            eq(opportunityMembers.opportunity_id, opportunities.id),
            eq(opportunityMembers.user_id, current.userId),
          ),
        )
        .innerJoin(vehicles, eq(vehicles.id, opportunities.vehicle_id))
        .leftJoin(organizations, eq(organizations.id, vehicles.ownerOrganizationId))
        .leftJoin(opportunityDealTerms, eq(opportunityDealTerms.opportunityId, opportunities.id))
        .where(eq(opportunities.buyer_id, organization.buyerId))
        .orderBy(asc(opportunities.id));
      const activity = await db
        .select({
          id: municipalityInterests.id,
          vehicleId: vehicles.id,
          title: vehicles.title,
          seller: organizations.name,
          kind: municipalityInterests.kind,
          occurredAt: municipalityInterests.occurredAt,
        })
        .from(municipalityInterests)
        .innerJoin(vehicles, eq(vehicles.id, municipalityInterests.vehicleId))
        .leftJoin(organizations, eq(organizations.id, vehicles.ownerOrganizationId))
        .where(eq(municipalityInterests.organizationId, id))
        .orderBy(desc(municipalityInterests.occurredAt))
        .limit(50);
      const ownedListings = await db
        .select({ id: vehicles.id, title: vehicles.title, publishedAt: vehicles.published_at })
        .from(vehicles)
        .where(eq(vehicles.ownerOrganizationId, id))
        .orderBy(asc(vehicles.id));
      for (const acquisition of acquisitions)
        await requireOpportunity(current, acquisition.id, "specialist", client);
      await requireOpportunity(current, anchor.opportunityId, "specialist", client);
      return workspaceSchema.parse({ organization, acquisitions, activity, ownedListings });
    },
    "specialist",
    "read",
  );
}
