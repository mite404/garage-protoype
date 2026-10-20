// Remix of Kiranism/next-shadcn-dashboard-starter's overview: greeting, trend stat cards, an
// interactive bar chart with series totals in its header, and a pie chart, re-pointed at the
// Signal Desk desk home. Simulated data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import { asOf, metrics, readiness, recent, resolvedLog, weeklyFlow } from "./data";
import { Resume } from "./resume";

const series = { opened: "Blockers opened", resolved: "Blockers resolved" } as const;
type Series = keyof typeof series;
const readinessColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)"];

function Stat({
  label,
  value,
  trend,
  note,
}: {
  label: string;
  value: string;
  trend: string;
  note: string;
}) {
  return (
    <Card size="sm">
      <CardHeader className="grid-cols-[1fr_auto]">
        <p className="text-muted-foreground">{label}</p>
        <Badge variant="outline">{trend}</Badge>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function FlowBars({ active }: { active: Series }) {
  const max = Math.max(...weeklyFlow.map((w) => w[active]), 1);
  return (
    <Card className="lg:col-span-4">
      <CardHeader className="grid-cols-[1fr_auto] items-stretch">
        <div>
          <CardTitle>Blocker flow</CardTitle>
          <p className="text-muted-foreground">Last 4 weeks · Simulated</p>
        </div>
        <nav className="flex" aria-label="Chart series">
          {(Object.keys(series) as Series[]).map((key) => (
            <Link
              key={key}
              href={`?series=${key}`}
              aria-current={key === active ? "true" : undefined}
              className="grid border-l border-border px-4 text-foreground no-underline aria-current:bg-muted"
            >
              <span className="text-xs text-muted-foreground">{series[key]}</span>
              <span className="font-display text-2xl font-semibold tabular-nums">
                {weeklyFlow.reduce((sum, w) => sum + w[key], 0)}
              </span>
            </Link>
          ))}
        </nav>
      </CardHeader>
      <CardContent>
        <ul className="flex h-48 items-end gap-4" aria-label={series[active]}>
          {weeklyFlow.map((w) => (
            <li key={w.week} className="flex h-full flex-1 flex-col justify-end gap-2 text-center">
              <span className="text-sm font-semibold tabular-nums">{w[active]}</span>
              <span
                className="rounded-t-sm bg-chart-3"
                style={{ height: `${(w[active] / max) * 75}%` }}
              />
              <span className="text-xs text-muted-foreground">{w.week}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReadinessPie() {
  const total = readiness.reduce((sum, r) => sum + r.count, 0);
  // → "color a% b%" conic stops, each starting where the previous level ended.
  const share = (n: number) => readiness.slice(0, n).reduce((sum, r) => sum + r.count, 0) / total;
  const stops = readiness.map(
    (_, i) => `${readinessColors[i]} ${share(i) * 100}% ${share(i + 1) * 100}%`,
  );
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Buyer readiness</CardTitle>
        <p className="text-muted-foreground">{total} buyers in the queue · Simulated</p>
      </CardHeader>
      <CardContent className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <div
          className="grid size-40 place-items-center rounded-full"
          style={{ background: `conic-gradient(${stops.join(", ")})` }}
          aria-hidden="true"
        >
          <span className="grid size-24 place-items-center rounded-full bg-card font-display text-2xl font-semibold">
            {total}
          </span>
        </div>
        <ul className="grid gap-2">
          {readiness.map((r, i) => (
            <li key={r.level} className="flex items-center gap-2">
              <span className="size-3 rounded-sm" style={{ background: readinessColors[i] }} />
              <span className="flex-1">{r.level}</span>
              <span className="font-semibold tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Simulated at-a-glance desk home in the Kiranism starter layout. Loads no private records. */
export default async function Remix({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const { series: param } = await searchParams;
  const spans = resolvedLog.map((r) => r.days); // → number[] days per resolved blocker
  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Welcome back 👋</h1>
        <Badge variant="outline">Simulated preview · synthetic data as of {asOf}</Badge>
      </header>
      <Resume />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Deals in flight"
          value={String(metrics.inFlight)}
          trend={`${metrics.waitingOnYou} on you`}
          note={`Resume: ${recent.connection.buyer} ↔ Cedar Valley`}
        />
        <Stat
          label="Open blockers"
          value={String(metrics.openBlockers)}
          trend="Review"
          note="Intent, authority, fit, evidence, permission"
        />
        <Stat
          label="Median time to resolve"
          value={`${metrics.medianDaysToResolve} days`}
          trend={`n = ${metrics.resolvedCount}`}
          note={`Range ${Math.min(...spans)} to ${Math.max(...spans)} days, opened to reviewed`}
        />
        <Stat
          label="Buyers ready"
          value={String(metrics.readyBuyers)}
          trend="Human decision"
          note="Ready for an introduction you record"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-7">
        <FlowBars active={param === "resolved" ? "resolved" : "opened"} />
        <ReadinessPie />
      </div>
    </section>
  );
}
