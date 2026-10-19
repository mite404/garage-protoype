import Link from "next/link";
import type { getGrowthProfile } from "@/server/growth-views";
import { feedbackSurvey } from "@signal-desk/contracts/feedback-schema";
import { AppError } from "@/server/errors";
import { GrowthCommand } from "./growth-command";

type Profile = Awaited<ReturnType<typeof getGrowthProfile>>;

function AccountMetrics({ account }: Pick<Profile, "account">) {
  return (
    <div className="growth-metrics">
      <p>
        <strong>{account.fit.replaceAll("_", " ")}</strong>
        <span>Account fit · human review</span>
      </p>
      <p>
        <strong>{account.buyingSignal ? "Cited need" : "Not established"}</strong>
        <span>Buying signal</span>
      </p>
      <p>
        <strong>{account.contactable ? "Reviewed contact" : "Not contactable"}</strong>
        <span>Contact permission</span>
      </p>
      <p>
        <strong>{account.qualified ? "Qualified" : "Not qualified"}</strong>
        <span>Deal qualification</span>
      </p>
    </div>
  );
}

/** Shows persisted enrichment on authorized account profiles without turning inferences into facts. */
export function GrowthSummary({ profile }: { profile: Profile }) {
  const { account, feedback, insights } = profile;
  return (
    <section className="growth-card" aria-labelledby="growth-heading">
      <p className="eyebrow">
        Account intelligence · {account.directory.synthetic ? "Synthetic" : "USFA directory"}
      </p>
      <h2 id="growth-heading">Evidence before outreach.</h2>
      <AccountMetrics account={account} />
      <p className="text-sm text-muted-foreground">
        Directory presence is not buying intent or email consent. Identity{" "}
        {account.identityState.replaceAll("_", " ")}. {account.routing ?? "Not routed."}
      </p>
      {account.buyingSignal && (
        <blockquote className="growth-quote">
          <p>“{account.buyingSignal.quote}”</p>
          <cite>
            {account.buyingSignal.source} · {account.buyingSignal.permission}
          </cite>
        </blockquote>
      )}
      <h3 className="mt-6">Feedback, not assumptions</h3>
      <p>
        {feedback.respondents.length} distinct correlated respondent/stage records ·{" "}
        {feedback.submissions.length} original submissions · {feedback.ambiguous.length} ambiguous
        replies.
      </p>
      <p className="text-sm text-muted-foreground">
        {feedback.attribution}. Latest explicit answers only; email and Forms do not count twice.
      </p>
      {feedback.respondents.map((response) => (
        <p className="growth-quote" key={`${response.recipient}:${response.stage}`}>
          <strong>{response.stage === "onboarding" ? "Onboarding" : "Post-call"}</strong> ·{" "}
          {feedbackSurvey.interest.find((choice) => choice.id === response.answer.interest)?.label}{" "}
          · {feedbackSurvey.blockers.find((choice) => choice.id === response.answer.blocker)?.label}
        </p>
      ))}
      <ResearchSummary insights={insights} />
      <Link className="quiet-button mt-4" href={`/desk/prospects/${account.id}`}>
        Review account and originals →
      </Link>
    </section>
  );
}

function ResearchSummary({ insights }: Pick<Profile, "insights">) {
  return (
    <>
      <h3 className="mt-6">Background research · needs human review</h3>
      {!insights.length && (
        <p className="text-sm text-muted-foreground">
          No analysis persisted. Live model execution stays disabled until separately configured and
          authorized.
        </p>
      )}
      {insights.slice(-1).flatMap((insight) =>
        insight.result.themes.map((theme, index) => (
          <article className="growth-quote" key={`${insight.id}:${index}`}>
            <h4>{theme.theme}</h4>
            <blockquote>“{theme.quote}”</blockquote>
            <p className="text-sm">
              Source {theme.sourceId} · {theme.uncertainty}
            </p>
            <p className="mt-2">Suggested action: {theme.suggestion}</p>
            <p className="text-xs text-muted-foreground">
              Advisory inference, not an approved claim · {insight.model} · {insight.durationMs} ms
            </p>
          </article>
        )),
      )}
    </>
  );
}

