// Remix of arhamkhnz/next-shadcn-admin-dashboard's CRM "Pipeline Overview": KPI cards with delta
// pills, hatched bars beside a headline number, and a segmented progress bar, re-pointed at the
// Signal Desk desk home. Simulated data only.
import Link from "next/link";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@signal-desk/ui/components/ui/card";
import {
  asOf,
  inFlight,
  metrics,
  openBlockers,
  resolveByType,
  stageCounts,
  waitingLabels,
  waitingOn,
  weeklyFlow,
} from "./data";
import { Resume } from "./resume";

const hatch =
  "repeating-linear-gradient(135deg, var(--muted-foreground) 0 1px, transparent 1px 7px)";
const thisWeek = weeklyFlow.at(-1)!;

function Kpi({
  label,
  value,
  pill,
  note,
}: {
  label: string;
  value: string;
  pill: string;
  note: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-2">
        <p className="text-muted-foreground">{label}</p>
        <p className="flex items-center gap-3">
          <span className="font-display text-4xl font-semibold tabular-nums">{value}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
            {pill}
          </span>
        </p>
        <p className="text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function ResolveFlow() {
  const max = Math.max(...resolveByType.map((r) => r.days), 1);
  const total = metrics.inFlight;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Time to resolve by blocker type</CardTitle>
        <p className="text-muted-foreground">Average days, opened to reviewed · Simulated</p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ul className="flex h-56 items-end gap-3" aria-label="Average days to resolve by type">
          {resolveByType.map((r) => (
            <li key={r.type} className="flex h-full flex-1 flex-col justify-end gap-2 text-center">
              <span className="text-sm font-semibold tabular-nums">{r.days.toFixed(1)} d</span>
              <span
                className="rounded-t-md border border-border bg-muted"
                style={{ height: `${(r.days / max) * 70}%`, backgroundImage: hatch }}
              />
              <span className="min-h-8 text-xs leading-tight text-muted-foreground">{r.type}</span>
            </li>
          ))}
        </ul>
        <div className="grid content-start gap-4">
          <p>
            <span className="font-display text-5xl font-semibold">
              {metrics.medianDaysToResolve}
            </span>{" "}
            <span className="text-xl text-muted-foreground">days median</span>
          </p>
          <p className="text-muted-foreground">
            Across {metrics.resolvedCount} blockers a rep reviewed and resolved.
          </p>
          <div className="grid gap-2 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Buyers ready for introduction
            </p>
            <p>
              <span className="font-display text-2xl font-semibold">{metrics.readyBuyers}</span> of{" "}
              {total} connections
            </p>
            <span className="h-2 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground/70"
                style={{ width: `${(metrics.readyBuyers / total) * 100}%` }}
              />
            </span>
            <p className="text-xs text-muted-foreground">A human proceed decision comes first.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageBar() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections by stage</CardTitle>
        <p className="text-muted-foreground">One segment per buyer-seller connection</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ol className="grid gap-2 sm:grid-cols-5">
          {stageCounts.map((s, i) => (
            <li key={s.stage} className="grid gap-2">
              <span className="flex h-8 gap-1">
                {Array.from({ length: Math.max(s.count, 1) }, (_, j) => (
                  <span
                    key={j}
                    className="flex-1 rounded-sm"
                    style={{
                      background: s.count ? `var(--chart-${i + 1})` : "var(--muted)",
                    }}
                  />
                ))}
              </span>
              <span className="text-sm">
                <span className="font-semibold tabular-nums">{s.count}</span> {s.label}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function NextActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next actions</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {inFlight.map((c) => (
            <li
              key={c.id}
              className="grid gap-1 border-l-2 border-border pl-4 sm:grid-cols-[14rem_1fr_auto] sm:gap-4"
            >
              <Link href="/desk/sourcing" className="font-medium">
                {c.buyer} ↔ {c.seller}
              </Link>
              <span>{c.nextAction}</span>
              <span className="text-muted-foreground">
                {waitingLabels[waitingOn(c)]} · {openBlockers(c).length} open
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Simulated at-a-glance desk home in the Studio Admin CRM layout. Loads no private records. */
export default function Remix() {
  return (
    <section className="grid gap-4">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>Deal pipeline</h1>
          <Badge variant="outline">Simulated preview · synthetic data as of {asOf}</Badge>
        </div>
        <p className="text-muted-foreground">
          Keep tabs on deals in flight, the blockers holding them and the buyers ready for you to
          decide on.
        </p>
      </header>
      <Resume />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Deals in flight"
          value={String(metrics.inFlight)}
          pill={`${metrics.waitingOnYou} on you`}
          note="Open buyer-seller connections"
        />
        <Kpi
          label="Open blockers"
          value={String(metrics.openBlockers)}
          pill={`+${thisWeek.opened} this week`}
          note={`${thisWeek.resolved} resolved in the week of ${thisWeek.week}`}
        />
        <Kpi
          label="Median time to resolve"
          value={`${metrics.medianDaysToResolve} d`}
          pill={`n = ${metrics.resolvedCount}`}
          note="Opened to reviewed resolution"
        />
        <Kpi
          label="Buyers ready"
          value={String(metrics.readyBuyers)}
          pill="Your decision"
          note="Proceed, investigate or reject"
        />
      </div>
      <ResolveFlow />
      <div className="grid gap-4">
        <StageBar />
        <NextActions />
      </div>
    </section>
  );
}
