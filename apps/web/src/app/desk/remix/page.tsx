// Remix of satnaing/shadcn-admin's dashboard: tabbed header, icon stat cards, an overview bar
// chart and a recent-activity list, re-pointed at the Signal Desk desk home. Simulated data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import { DeskIcon } from "@signal-desk/catalog/desk-shell";
import {
  asOf,
  blockersByType,
  inFlight,
  metrics,
  openBlockers,
  resolvedLog,
  stageLabel,
} from "./data";
import { Resume } from "./resume";

const tabs = [
  ["Overview", "#resume"],
  ["Blockers", "#blockers"],
  ["Deals", "#deals"],
] as const;
const initials = (name: string) =>
  name
    .replace(/ FD$/, "")
    .split(" ")
    .map((w) => w[0])
    .join("");

function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: Parameters<typeof DeskIcon>[0]["name"];
}) {
  return (
    <Card size="sm">
      <CardHeader className="grid-cols-[1fr_auto]">
        <p className="font-medium">{label}</p>
        <span className="text-muted-foreground">
          <DeskIcon name={icon} />
        </span>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function BlockerBars() {
  const max = Math.max(...blockersByType.map((b) => b.count), 1);
  return (
    <Card id="blockers" className="lg:col-span-4">
      <CardHeader>
        <CardTitle>Open blockers by type</CardTitle>
        <p className="text-muted-foreground">Simulated from synthetic records</p>
      </CardHeader>
      <CardContent>
        <ul className="flex h-56 items-end gap-3" aria-label="Open blockers by type">
          {blockersByType.map((b) => (
            <li key={b.type} className="flex h-full flex-1 flex-col justify-end gap-2 text-center">
              <span className="text-sm font-semibold tabular-nums">{b.count}</span>
              <span
                className="rounded-t-sm bg-foreground"
                style={{ height: `${(b.count / max) * 75}%` }}
              />
              <span className="min-h-8 text-xs leading-tight text-muted-foreground">{b.type}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RecentResolutions() {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Recently resolved</CardTitle>
        <p className="text-muted-foreground">
          {metrics.resolvedCount} blockers reviewed and resolved. Simulated.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4">
          {resolvedLog.slice(0, 5).map((r) => (
            <li key={`${r.seller}-${r.type}`} className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                {initials(r.buyer)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.type}</span>
                <span className="block truncate text-muted-foreground">
                  {r.buyer} ↔ {r.seller}
                </span>
              </span>
              <span className="font-medium tabular-nums">{r.days} d</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Simulated at-a-glance desk home in the shadcn-admin layout. Loads no private records. */
export default function Remix() {
  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Work queue</h1>
        <Badge variant="outline">Simulated preview · synthetic data as of {asOf}</Badge>
      </header>
      <nav className="flex w-fit gap-1 rounded-lg bg-muted p-1" aria-label="Jump to section">
        {tabs.map(([label, href], i) => (
          <a
            key={label}
            href={href}
            aria-current={i === 0 ? "true" : undefined}
            className="rounded-md px-3 py-1 text-sm text-muted-foreground no-underline aria-current:bg-card aria-current:text-foreground aria-current:shadow-sm"
          >
            {label}
          </a>
        ))}
      </nav>
      <Resume id="resume" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Deals in flight"
          value={String(metrics.inFlight)}
          note={`${metrics.waitingOnYou} waiting on you`}
          icon="queue"
        />
        <Stat
          label="Open blockers"
          value={String(metrics.openBlockers)}
          note="Across intent, authority, fit, evidence"
          icon="alert"
        />
        <Stat
          label="Median time to resolve"
          value={`${metrics.medianDaysToResolve} days`}
          note={`From ${metrics.resolvedCount} reviewed resolutions`}
          icon="pending"
        />
        <Stat
          label="Buyers ready"
          value={String(metrics.readyBuyers)}
          note="Human proceed decision still required"
          icon="check"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-7">
        <BlockerBars />
        <RecentResolutions />
      </div>
      <Card id="deals">
        <CardHeader>
          <CardTitle>Deals in flight</CardTitle>
        </CardHeader>
        <CardContent className="desk-table-scroll">
          <table className="desk-table">
            <thead>
              <tr>
                <th scope="col">Buyer and seller</th>
                <th scope="col">Stage</th>
                <th scope="col">Open blockers</th>
                <th scope="col">Buyer readiness</th>
              </tr>
            </thead>
            <tbody>
              {inFlight.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href="/desk/sourcing">
                      {c.buyer} ↔ {c.seller}
                    </Link>
                  </th>
                  <td>{stageLabel(c)}</td>
                  <td>{openBlockers(c).length}</td>
                  <td>{c.readiness}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}
