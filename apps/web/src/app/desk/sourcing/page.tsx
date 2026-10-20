import Link from "next/link";
import { requireActor } from "@/server/auth";
import { listProspects } from "@/server/growth";
import { listBuyerNeeds, listSellerListings, listSourcingCases } from "@/server/sourcing";
import { GrowthUnavailable } from "../growth-profile";
import SeedWalkthrough from "./seed-walkthrough";
import { BuyerNeedForm, ConnectionForm } from "./connection-forms";
import { connectionStages } from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";

type Need = Awaited<ReturnType<typeof listBuyerNeeds>>[number];
type Connection = Awaited<ReturnType<typeof listSourcingCases>>[number];
type SellerOption = { value: string; label: string; sellerId: string };

const needSummary = ({ constraints, state }: Need) =>
  `${constraints.vehicleClass} · Up to $${(constraints.maxBudgetCents / 100).toLocaleString("en-US")} ${
    constraints.budgetBasis === "total" ? "all-in" : "purchase price"
  } · Height ≤${constraints.maxHeightIn} in · Need ${state}`;

function Connections({ items }: { items: Connection[] }) {
  if (!items.length) return <p className="mt-4">No seller connected yet.</p>;
  return (
    <div className="desk-table-scroll mt-4">
      <table className="desk-table">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Stage</th>
            <th>Next action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th>
                <Link href={`/desk/sourcing/${item.id}`}>
                  {item.seller} for {item.buyer}
                </Link>
                {item.vehicle && (
                  <span className="block text-sm font-normal text-muted-foreground">
                    {item.vehicle.title}
                  </span>
                )}
              </th>
              <td data-label="Stage">{connectionStages[item.stage]}</td>
              <td data-label="Next action">
                {item.nextAction}
                {item.stage === "rejected" && (
                  <small>Buyer need stays open after this connection was rejected</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NeedCard({
  need,
  connections,
  sellers,
}: {
  need: Need;
  connections: Connection[];
  sellers: SellerOption[];
}) {
  const connected = new Set(connections.map((item) => item.sellerId));
  // A seller already connected to this need is reached through its existing connection.
  const options = sellers.filter((option) => !connected.has(option.sellerId));
  return (
    <section className="desk-card" id={`need-${need.id}`}>
      <h2>{need.buyer}</h2>
      <p>{needSummary(need)}</p>
      <blockquote className="growth-quote">
        <p>{need.statement}</p>
        <cite>
          {need.provenance}
          {need.synthetic && " · Synthetic"}
        </cite>
      </blockquote>
      <Connections items={connections} />
      {need.state === "active" && (
        <details className="mt-4">
          <summary>Connect a seller</summary>
          <ConnectionForm
            label="Open connection"
            fieldLabel="Seller or listed vehicle"
            name="target"
            options={options}
            base={{ needId: need.id }}
          />
          {!options.length && <p>Every seller you own is already connected to this need.</p>}
        </details>
      )}
    </section>
  );
}

/** Lists owned buyer needs and their seller connections, and records new needs. */
export default async function SourcingQueuePage() {
  let needs;
  let cases;
  let prospects;
  let listings;
  try {
    const actor = await requireActor();
    [needs, cases, prospects, listings] = await Promise.all([
      listBuyerNeeds(actor),
      listSourcingCases(actor),
      listProspects(actor),
      listSellerListings(actor),
    ]);
  } catch (error) {
    return <GrowthUnavailable error={error} title="Sourcing unavailable." />;
  }
  // Listings first, since a seller's vehicle is closer to a sale than the seller alone.
  const sellers: SellerOption[] = [
    ...listings.map((listing) => ({
      value: `vehicle:${listing.id}`,
      sellerId: listing.sellerId,
      label: `${listing.title} · ${listing.listed ? "Listed" : "Draft listing"}`,
    })),
    ...prospects
      .filter((prospect) => prospect.identityState === "confirmed")
      .map((prospect) => ({
        value: `seller:${prospect.id}`,
        sellerId: prospect.id,
        label: `${prospect.name} · Seller account`,
      })),
  ];
  return (
    <section className="growth-page">
      <header>
        <h1>Buyer needs</h1>
        <p className="mt-4 text-muted-foreground">
          Connect each confirmed buyer need with a seller and work it toward a sale. A source change
          is a reason to investigate, never proof of a sale.
        </p>
      </header>
      <div className="space-y-5 mt-6">
        {needs.map((need) => (
          <NeedCard
            key={need.id}
            need={need}
            connections={cases.filter((item) => item.needId === need.id)}
            sellers={sellers}
          />
        ))}
      </div>
      <section className="desk-card mt-6">
        <h2>Record a buyer need</h2>
        <p className="desk-note">
          Record what the buyer confirmed and where it came from. This creates no vehicle,
          opportunity or buyer login.
        </p>
        <BuyerNeedForm />
      </section>
      {!cases.length && (
        <section className="growth-card mt-6">
          <h2>No connections yet.</h2>
          <p>Create the synthetic Pine Brook and Cedar Valley walkthrough to try the workflow.</p>
          <SeedWalkthrough />
        </section>
      )}
    </section>
  );
}
