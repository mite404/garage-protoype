import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listEvidenceOpportunities } from "@/server/evidence";
import { listMunicipalities } from "@/server/municipalities";
import { getBlockerMetrics, listSourcingCases } from "@/server/sourcing";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import { getGrowthOperations, getRecentAccount } from "@/server/growth-views";
import { RecentAccount } from "./recent-account";
import { ResolveChart } from "./resolve-chart";
import {
  blockerDuration,
  compareConnections,
  connectionOpen,
  connectionStages,
  connectionStep,
  connectionSteps,
  connectionWaitingOn,
  countLabel,
} from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";

type Connection = Awaited<ReturnType<typeof listSourcingCases>>[number];
type Prospect = Awaited<ReturnType<typeof getGrowthOperations>>["accounts"][number];
type Blockers = Awaited<ReturnType<typeof getBlockerMetrics>>;

const waitingLabels = {
  you: "You",
  seller: "Seller reply",
  "buyer and seller": "Buyer and seller",
};

const blockerLabels: Record<string, string> = {
  available: "Availability",
  height: "Height",
  budget: "Budget",
  authority: "Sale authority",
  contact_permission: "Contact permission",
};

function Kpi({ label, value, pill, note }: Record<"label" | "value" | "pill" | "note", string>) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-2">
        <p className="text-muted-foreground">{label}</p>
        <p className="flex flex-wrap items-center gap-3">
          <span className="font-display text-4xl font-semibold tabular-nums">{value}</span>
          <span className="border border-border px-2 py-0.5 text-xs font-medium">{pill}</span>
        </p>
        <p className="text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function ResolveFlow({
  blockers,
  ready,
  open,
}: {
  blockers: Blockers;
  ready: number;
  open: number;
}) {
  const resolved = blockers.kinds.filter((kind) => kind.averageHours !== null);
  const count = resolved.reduce((sum, kind) => sum + kind.resolved, 0);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Time to resolve by blocker type</CardTitle>
        <p className="text-muted-foreground">
          Average time from a blocker opening to reviewed evidence resolving it
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {resolved.length ? (
          <ResolveChart
            data={resolved.map((kind) => ({
              kind: blockerLabels[kind.kind] ?? kind.kind,
              hours: kind.averageHours!,
            }))}
          />
        ) : (
          <p className="text-muted-foreground">
            No blocker resolved yet. Accepting reviewed evidence on a connection resolves its
            blockers.
          </p>
        )}
        <div className="grid content-start gap-4">
          <p>
            <span className="font-display text-5xl font-semibold">
              {blockerDuration(blockers.medianHours)}
            </span>{" "}
            <span className="text-xl text-muted-foreground">median</span>
          </p>
          <p className="text-muted-foreground">
            Resolved blockers: {count}. Each was resolved by evidence a rep reviewed.
          </p>
          <div className="grid gap-2 border border-border p-4">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Buyers ready for introduction
            </p>
            <p>
              <span className="font-display text-2xl font-semibold">{ready}</span> of {open}{" "}
              connections
            </p>
            <span className="h-2 bg-muted">
              <span
                className="block h-full bg-foreground/70"
                style={{ width: `${(ready / Math.max(open, 1)) * 100}%` }}
              />
            </span>
            <p className="text-xs text-muted-foreground">A human proceed decision comes first.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageBar({ connections }: { connections: Connection[] }) {
  const counts = connectionSteps.map((label, step) => ({
    label,
    count: connections.filter((item) => connectionStep(item.stage) === step).length,
  })); // → { label, count }[] per milestone
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Connections by stage</CardTitle>
        <p className="text-muted-foreground">One segment per buyer-seller connection</p>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-4">
          {counts.map((item, index) => (
            <li key={item.label} className="grid gap-2">
              <span className="flex h-8 gap-1">
                {Array.from({ length: Math.max(item.count, 1) }, (_, segment) => (
                  <span
                    key={segment}
                    className="flex-1"
                    style={{
                      background: item.count ? `var(--chart-${index + 1})` : "var(--muted)",
                    }}
                  />
                ))}
              </span>
              <span className="text-sm">
                <span className="font-semibold tabular-nums">{item.count}</span> {item.label}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

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
                <th scope="col">Buyer and seller</th>
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
                      <span className="block">Buyer: {item.buyer}</span>
                      <span className="block">Seller: {item.seller}</span>
                    </Link>
                    <span className="block text-sm font-normal text-muted-foreground">
                      {item.vehicle?.title ?? "No listing yet"}
                    </span>
                  </th>
                  <td data-label="Stage" className="whitespace-nowrap">
                    {connectionStages[item.stage]}
                  </td>
                  <td data-label="Waiting on" className="whitespace-nowrap">
                    {waitingLabels[connectionWaitingOn(item.stage, item.proposals)]}
                  </td>
                  <td data-label="Next action">{item.nextAction}</td>
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
                <td data-label="Why">
                  {prospect.identityState !== "confirmed"
                    ? "Identity needs review"
                    : "No reviewed contact"}
                </td>
                <td data-label="Next action">
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
                <td data-label="Next step">{account.detail}</td>
                <td data-label="Workspace">{account.kind}</td>
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
  let recent;
  let blockers;
  try {
    actor = await requireActor();
    [opportunities, municipalities, cases, operations, recent] = await Promise.all([
      listEvidenceOpportunities(actor),
      listMunicipalities(actor),
      listSourcingCases(actor),
      getGrowthOperations(actor),
      getRecentAccount(actor),
    ]);
    blockers = await getBlockerMetrics(
      actor,
      cases.filter((item) => connectionOpen(item.stage)).map((item) => item.id),
    );
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
  const open = cases.filter((item) => connectionOpen(item.stage)).toSorted(compareConnections);
  const onYou = open.filter((item) => connectionWaitingOn(item.stage, item.proposals) === "you");
  const ready = open.filter((item) => item.stage === "ready_for_buyer_review").length;
  const openBlockers = blockers.kinds.reduce((sum, kind) => sum + kind.open, 0);
  const resolvedBlockers = blockers.kinds.reduce((sum, kind) => sum + kind.resolved, 0);
  return (
    <section>
      <h1>Work queue</h1>
      <p className="mt-3 text-muted-foreground">
        Connect buyers with sellers and move each connection toward a sale. Counts come from your
        saved records; walkthrough records are synthetic.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Deals in flight"
          value={String(open.length)}
          pill={`${onYou.length} on you`}
          note="Open buyer-seller connections"
        />
        <Kpi
          label="Open blockers"
          value={String(openBlockers)}
          pill={`${blockers.kinds.filter((kind) => kind.open).length} types`}
          note="Unmet requirements and contact permission"
        />
        <Kpi
          label="Median time to resolve"
          value={blockerDuration(blockers.medianHours)}
          pill={`n = ${resolvedBlockers}`}
          note="Blocker opened to reviewed resolution"
        />
        <Kpi
          label="Buyers ready"
          value={String(ready)}
          pill="Your decision"
          note="Ready for buyer review"
        />
      </div>
      <RecentAccount recent={recent} />
      <ResolveFlow blockers={blockers} ready={ready} open={open.length} />
      <StageBar connections={open} />
      <ActiveDeals connections={open} />
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
          Counts cover up to 100 of your accounts. An account can appear in several counts. These
          are current states, not a conversion funnel.
        </p>
      </section>
      <Sourcing
        prospects={operations.accounts.filter(
          (account) =>
            !account.qualified && (account.identityState !== "confirmed" || !account.contactable),
        )}
      />
      <BuyerAccounts municipalities={municipalities} opportunities={opportunities} />
      <section className="desk-card mt-6">
        <h2>Background work</h2>
        <p>
          Automated research and draft proposals run under approved schedules. They do not replace
          your review tasks above or approve facts, contact sellers, or make sale decisions.
        </p>
        <p className="desk-note">
          {operations.schedules.length} approved schedules.{" "}
          {operations.budget
            ? `${operations.budget.active} active model attempts.`
            : "No spending budget provisioned. Paid work cannot run."}{" "}
          Saved proposals appear on their account for human review.
        </p>
      </section>
    </section>
  );
}
