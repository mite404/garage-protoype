import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getAccountProfile } from "@/server/growth-views";
import { GrowthSummary, GrowthUnavailable } from "../../growth-profile";

export const dynamic = "force-dynamic";

/** Displays actual buyer/seller relationships and owned enrichment through assigned-deal access. */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  let profile;
  try {
    profile = await getAccountProfile(await requireActor(), (await params).id);
  } catch (error) {
    return <GrowthUnavailable error={error} title="Account unavailable." />;
  }
  return (
    <section className="growth-page">
      <p className="eyebrow">
        Account profile ·{" "}
        {profile.organization.synthetic ? "Synthetic demonstration" : "Permissioned record"}
      </p>
      <h1>{profile.organization.name}</h1>
      <p className="my-4">
        {profile.organization.city}, {profile.organization.region}
      </p>
      {profile.growth ? (
        <GrowthSummary profile={profile.growth} />
      ) : (
        <p className="growth-card">
          No owned discovery enrichment is linked. Existing buyer/seller roles are unchanged.
        </p>
      )}
      <section className="growth-card mt-6">
        <h2>Assigned deal relationships</h2>
        {profile.deals.map((deal) => (
          <p className="growth-quote" key={deal.id}>
            <strong>{deal.relationship === "seller" ? "Seller" : "Buyer"}</strong> · {deal.title} ·{" "}
            <Link href={`/desk/opportunities/${encodeURIComponent(deal.id)}`}>
              Review evidence →
            </Link>
          </p>
        ))}
      </section>
    </section>
  );
}
