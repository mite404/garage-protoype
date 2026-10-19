import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthOperations } from "@/server/growth-views";
import { GrowthCommand } from "../growth-command";
import { GrowthUnavailable } from "../growth-profile";

export const dynamic = "force-dynamic";
const identityLabels: Record<string, string> = {
  needs_review: "Needs review",
  confirmed: "Confirmed",
  rejected: "Rejected match",
};
const contactLabels = { true: "Reviewed contact", false: "No contact permission" };
const signalLabels = { true: "Cited buying signal", false: "Not established" };
const stageLabels = { true: "Deal linked", false: "Pre-opportunity" };

type Account = Awaited<ReturnType<typeof getGrowthOperations>>["accounts"][number];

function AccountIdentity({ account }: { account: Account }) {
  return (
    <td>
      <Link href={`/desk/prospects/${account.id}`}>{account.name}</Link>
      <small>
        {account.directory.synthetic ? "Synthetic fixture" : "USFA directory"} ·{" "}
        {account.directory.city}, NY
      </small>
    </td>
  );
}

function AccountRow({ account }: { account: Account }) {
  return (
    <tr>
      <AccountIdentity account={account} />
      <td>{identityLabels[account.identityState] ?? account.identityState}</td>
      <td>{contactLabels[`${account.contactable}`]}</td>
      <td>{signalLabels[`${Boolean(account.buyingSignal)}`]}</td>
      <td>{stageLabels[`${account.qualified}`]}</td>
    </tr>
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
        <h1>Accounts</h1>
        <p className="mt-4 text-muted-foreground">
          Start with a source. Confirm identity, fit and permission before a first touch.{" "}
          {operations.delivery}. Directory records are not qualified opportunities.
        </p>
      </header>
      <div className="desk-card desk-table-scroll mt-6">
        <table className="desk-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Identity</th>
              <th>Contact</th>
              <th>Signal</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {operations.accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </tbody>
        </table>
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
