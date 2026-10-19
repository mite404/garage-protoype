import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthProfile } from "@/server/growth-views";
import { GrowthActions, GrowthSummary, GrowthUnavailable } from "../../growth-profile";

export const dynamic = "force-dynamic";

/** Loads the account's authorized enrichment and review controls, never private delivery credentials. */
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  let profile;
  try {
    profile = await getGrowthProfile(await requireActor(), (await params).id);
  } catch (error) {
    return (
      <GrowthUnavailable
        error={error}
        title="Account unavailable."
        href="/desk/prospects"
        backLabel="Back to prospects"
      />
    );
  }
  return (
    <section className="growth-page">
      <Link href="/desk/prospects" className="text-sm text-primary">
        ← Prospect inbox
      </Link>
      <header className="my-6">
        <p className="eyebrow">Account profile · {profile.account.directory.city}, NY</p>
        <h1>{profile.account.name}</h1>
      </header>
      <GrowthSummary profile={profile} />
      <GrowthActions profile={profile} />
    </section>
  );
}
