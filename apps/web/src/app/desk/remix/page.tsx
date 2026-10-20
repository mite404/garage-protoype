// Remix of the Shadcn UI Kit (bundui) sales dashboard: a chart card with header counters beside a
// 2x2 stat grid, a ranked list and a status tracker with progress bars over a table, re-pointed
// at the Signal Desk desk home. Simulated data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import {
  asOf,
  blockersByType,
  inFlight,
  metrics,
  openBlockers,
  stageCounts,
  stageLabel,
  waitingLabels,
  waitingOn,
  weeklyFlow,
} from "./data";
import { Resume } from "./resume";

function FlowCard() {
  const max = Math.max(...weeklyFlow.flatMap((w) => [w.opened, w.resolved]), 1);
  const total = (key: "opened" | "resolved") => weeklyFlow.reduce((sum, w) => sum + w[key], 0);
  return (
    <Card size="sm" className="lg:col-span-2">
      <CardHeader className="grid-cols-[1fr_auto]">
        <div>
          <CardTitle>Blocker flow</CardTitle>
          <p className="text-muted-foreground">Last 4 weeks · Simulated</p>
        </div>
        <dl className="flex gap-4 text-right">
          <div>
            <dt className="text-xs text-muted-foreground">
              <span className="mr-1 inline-block size-2 rounded-sm bg-muted-foreground" />
              Opened
            </dt>
            <dd className="font-display text-xl font-semibold">{total("opened")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              <span className="mr-1 inline-block size-2 rounded-sm bg-chart-3" />
              Resolved
            </dt>
            <dd className="font-display text-xl font-semibold">{total("resolved")}</dd>
          </div>
        </dl>
      </CardHeader>
      <CardContent>
        <ul
          className="flex h-44 items-end gap-6"
          aria-label="Blockers opened and resolved per week"
        >
          {weeklyFlow.map((w) => (
            <li key={w.week} className="flex h-full flex-1 flex-col justify-end gap-2">
              <span className="flex h-full items-end gap-1">
                <span
                  className="flex-1 rounded-t-sm bg-muted-foreground"
                  style={{ height: `${(w.opened / max) * 100}%` }}
                  title={`${w.opened} opened`}
                />
                <span
                  className="flex-1 rounded-t-sm bg-chart-3"
                  style={{ height: `${(w.resolved / max) * 100}%` }}
                  title={`${w.resolved} resolved`}
                />
              </span>
              <span className="text-center text-xs text-muted-foreground">{w.week}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <p className="font-medium">{label}</p>
      </CardHeader>
      <CardContent className="grid gap-1 border-t border-border pt-4">
        <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function TopBlockers() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Top open blockers</CardTitle>
        <p className="text-muted-foreground">What is holding deals right now</p>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2">
          {blockersByType
            .toSorted((a, b) => b.count - a.count)
            .map((b) => (
              <li
                key={b.type}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <span className="font-medium">{b.type}</span>
                <span className="text-sm font-semibold text-primary tabular-nums">
                  {b.count} open
                </span>
              </li>
            ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TrackStages() {
  return (
    <Card size="sm" className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Track connection status</CardTitle>
        <p className="text-muted-foreground">Every buyer-seller connection in flight</p>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {stageCounts.map((s, i) => (
            <li key={s.stage} className="grid gap-1">
              <span className="font-display text-3xl font-semibold tabular-nums">{s.count}</span>
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="h-1.5 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(s.count / metrics.inFlight) * 100}%`,
                    background: `var(--chart-${i + 1})`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <div className="desk-table-scroll">
          <table className="desk-table">
            <thead>
              <tr>
                <th scope="col">Buyer and seller</th>
                <th scope="col">Stage</th>
                <th scope="col">Open blockers</th>
                <th scope="col">Buyer readiness</th>
                <th scope="col">Waiting on</th>
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
                  <td>{waitingLabels[waitingOn(c)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Simulated at-a-glance desk home in the Shadcn UI Kit sales layout. Loads no private records. */
export default function Remix() {
  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Sales desk</h1>
        <Badge variant="outline">Simulated preview · synthetic data as of {asOf}</Badge>
      </header>
      <Resume />
      <div className="grid gap-4 lg:grid-cols-4">
        <FlowCard />
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <Stat
            label="Deals in flight"
            value={String(metrics.inFlight)}
            note={`${metrics.waitingOnYou} waiting on you`}
          />
          <Stat
            label="Open blockers"
            value={String(metrics.openBlockers)}
            note="Need evidence or a decision"
          />
          <Stat
            label="Median time to resolve"
            value={`${metrics.medianDaysToResolve} days`}
            note={`${metrics.resolvedCount} blockers, opened to reviewed`}
          />
          <Stat
            label="Buyers ready"
            value={String(metrics.readyBuyers)}
            note="Awaiting your proceed decision"
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <TopBlockers />
        <TrackStages />
      </div>
    </section>
  );
}
