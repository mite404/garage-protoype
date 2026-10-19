import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthOperations } from "@/server/growth-views";
import { GrowthCommand } from "../growth-command";
import { GrowthUnavailable } from "../growth-profile";

export const dynamic = "force-dynamic";

function ProspectReadiness({
  account,
}: {
  account: Awaited<ReturnType<typeof getGrowthOperations>>["accounts"][number];
}) {
  return (
    <p className="text-sm text-muted-foreground mt-2">
      {account.buyingSignal ? "Cited buying signal" : "No buying signal"} ·{" "}
      {account.contactable ? "Reviewed contact" : "No contact permission"} ·{" "}
      {account.qualified ? "Deal linked" : "Pre-opportunity"}
    </p>
  );
}

/** Lists owned pre-opportunity accounts without weakening existing deal membership. */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  let operations;
  try {
    operations = await getGrowthOperations(await requireActor(), (await searchParams).cursor);
  } catch (error) {
    return <GrowthUnavailable error={error} title="Prospects unavailable." />;
  }
  return (
    <section className="growth-page">
      <header>
        <p className="eyebrow">New York · discovery</p>
        <h1>Prospect inbox.</h1>
        <p className="mt-4 text-muted-foreground">
          Start with a source. Confirm identity, fit and permission before a first touch.
        </p>
      </header>
      <div className="growth-card mt-6">
        <p>{operations.delivery}. Directory records are not qualified opportunities.</p>
        <Link href="/desk/growth" className="quiet-button mt-3">
          Growth operations →
        </Link>
      </div>
      <div className="growth-grid mt-6">
        {operations.accounts.map((account) => (
          <Link
            className="growth-card growth-account-link"
            key={account.id}
            href={`/desk/prospects/${account.id}`}
          >
            <p className="eyebrow">
              {account.directory.synthetic ? "Synthetic fixture" : "USFA directory"} ·{" "}
              {account.directory.city}, NY
            </p>
            <h2>{account.name}</h2>
            <p className="mt-3">
              {account.identityState.replaceAll("_", " ")} · {account.fit.replaceAll("_", " ")}
            </p>
            <ProspectReadiness account={account} />
            <p className="mt-4 text-sm font-semibold">Review account →</p>
          </Link>
        ))}
      </div>
      {!operations.accounts.length && (
        <section className="growth-card mt-6">
          <h2>No owned prospects yet.</h2>
          <p>
            Import an approved NY snapshot or approve the official directory refresh. Nothing here
            grants email consent.
          </p>
        </section>
      )}
      {operations.nextCursor && (
        <Link className="quiet-button mt-6" href={`?cursor=${operations.nextCursor}`}>
          Next account page →
        </Link>
      )}
      <details className="growth-card mt-6">
        <summary>Approved directory ingestion</summary>
        <p className="mt-3 text-sm text-muted-foreground">
          Only NY assertions persist. Re-importing stable source IDs retains original observations
          and human corrections. Scheduling approves read-only USFA downloads, not email.
        </p>
        <GrowthCommand
          kind="schedule"
          input={{ kind: "directory" }}
          label="Approve recurring NY directory refresh"
        />
        <GrowthCommand kind="import" label="Import reviewed snapshot">
          <label>
            USFA snapshot JSON
            <textarea
              name="snapshot"
              rows={6}
              required
              placeholder={
                '{"source":"usfa","snapshot":"approved-snapshot","synthetic":true,"rows":[…]}'
              }
            />
          </label>
        </GrowthCommand>
      </details>
    </section>
  );
}