function AccountReview({ account }: { account: Profile["account"] }) {
  const review = account.review ?? { signal: null, contact: null };
  const signal = review.signal ?? { text: "", quote: "", source: "", permission: "synthetic" };
  const contact = review.contact ?? { name: "", email: "", permission: "unknown", provenance: "" };
  return (
    <section className="growth-card">
      <h2>Review the account</h2>
      <p className="text-sm text-muted-foreground">
        Corrections do not overwrite original directory assertions. Do not invent contact details.
      </p>
      <GrowthCommand kind="review" accountId={account.id} label="Save human review">
        <label>
          Account name
          <input name="name" required maxLength={200} defaultValue={account.name} />
        </label>
        <label>
          Identity
          <select name="identity" defaultValue={account.identityState}>
            <option value="needs_review">Uncertain match · review required</option>
            <option value="confirmed">Confirmed by specialist</option>
            <option value="rejected">Rejected match</option>
          </select>
        </label>
        <label>
          Account fit
          <select name="fit" defaultValue={account.fit}>
            <option value="unknown">Unknown</option>
            <option value="fit">Fit</option>
            <option value="not_fit">Not fit</option>
          </select>
        </label>
        <label>
          Original buying-signal text
          <textarea name="signal" maxLength={1000} defaultValue={signal.text} />
        </label>
        <label>
          Verbatim supporting quote
          <input name="quote" maxLength={1000} defaultValue={signal.quote} />
        </label>
        <label>
          Source / provenance
          <input name="source" maxLength={1000} defaultValue={signal.source} />
        </label>
        <label>
          Material permission
          <select name="materialPermission" defaultValue={signal.permission}>
            <option value="synthetic">Synthetic</option>
            <option value="permissioned">Permissioned</option>
          </select>
        </label>
        <label>
          Contact name
          <input name="contactName" maxLength={200} defaultValue={contact.name} />
        </label>
        <label>
          Recorded email
          <input name="email" type="email" maxLength={254} defaultValue={contact.email} />
        </label>
        <label>
          Contact permission
          <select name="contactPermission" defaultValue={contact.permission}>
            <option value="unknown">Unknown · do not send</option>
            <option value="allowlisted_test">Allowlisted test recipient</option>
            <option value="permissioned">Documented permission</option>
          </select>
        </label>
        <label>
          Contact source and permission evidence
          <textarea name="contactProvenance" maxLength={1000} defaultValue={contact.provenance} />
        </label>
      </GrowthCommand>
      <ExistingAccountMatch account={account} />
    </section>
  );
}

function ExistingAccountMatch({ account }: { account: Profile["account"] }) {
  return (
    <>
      <GrowthCommand kind="route" accountId={account.id} label="Apply approved territory route" />
      <GrowthCommand kind="link" accountId={account.id} label="Confirm existing account match">
        <label>
          Existing buyer or seller account ID
          <input
            name="organizationId"
            required
            maxLength={200}
            defaultValue={account.organizationId ?? ""}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          Requires an assigned deal. Matching does not qualify a prospect or change buyer/seller
          roles.
        </p>
      </GrowthCommand>
      {account.organizationId && (
        <Link
          className="quiet-button mt-4"
          href={`/desk/accounts/${encodeURIComponent(account.organizationId)}`}
        >
          Open buyer/seller account profile →
        </Link>
      )}
    </>
  );
}

function AssignedApproach({ experiment }: { experiment: NonNullable<Profile["experiment"]> }) {
  return (
    <p className="mt-2 text-sm">
      <strong>
        {{ control: "Request-first", evidence_first: "Evidence-first" }[experiment.variant]}
      </strong>{" "}
      · {experiment.exposedAt ? "Delivery confirmed" : "Not exposed"} ·{" "}
      {experiment.synthetic ? "Synthetic demonstration, not uplift" : "Permissioned observation"}.
      Review the frozen text below before queueing.
    </p>
  );
}

function ExperimentStatus({ account, experiment }: Pick<Profile, "account" | "experiment">) {
  if (experiment) return <AssignedApproach experiment={experiment} />;
  if (process.env.POSTHOG_ENABLED === "true")
    return (
      <GrowthCommand kind="experiment" accountId={account.id} label="Prepare assigned approach" />
    );
  return (
    <p className="mt-2 text-sm">Trial disabled. Normal reviewed outreach remains available.</p>
  );
}

function ReviewedSequenceForm({ account, experiment }: Pick<Profile, "account" | "experiment">) {
  return (
    <GrowthCommand kind="enroll" accountId={account.id} label="Approve and queue sequence">
      {experiment && <input type="hidden" name="experiment" value="true" />}
      <label>
        Subject
        <input
          name="subject"
          required
          maxLength={200}
          defaultValue={experiment?.subject}
          readOnly={Boolean(experiment)}
        />
      </label>
      <label>
        Reviewed message
        <textarea
          name="body"
          rows={8}
          required
          maxLength={5000}
          placeholder="Include reply STOP to opt out."
          defaultValue={experiment?.body}
          readOnly={Boolean(experiment)}
        />
      </label>
    </GrowthCommand>
  );
}

