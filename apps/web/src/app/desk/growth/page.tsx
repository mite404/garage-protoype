import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthOperations } from "@/server/growth-views";
import { GrowthCommand } from "../growth-command";
import { GrowthUnavailable } from "../growth-profile";
import { readExperimentReport } from "@/server/outreach-experiment";
import { countLabel } from "@signal-desk/catalog/desk-state";

export const dynamic = "force-dynamic";
const dueDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

function SpendingStatus({
  budget,
}: {
  budget: Awaited<ReturnType<typeof getGrowthOperations>>["budget"];
}) {
  return (
    <p className="mt-4">
      {budget
        ? `${dollars.format(Number(budget.spentMicroUsd) / 1_000_000)} spent · ${dollars.format(Number(budget.reservedMicroUsd) / 1_000_000)} reserved for unfinished work · ${budget.active} active model attempts`
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
  let experiment;
  try {
    const actor = await requireActor();
    operations = await getGrowthOperations(actor, (await searchParams).cursor);
    experiment = await readExperimentReport(actor);
  } catch (error) {
    return <GrowthUnavailable error={error} title="Operations unavailable." />;
  }
  return (
    <section className="growth-page">
      <header>
        <h1>Outcomes</h1>
        <p className="mt-4 text-muted-foreground">
          Track account progress, reviewed replies and automated work. These records do not prove
          increased sales or that outreach caused an outcome.
        </p>
      </header>
      <section className="growth-card mt-6">
        <h2>Outreach trial: qualified replies within 14 days</h2>
        <p className="text-sm text-muted-foreground">
          Compares request-first and evidence-first outreach across your assigned trial accounts.
          Assigned means placed in a trial group, not sent a message. Delivered requires provider
          confirmation. A qualified reply must be confirmed by a person within 14 days of delivery.
          Results count only accounts whose full 14-day window has ended. No winner is established.
        </p>
        {experiment.eligibility.map((row) => (
          <p className="mt-3 text-sm" key={String(row.synthetic)}>
            {row.synthetic ? "Synthetic demonstration" : "Real permissioned cohort"}: {row.eligible}{" "}
            eligible · {row.unassigned} not yet assigned to a group.
          </p>
        ))}
        <div className="growth-grid mt-4">
          {experiment.cohorts.map((row) => (
            <article className="growth-quote" key={`${row.synthetic}:${row.variant}`}>
              <h3>
                {row.variant === "control" ? "Request-first" : "Evidence-first"} ·{" "}
                {row.synthetic ? "Synthetic" : "Real"}
              </h3>
              <p>
                {row.assigned} assigned · {row.exposed} delivered · {row.pending} still within 14
                days · {row.mature} completed the 14-day window.
              </p>
              <p>
                {row.mature
                  ? `${row.qualified} qualified replies out of ${row.mature} completed windows. Estimated reply-rate range: ${row.interval}.`
                  : "No completed delivery windows yet. A reply rate is not available."}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Synthetic results test the workflow, not sales performance. The range shows statistical
          uncertainty, not a guaranteed result. Small groups, review delays and routing differences
          can affect the comparison. Email and Google Forms survey workflows are unchanged.
        </p>
      </section>
      <section className="growth-card mt-6">
        <h2>Account progress</h2>
        <p className="text-sm text-muted-foreground">
          Covers {operations.counts.discovered} of your accounts on this page, up to 100. An account
          can appear in several counts, so these numbers are not a conversion funnel. Sent means
          accepted by the provider, not confirmed delivered or replied to.
        </p>
        <div className="growth-metrics">
          {Object.entries(operations.counts).map(([name, count]) => (
            <p key={name}>
              <strong>{count}</strong>
              <span>{countLabel(name)}</span>
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
        <h2>Queued messages and AI spending</h2>
        <p className="text-sm text-muted-foreground">
          Message counts cover the accounts on this page. Spending is shown in US dollars across
          your shared AI budget, including conversations, not just growth research.
        </p>
        {operations.backlog.map((row) => (
          <p className="growth-quote" key={row.state}>
            {row.count} {row.state} messages · earliest due{" "}
            {row.oldestDue
              ? `${dueDate.format(new Date(row.oldestDue))} New York time`
              : "not recorded"}
          </p>
        ))}
        <SpendingStatus budget={operations.budget} />
      </section>
      <section className="growth-card mt-6">
        <h2>Connected services and limits</h2>
        <ul className="space-y-3 mt-4">
          <li>{operations.delivery}</li>
          <li>{operations.analysis}</li>
          <li>{operations.forms}</li>
        </ul>
        <GrowthCommand
          kind="schedule"
          input={{ kind: "forms" }}
          label="Approve reading new Forms responses"
        />
        <p className="text-sm text-muted-foreground">
          No form is created. OAuth, versioned question IDs and an existing approved form are
          prerequisites.
        </p>
      </section>
      <section className="growth-card mt-6">
        <h2>Automated background work</h2>
        <p className="text-sm text-muted-foreground">
          Each check processes up to three due jobs and one due message. Interrupted jobs can resume
          after five minutes without duplicating their effects. A message with an uncertain send
          status is held for review, not automatically sent again.
        </p>
        {!operations.schedules.length && (
          <p className="mt-4">No recurring work approved under this identity.</p>
        )}
        {operations.schedules.map((schedule) => (
          <article className="growth-quote" key={schedule.id}>
            <h3>Approved recurring job</h3>
            <details>
              <summary>Job configuration</summary>
              <pre>{JSON.stringify(schedule.configuration, null, 2)}</pre>
            </details>
            <p>
              {schedule.lastCode ?? "Not run yet"} ·{" "}
              {schedule.durationMs === null
                ? "No latency measured"
                : `${schedule.durationMs} ms last sweep`}
            </p>
            <p className="text-sm">
              Next check {dueDate.format(schedule.nextAt)} New York time ·{" "}
              {schedule.leaseUntil
                ? `Running, reserved until ${dueDate.format(schedule.leaseUntil)} New York time`
                : "Not currently running"}
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
