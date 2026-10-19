import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listEvidenceOpportunities } from "@/server/evidence";
import { listMunicipalities } from "@/server/municipalities";
import { listSourcingCases } from "@/server/sourcing";
import { getGrowthOperations } from "@/server/growth-views";
import { countLabel, pairingStages, stagePriority } from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";

type WorkItem =
  | { kind: "pairing"; data: Awaited<ReturnType<typeof listSourcingCases>>[number] }
  | { kind: "prospect"; data: Awaited<ReturnType<typeof getGrowthOperations>>["accounts"][number] };

function ReviewQueue({ items }: { items: WorkItem[] }) {
  return (
    <section className="desk-card mt-6">
      <h2>Needs your review</h2>
      <div className="desk-table-scroll">
        <table className="desk-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Why</th>
              <th>Next action</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) =>
              item.kind === "pairing" ? (
                <tr key={item.data.id}>
                  <th>
                    <Link href={`/desk/sourcing/${item.data.id}`}>{item.data.seller}</Link>
                  </th>
                  <td>Candidate for {item.data.buyer}</td>
                  <td>{item.data.nextAction}</td>
                  <td>{pairingStages[item.data.stage]}</td>
                </tr>
              ) : (
                <tr key={item.data.id}>
                  <th>
                    <Link href={`/desk/prospects/${item.data.id}`}>{item.data.name}</Link>
                  </th>
                  <td>
                    {item.data.identityState !== "confirmed"
                      ? "Identity needs review"
                      : "No reviewed contact"}
                  </td>
                  <td>
                    {item.data.identityState !== "confirmed"
                      ? "Confirm identity"
                      : "Review contact"}
                  </td>
                  <td>Pre-opportunity</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {!items.length && <p>No accounts need review.</p>}
    </section>
  );
}

function ActiveDeals({
  municipalities,
  opportunities,
}: {
  municipalities: Awaited<ReturnType<typeof listMunicipalities>>;
  opportunities: Awaited<ReturnType<typeof listEvidenceOpportunities>>;
}) {
  const deals = [
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
  return (
    <section className="desk-card mt-6">
      <h2>Active deals</h2>
      <p className="desk-note">Qualified accounts continue here with their evidence packets.</p>
      {deals.length ? (
        <div className="desk-table-scroll mt-4">
          <table className="desk-table">
            <thead>
              <tr>
                <th scope="col">Deal</th>
                <th scope="col">Next step</th>
                <th scope="col">Workspace</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.href}>
                  <th scope="row">
                    <Link href={deal.href}>{deal.name}</Link>
                  </th>
                  <td>{deal.detail}</td>
                  <td>{deal.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4">No active deals yet. Qualifying a reviewed reply opens one.</p>
      )}
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
        Review the evidence and move the next buyer-need pairing forward.
      </p>
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
      <ReviewQueue
        items={[
          ...cases
            .toSorted((a, b) => (stagePriority[a.stage] ?? 7) - (stagePriority[b.stage] ?? 7))
            .map((data) => ({ kind: "pairing" as const, data })),
          ...operations.accounts
            .filter((account) => account.identityState !== "confirmed" || !account.contactable)
            .map((data) => ({ kind: "prospect" as const, data })),
        ]}
      />
      <ActiveDeals municipalities={municipalities} opportunities={opportunities} />
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