function OutreachReview({
  account,
  outreach,
  experiment,
}: Pick<Profile, "account" | "outreach" | "experiment">) {
  return (
    <section className="growth-card">
      <h2>Reviewed outreach</h2>
      <p className="text-sm text-muted-foreground">
        Queues only. Two frozen steps, now and in three days. Replies, opt-outs and delivery
        failures stop due work.
      </p>
      <div className="growth-quote">
        <h3>Reviewed outreach trial</h3>
        <p className="text-sm">
          Request-first versus evidence-first. One approach per department, not per contact. Only
          provider-confirmed delivery starts the 14-day human-qualified reply window. Sourcing
          requests and surveys are outside this trial.
        </p>
        <ExperimentStatus account={account} experiment={experiment} />
      </div>
      <ReviewedSequenceForm
        key={experiment?.variant ?? "normal"}
        account={account}
        experiment={experiment}
      />
      <GrowthCommand kind="stop" accountId={account.id} label="Stop queued outreach">
        <label>
          Reason
          <select name="reason">
            <option value="reply">Reply received · stop sequence</option>
            <option value="opt_out">Opt-out · suppress address</option>
            <option value="disqualified">Disqualified</option>
          </select>
        </label>
      </GrowthCommand>
      {outreach.map((message) => (
        <article className="growth-quote" key={message.id}>
          <h3>{message.subject}</h3>
          <p className="text-sm">
            {message.state} · step {message.step + 1} · {message.recipient}
          </p>
          <p className="text-xs">Due {message.dueAt.toISOString()}</p>
          {["uncertain", "dispatched"].includes(message.state) && (
            <GrowthCommand
              kind="reconcile"
              accountId={account.id}
              input={{ messageId: message.id }}
              label="Record provider reconciliation"
            >
              <p>
                Do not retry. A blank receipt means definitive not-sent evidence, never an
                assumption.
              </p>
              <label>
                Accepted provider receipt, if verified
                <input name="providerId" />
              </label>
              <label>
                Provider evidence
                <textarea name="evidence" required maxLength={1000} />
              </label>
            </GrowthCommand>
          )}
        </article>
      ))}
    </section>
  );
}

function DealFeedback({ account, feedback }: Pick<Profile, "account" | "feedback">) {
  return (
    <section className="growth-card">
      <h2>Connect the deal</h2>
      {account.opportunityId ? (
        <Link
          className="quiet-button mt-4"
          href={`/desk/municipalities/${encodeURIComponent(account.organizationId!)}`}
        >
          Open account workspace →
        </Link>
      ) : (
        <GrowthCommand kind="qualify" accountId={account.id} label="Create reviewed opportunity">
          <label>
            Published vehicle ID
            <input name="vehicleId" required maxLength={200} />
          </label>
          <label>
            Existing assigned opportunity ID, for a matched buyer
            <input name="existingOpportunityId" maxLength={200} />
          </label>
          <label>
            Original qualified reply
            <textarea name="reply" required maxLength={1000} />
          </label>
          <label>
            Reply provenance
            <input name="provenance" required maxLength={1000} />
          </label>
          <label>
            Reply permission
            <select name="permission">
              <option value="synthetic">Synthetic fixture</option>
              <option value="permissioned">Permissioned original</option>
            </select>
          </label>
        </GrowthCommand>
      )}
      <GrowthCommand
        kind="invite"
        accountId={account.id}
        label="Prepare versioned feedback invitation"
      >
        <label>
          Recorded call reference
          <input name="callKey" required maxLength={200} />
        </label>
        <label>
          Stage
          <select name="stage">
            <option value="post_call">Post-call · expected effort</option>
            <option value="onboarding">Onboarding · actual effort</option>
          </select>
        </label>
      </GrowthCommand>
      {feedback.invitations.map((invitation) => (
        <details className="growth-quote" key={invitation.id}>
          <summary>
            Review {invitation.stage} invitation · {invitation.version}
          </summary>
          <pre className="whitespace-pre-wrap text-sm mt-3">{invitation.body}</pre>
          <GrowthCommand
            kind="enroll"
            accountId={account.id}
            input={{
              key: `feedback:${invitation.id}`,
              invitationId: invitation.id,
              subject: "Your Signal Desk feedback",
              body: invitation.body,
            }}
            label="Approve and queue this invitation"
          />
        </details>
      ))}
    </section>
  );
}

