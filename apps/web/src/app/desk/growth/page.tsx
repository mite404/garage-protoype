import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthOperations } from "@/server/growth-views";
import { GrowthCommand } from "../growth-command";
import { GrowthUnavailable } from "../growth-profile";

export const dynamic = "force-dynamic";

function SpendingStatus({
  budget,
}: {
  budget: Awaited<ReturnType<typeof getGrowthOperations>>["budget"];
}) {
  return (
    <p className="mt-4">
      {budget
        ? `${budget.spentMicroUsd} micro-USD settled · ${budget.reservedMicroUsd} reserved · ${budget.active} active attempts`
        : "No spending budget provisioned. Paid work cannot run."}
    </p>
  );
}

/** Reports scoped denominators and durable work status without implying production uplift. */
export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  let operations;
  try {
    operations = await getGrowthOperations(await requireActor(), (await searchParams).cursor);
  } catch (error) {
    return <GrowthUnavailable error={error} title="Operations unavailable." />;
  }
  return (
    <section className="growth-page">
      <header>
        <p className="eyebrow">Growth operations · NY</p>
        <h1>A loop you can inspect.</h1>
        <p className="mt-4 text-muted-foreground">
          Observed account states and human-reported outcomes. No customer validation, revenue
          uplift or causal attribution is implied.
        </p>
      </header>
      <section className="growth-card mt-6">
        <h2>This account page, not the whole population</h2>
        <p className="text-sm text-muted-foreground">
          Denominator {operations.counts.discovered} owned accounts displayed, up to 100. Columns
          are distinct conditions, not mutually exclusive funnel stages. Sent means provider
          acceptance, not delivery or a reply.
        </p>
        <div className="growth-metrics">
          {Object.entries(operations.counts).map(([name, count]) => (
            <p key={name}>
              <strong>{count}</strong>
              <span>{name}</span>
            </p>
          ))}
        </div>
        {operations.nextCursor && (
          <Link href={`?cursor=${operations.nextCursor}`} className="quiet-button">
            Next account page →
          </Link>
        )}
      </section>
      <section className="growth-card mt-6">
        <h2>Backlog and technical cost</h2>
        <p className="text-sm text-muted-foreground">
          Message counts use the displayed account page. Budget counters are this specialist's
          shared inference budget, including conversational work, not a growth-only cost estimate.
          Micro-USD are one millionth of a US dollar.
        </p>
        {operations.backlog.map((row) => (
          <p className="growth-quote" key={row.state}>
            {row.count} {row.state} messages · earliest due{" "}
            {String(row.oldestDue ?? "not recorded")}
          </p>
        ))}
        <SpendingStatus budget={operations.budget} />
      </section>
      <section className="growth-card mt-6">
        <h2>Integration boundaries</h2>
        <ul className="space-y-3 mt-4">
          <li>{operations.delivery}</li>
          <li>{operations.analysis}</li>
          <li>{operations.forms}</li>
        </ul>
        <GrowthCommand
          kind="schedule"
          input={{ kind: "forms" }}
          label="Approve incremental Forms reads"
        />
        <p className="text-sm text-muted-foreground">
          No form is created. OAuth, versioned question IDs and an existing approved form are
          prerequisites.
        </p>
      </section>
      <section className="growth-card mt-6">
        <h2>Scheduled work and recovery</h2>
        <p className="text-sm text-muted-foreground">
          At most three due jobs and one due message per sweep. Five-minute leases recover after
          interruption. Business keys prevent duplicate effects. An uncertain send never re-enters
          the queue.
        </p>
        {!operations.schedules.length && (
          <p className="mt-4">No recurring work approved under this identity.</p>
        )}
        {operations.schedules.map((schedule) => (
          <article className="growth-quote" key={schedule.id}>
            <h3>{JSON.stringify(schedule.configuration)}</h3>
            <p>
              {schedule.lastCode ?? "Not run yet"} ·{" "}
              {schedule.durationMs === null
                ? "No latency measured"
                : `${schedule.durationMs} ms last sweep`}
            </p>
            <p className="text-sm">
              Next {schedule.nextAt.toISOString()} ·{" "}
              {schedule.leaseUntil
                ? `Lease until ${schedule.leaseUntil.toISOString()}`
                : "No active lease"}
            </p>
          </article>
        ))}
      </section>
      <Link className="quiet-button mt-6" href="/desk/prospects">
        Open prospect inbox →
      </Link>
    </section>
  );
}
