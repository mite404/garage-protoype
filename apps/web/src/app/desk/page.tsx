import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listEvidenceOpportunities } from "@/server/evidence";
import { listMunicipalities } from "@/server/municipalities";
import { listSourcingCases } from "@/server/sourcing";
import { getGrowthOperations } from "@/server/growth-views";
import {
  compareConnections,
  connectionOpen,
  connectionStages,
  connectionWaitingOn,
  countLabel,
} from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";

type Connection = Awaited<ReturnType<typeof listSourcingCases>>[number];
type Prospect = Awaited<ReturnType<typeof getGrowthOperations>>["accounts"][number];

const waitingLabels = {
  you: "You",
  seller: "Seller reply",
  "buyer and seller": "Buyer and seller",
};

function ActiveDeals({ connections }: { connections: Connection[] }) {
  return (
    <section className="desk-card mt-6">
      <h2>Active deals</h2>
      <p className="desk-note">
        Buyer-seller connections in progress. Those waiting on you come first, closest to a sale.
      </p>
      {connections.length ? (
        <div className="desk-table-scroll mt-4">
          <table className="desk-table">
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col" className="whitespace-nowrap">
                  Stage
                </th>
                <th scope="col" className="whitespace-nowrap">
                  Waiting on
                </th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    <Link href={`/desk/sourcing/${item.id}`}>
                      {item.buyer} ← {item.seller}
                    </Link>
                    <span className="block text-sm font-normal text-muted-foreground">
                      {item.vehicle?.title ?? "No listing yet"}
                    </span>
                  </th>
                  <td className="whitespace-nowrap">{connectionStages[item.stage]}</td>
                  <td className="whitespace-nowrap">
                    {waitingLabels[connectionWaitingOn(item.stage, item.proposals)]}
                  </td>
                  <td>{item.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4">
          No connection in progress. <Link href="/desk/sourcing">Connect a buyer need</Link> with a
          seller to start one.
        </p>
      )}
    </section>
  );
}

function Sourcing({ prospects }: { prospects: Prospect[] }) {
  return (
    <section className="desk-card mt-6">
      <h2>Sourcing</h2>
      <p className="desk-note">Seller prospects waiting on review before outreach.</p>
      <div className="desk-table-scroll">
        <table className="desk-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Why</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((prospect) => (
              <tr key={prospect.id}>
                <th>
                  <Link href={`/desk/prospects/${prospect.id}`}>{prospect.name}</Link>
                </th>
                <td>
                  {prospect.identityState !== "confirmed"
                    ? "Identity needs review"
                    : "No reviewed contact"}
                </td>
                <td>
                  {prospect.identityState !== "confirmed" ? "Confirm identity" : "Review contact"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!prospects.length && <p>No seller prospects need review.</p>}
    </section>
  );
}

function BuyerAccounts({
  municipalities,
  opportunities,
}: {
  municipalities: Awaited<ReturnType<typeof listMunicipalities>>;
  opportunities: Awaited<ReturnType<typeof listEvidenceOpportunities>>;
}) {
  const accounts = [
    ...municipalities.map((organization) => ({
      href: `/desk/municipalities/${encodeURIComponent(organization.id)}`,
      name: organization.name,
      detail: `${organization.city}, ${organization.region} · ${organization.unit}`,
      kind: "Department account",
    })),
    ...opportunities.map((opportunity) => ({
      href: `/desk/opportunities/${encodeURIComponent(opportunity.id)}`,
      name: opportunity.title,
      detail: opportunity.nextAction || "Open evidence review",
      kind: "Evidence workbench",
    })),
  ];
  if (!accounts.length) return null;
  return (
    <section className="desk-card mt-6">
      <h2>Buyer accounts</h2>
      <p className="desk-note">Assigned buyers and the vehicle evidence they are reviewing.</p>
      <div className="desk-table-scroll mt-4">
        <table className="desk-table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Next step</th>
              <th scope="col">Workspace</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.href}>
                <th scope="row">
                  <Link href={account.href}>{account.name}</Link>
                </th>
                <td>{account.detail}</td>
                <td>{account.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Checks access server-side before rendering any private workspace content. */
export default async function Desk() {
  let actor;
  let opportunities;
  let municipalities;
  let cases;
  let operations;
  try {
    actor = await requireActor();
    [opportunities, municipalities, cases, operations] = await Promise.all([
      listEvidenceOpportunities(actor),
      listMunicipalities(actor),
      listSourcingCases(actor),
      getGrowthOperations(actor),
    ]);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section className="max-w-xl">
        <p className="eyebrow mb-4">Private workspace</p>
        <h1>Access required.</h1>
        <output className="mt-6 block text-muted-foreground">
          {error.message} No private records have been loaded.
        </output>
        <Link className="button mt-8" href="/sign-in">
          Go to sign-in
        </Link>
      </section>
    );
  }
  return (
    <section>
      <h1>Work queue</h1>
      <p className="mt-3 text-muted-foreground">
        Connect buyers with sellers and move each connection toward a sale.
      </p>
      <ActiveDeals
        connections={cases
          .filter((item) => connectionOpen(item.stage))
          .toSorted(compareConnections)}
      />
      <Sourcing
        prospects={operations.accounts.filter(
          (account) =>
            !account.qualified && (account.identityState !== "confirmed" || !account.contactable),
        )}
      />
      <BuyerAccounts municipalities={municipalities} opportunities={opportunities} />
      <section className="desk-card mt-6">
        <h2>NY growth pipeline</h2>
        <div className="desk-pipeline">
          {Object.entries(operations.counts).map(([label, count]) => (
            <p key={label}>
              <strong>{count}</strong>
              <span>{countLabel(label)}</span>
            </p>
          ))}
        </div>
        <p className="desk-note">
          Counts cover up to 100 of your accounts. Columns are distinct conditions, not a funnel.
        </p>
      </section>
      <section className="desk-card mt-6">
        <h2>Background work</h2>
        <p className="desk-note">
          {operations.schedules.length} approved schedules.{" "}
          {operations.budget
            ? `${operations.budget.active} active attempts, ${operations.budget.spentMicroUsd} micro-USD settled.`
            : "No spending budget provisioned. Paid work cannot run."}{" "}
          Analyst proposals wait on each account for review.
        </p>
      </section>
    </section>
  );
}
