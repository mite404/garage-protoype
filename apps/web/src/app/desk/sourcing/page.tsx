import Link from "next/link";
import { requireActor } from "@/server/auth";
import { listSourcingCases } from "@/server/sourcing";
import { GrowthUnavailable } from "../growth-profile";
import SeedWalkthrough from "./seed-walkthrough";
import { pairingStages } from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";

/** Lists owned buyer-need and seller pairings as a work queue. */
export default async function SourcingQueuePage() {
  let cases;
  try {
    cases = await listSourcingCases(await requireActor());
  } catch (error) {
    return <GrowthUnavailable error={error} title="Sourcing unavailable." />;
  }
  return (
    <section className="growth-page">
      <header>
        <h1>Buyer needs</h1>
        <p className="mt-4 text-muted-foreground">
          Start from a confirmed buyer need. A source change is a reason to investigate, never proof
          of a sale.
        </p>
      </header>
      <div className="space-y-5 mt-6">
        {Object.values(Object.groupBy(cases, (item) => item.needId)).map((group) => {
          const first = group![0]!;
          return (
            <section className="desk-card" id={`need-${first.needId}`} key={first.needId}>
              <h2>{first.buyer}</h2>
              <p>
                {first.constraints.vehicleClass} · Up to $
                {(first.constraints.maxBudgetCents / 100).toLocaleString("en-US")}{" "}
                {first.constraints.budgetBasis === "total" ? "all-in" : "purchase price"} · Height ≤
                {first.constraints.maxHeightIn} in · Need {first.needState}
              </p>
              <div className="desk-table-scroll mt-4">
                <table className="desk-table">
                  <thead>
                    <tr>
                      <th>Seller pairing</th>
                      <th>Stage</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group!.map((item) => (
                      <tr key={item.id}>
                        <th>
                          <Link href={`/desk/sourcing/${item.id}`}>
                            {item.seller} for {item.buyer}
                          </Link>
                        </th>
                        <td>{pairingStages[item.stage]}</td>
                        <td>
                          {item.nextAction}
                          {item.stage === "rejected" && (
                            <small>Buyer need stays open after this pairing was rejected</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
      {!cases.length && (
        <section className="growth-card mt-6">
          <h2>No sourcing cases yet.</h2>
          <p>Create the synthetic Pine Brook and Cedar Valley walkthrough to try the workflow.</p>
          <SeedWalkthrough />
        </section>
      )}
    </section>
  );
}