function ProactiveWork({ account }: Pick<Profile, "account">) {
  return (
    <section className="growth-card">
      <h2>Proactive work</h2>
      <p className="text-sm text-muted-foreground">
        Schedules run without an open chat. Disabled integrations report their status instead of
        pretending to complete.
      </p>
      <GrowthCommand
        kind="schedule"
        input={{ kind: "analysis", accountId: account.id }}
        label="Schedule background research"
      />
      <GrowthCommand
        kind="schedule"
        input={{ kind: "stalled", accountId: account.id }}
        label="Schedule stalled-deal review"
      />
      <GrowthCommand kind="outcome" accountId={account.id} label="Record evidence-backed outcome">
        <label>
          Outcome
          <select name="kind">
            <option value="intervention">Human intervention</option>
            <option value="progressed">Deal progressed</option>
            <option value="closed_lost">Closed lost</option>
          </select>
        </label>
        <label>
          What changed
          <textarea name="detail" required maxLength={1000} />
        </label>
        <label>
          Evidence / source
          <input name="evidence" required maxLength={1000} />
        </label>
      </GrowthCommand>
    </section>
  );
}

function OriginalAnswers({ feedback, replies }: Pick<Profile, "feedback" | "replies">) {
  return (
    <section className="growth-card">
      <h2>Original answers</h2>
      <p className="text-sm text-muted-foreground">
        Preserved separately from explicit selections and agent inferences.
      </p>
      {replies.map((reply) => (
        <article className="growth-quote" key={reply.receiptId}>
          <h3>Email reply · {reply.receiptId}</h3>
          <p className="text-xs">
            {reply.receivedAt} · Unverified source material, not accepted facts
          </p>
          <pre className="whitespace-pre-wrap text-sm mt-2">{reply.text}</pre>
        </article>
      ))}
      {feedback.submissions.map((submission) => (
        <article className="growth-quote" key={submission.id}>
          <h3>
            {submission.channel} · {submission.externalId}
          </h3>
          <p className="text-xs">
            {submission.submittedAt.toISOString()} ·{" "}
            {submission.answer ? "Explicit selections" : "Ambiguous prose · review"}
          </p>
          <pre className="whitespace-pre-wrap text-sm mt-2">
            {typeof submission.original === "string"
              ? submission.original
              : JSON.stringify(submission.original, null, 2)}
          </pre>
        </article>
      ))}
    </section>
  );
}

function OutcomeTrail({ account, events }: Pick<Profile, "account" | "events">) {
  return (
    <section className="growth-card">
      <h2>Provenance and outcome trail</h2>
      {account.observations.map((observation) => (
        <details className="growth-quote" key={observation.id}>
          <summary>{observation.snapshot}</summary>
          <pre className="whitespace-pre-wrap text-sm mt-2">
            {JSON.stringify(observation.original, null, 2)}
          </pre>
        </details>
      ))}
      {events.map((event) => (
        <p className="growth-quote text-sm" key={event.id}>
          <strong>{event.kind}</strong> · {event.detail}
        </p>
      ))}
    </section>
  );
}

/** Renders human-reviewed account operations; provider activation has no control on this page. */
export function GrowthActions({ profile }: { profile: Profile }) {
  return (
    <div className="growth-grid mt-6">
      <AccountReview account={profile.account} />
      <div className="space-y-6">
        <OutreachReview
          account={profile.account}
          outreach={profile.outreach}
          experiment={profile.experiment}
        />
        <DealFeedback account={profile.account} feedback={profile.feedback} />
        <ProactiveWork account={profile.account} />
      </div>
      <OriginalAnswers feedback={profile.feedback} replies={profile.replies} />
      <OutcomeTrail account={profile.account} events={profile.events} />
    </div>
  );
}

/** Shows only sanitized access failures; unexpected failures reach the application boundary.
 * @throws For unexpected infrastructure or rendering errors.
 */
export function GrowthUnavailable({
  error,
  title,
  href = "/desk",
  backLabel = "Back to workspace",
}: {
  error: unknown;
  title: string;
  href?: string;
  backLabel?: string;
}) {
  if (!(error instanceof AppError)) throw error;
  return (
    <section>
      <h1>{title}</h1>
      <p className="mt-4">{error.message} No private records have been loaded.</p>
      <Link className="quiet-button mt-4" href={href}>
        {backLabel}
      </Link>
    </section>
  );
}
