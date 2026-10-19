import "server-only";
import type { Actor } from "./access";
import { AppError } from "./errors";
import { importDirectory, listProspects, reviewProspect } from "./growth";
import { createBuyerNeed, listSourcingCases, openConnection } from "./sourcing";

const seller = {
  sourceId: "NY-SYN-CEDAR-VALLEY",
  name: "Cedar Valley Fire District",
  city: "Cedar Valley",
  state: "NY",
  postalCode: "12601",
};

/** Creates the synthetic Pine Brook need and Cedar Valley pairing for one specialist through
 * the owning operations. Contacts only an allowlisted test address; sends nothing.
 * @throws {AppError} For a non-specialist, missing write access or a seller another specialist
 *   already owns.
 */
export async function seedSourcing(actor: Actor) {
  const existing = (await listSourcingCases(actor)).find(
    (item) => item.buyer === "Pine Brook FD" && item.seller === seller.name,
  );
  if (existing) return existing.id;
  await importDirectory(actor, {
    source: "usfa",
    snapshot: "synthetic-sourcing-2026-10-19",
    synthetic: true,
    rows: [seller],
  });
  const prospect = (await listProspects(actor)).find(
    (item) => item.directory.sourceId === seller.sourceId,
  );
  // Growth keeps one owner per source identity, so the walkthrough seller cannot be shared.
  if (!prospect)
    throw new AppError(
      409,
      "SEED_OWNED",
      "Another specialist already owns the synthetic walkthrough seller.",
    );
  await reviewProspect(actor, prospect.id, {
    name: seller.name,
    fit: "unknown",
    identity: "confirmed",
    signal: null,
    contact: {
      name: "Synthetic district contact",
      email: "cedar-valley@example.test",
      permission: "allowlisted_test",
      provenance: "Synthetic fixture contact; controlled provider recipient only.",
    },
  });
  const needId = await createBuyerNeed(actor, {
    buyerLabel: "Pine Brook FD",
    statement:
      "Pine Brook FD confirmed it needs a pumper costing at most $175,000 all-in that is no taller than 120 inches.",
    provenance: "Synthetic permissioned call note",
    constraints: {
      vehicleClass: "Pumper",
      budgetBasis: "total",
      maxBudgetCents: 17_500_000,
      maxHeightIn: 120,
    },
    inventory: { searchedAt: new Date("2026-10-19T00:00:00Z"), reviewedMatches: 0 },
    synthetic: true,
  });
  return openConnection(actor, {
    needId,
    sellerProspectId: prospect.id,
    nextAction: "Confirm availability and authority before buyer outreach.",
    sourceChange: {
      dedupeKey: "synthetic:cedar-valley:replacement-notice",
      sourceLabel: "Replacement notice · Synthetic source",
      url: "https://example.org/synthetic/cedar-valley-notice",
      excerpt: "New pumper scheduled to enter service in November.",
      observedAt: new Date("2026-10-18T00:00:00Z"),
      synthetic: true,
    },
  });
}
