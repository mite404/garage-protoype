import Link from "next/link";
import { requireActor } from "@/server/auth";
import { listSourcingCases } from "@/server/sourcing";
import { GrowthUnavailable } from "../growth-profile";
import SeedWalkthrough from "./seed-walkthrough";

export const dynamic = "force-dynamic";

const stages: Record<string, string> = {
  investigate: "Investigating",
  awaiting_seller: "Awaiting seller",
  evidence_review: "Evidence review",
  ready_for_buyer_review: "Ready for buyer review",
  handed_off: "Handed off",
  rejected: "Pairing rejected",
  unavailable: "Seller unavailable",
};

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
        <p className="eyebrow">Buyer needs · seller pairings</p>
        <h1>Sourcing.</h1>
        <p className="mt-4 text-muted-foreground">
          Start from a confirmed buyer need. A source change is a reason to investigate, never proof
          of a sale.
        </p>
      </header>
      <div className="growth-grid mt-6">
        {cases.map((item) => (
          <Link
            className="growth-card growth-account-link"
            key={item.id}
            href={`/desk/sourcing/${item.id}`}
          >
            <p className="eyebrow">{stages[item.stage] ?? item.stage}</p>
            <h2>
              {item.seller} for {item.buyer}
            </h2>
            <p className="mt-3">{item.nextAction}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Buyer need {item.needState}
              {item.stage === "rejected" && " · stays open after this pairing was rejected"}
            </p>
            <p className="mt-4 text-sm font-semibold">Open pairing →</p>
          </Link>
        ))}
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
