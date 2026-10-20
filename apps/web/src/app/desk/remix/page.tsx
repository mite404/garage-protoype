// Remix of the official shadcn/ui dashboard-01 block: section cards, an interactive area chart
// and a tabbed data table, re-pointed at the Signal Desk work queue. Simulated data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import {
  asOf,
  inFlight,
  metrics,
  openBlockers,
  readiness,
  recent,
  stageLabel,
  waitingLabels,
  waitingOn,
  weeklyFlow,
} from "./data";

const tabs = [
  { id: "you", label: "Waiting on you" },
  { id: "all", label: "All in flight" },
] as const;

const fitTone = { Meets: "secondary", Unknown: "outline", Conflict: "destructive" } as const;

function Resume() {
  const c = recent.connection;
  return (
    <Card className="bg-gradient-to-t from-primary/5 to-card">
      <CardHeader>
        <p className="text-xs font-medium text-muted-foreground uppercase">
          Resume last account · {c.seller}
        </p>
        <CardTitle className="text-xl tracking-normal normal-case">{c.nextAction}</CardTitle>
        <p className="text-muted-foreground">
          Why here: {c.buyer} confirmed its need ({c.vehicle}). Cedar Valley's replacement notice is
          a research trigger, not proof of sale intent or authority.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <ul className="grid gap-2 sm:grid-cols-2">
          {recent.fit.map((row) => (
            <li key={row.label} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant={fitTone[row.state as keyof typeof fitTone]}>{row.state}</Badge>
              </div>
              <span className="text-muted-foreground">
                Need {row.need} · {row.evidence}
              </span>
            </li>
          ))}
        </ul>
        <Link className="button" href="/desk/sourcing">
          Continue review
        </Link>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  label,
  value,
  badge,
  footer,
}: {
  label: string;
  value: string;
  badge: string;
  footer: string;
}) {
  return (
    <Card className="bg-gradient-to-t from-primary/5 to-card">
      <CardHeader>
        <p className="text-muted-foreground">{label}</p>
        <CardTitle className="font-display text-3xl font-semibold tabular-nums">{value}</CardTitle>
        <Badge variant="outline">{badge}</Badge>
      </CardHeader>
      <CardContent className="text-muted-foreground">{footer}</CardContent>
    </Card>
  );
}

function AreaChart() {
  const w = 600;
  const h = 180;
  const max = Math.max(...weeklyFlow.flatMap((p) => [p.opened, p.resolved]), 1);
  const x = (i: number) => (i / (weeklyFlow.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 16);
  const area = (key: "opened" | "resolved") =>
    `M0,${h} ${weeklyFlow.map((p, i) => `L${x(i)},${y(p[key])}`).join(" ")} L${w},${h} Z`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Blockers opened vs resolved</CardTitle>
        <p className="text-muted-foreground">
          Weeks starting 09/26 to 10/17 · Simulated from synthetic records
        </p>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-48 w-full">
          <title>Blockers opened and resolved per week</title>
          <path
            d={area("opened")}
            fill="var(--chart-2)"
            fillOpacity="0.3"
            stroke="var(--chart-2)"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={area("resolved")}
            fill="var(--chart-5)"
            fillOpacity="0.18"
            stroke="var(--chart-5)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <p className="mt-2 flex justify-between text-xs text-muted-foreground">
          {weeklyFlow.map((p) => (
            <span key={p.week}>{p.week}</span>
          ))}
        </p>
        <p className="mt-3 flex gap-4 text-muted-foreground">
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-chart-2" />
            Opened
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-chart-5" />
            Resolved
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function DealTable({ tab }: { tab: (typeof tabs)[number]["id"] }) {
  const rows = tab === "you" ? inFlight.filter((c) => waitingOn(c) === "you") : inFlight;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Deals in flight</CardTitle>
        <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Queue filter">
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className="rounded-md px-3 py-1 text-sm text-foreground no-underline aria-[current=page]:bg-card aria-[current=page]:shadow-sm"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </CardHeader>
      <CardContent className="desk-table-scroll">
        <table className="desk-table">
          <thead>
            <tr>
              <th scope="col">Buyer and seller</th>
              <th scope="col">Stage</th>
              <th scope="col">Blockers</th>
              <th scope="col">Buyer readiness</th>
              <th scope="col">Waiting on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {c.buyer} ↔ {c.seller}
                  <small className="block font-normal text-muted-foreground">{c.vehicle}</small>
                </th>
                <td>
                  <Badge variant="outline">{stageLabel(c)}</Badge>
                </td>
                <td>
                  {openBlockers(c)
                    .map((b) => b.type)
                    .join(", ") || "None open"}
                </td>
                <td>{c.readiness}</td>
                <td>{waitingLabels[waitingOn(c)]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Simulated at-a-glance desk home in the shadcn dashboard-01 layout. Loads no private records. */
export default async function Remix({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const ready = readiness.find((r) => r.level === "Ready for introduction")?.count ?? 0;
  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1>Work queue</h1>
        <Badge variant="outline">Simulated preview · synthetic data as of {asOf}</Badge>
      </header>
      <Resume />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard
          label="Deals in flight"
          value={String(metrics.inFlight)}
          badge={`${metrics.waitingOnYou} waiting on you`}
          footer="Open buyer-seller connections"
        />
        <SectionCard
          label="Open blockers"
          value={String(metrics.openBlockers)}
          badge="Needs review"
          footer="Sale intent, authority, fit, evidence"
        />
        <SectionCard
          label="Median time to resolve"
          value={`${metrics.medianDaysToResolve} days`}
          badge={`${metrics.resolvedCount} resolved`}
          footer="Blocker opened to reviewed resolution"
        />
        <SectionCard
          label="Buyers ready"
          value={String(ready)}
          badge="For introduction"
          footer="Human proceed decision still required"
        />
      </div>
      <AreaChart />
      <DealTable tab={tab === "all" ? "all" : "you"} />
    </section>
  );
}
