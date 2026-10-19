import { type ReactNode, type ComponentProps } from "react";
import {
  evaluateFit,
  isStale,
  openQuestions,
  requirementLabel,
  suggestDecision,
  type Decision,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import {
  DecisionPacket,
  fieldLabels,
  FitTable,
  InformationRequest,
  RecordNote,
  ReplyReview,
  SourceChangeCard,
} from "./sourcing-cards";
import { AccountFrame, DeskIcon, NextAction, type AccountTab } from "./desk-shell";
import { outreachStep, outreachSteps, pairingAction } from "./desk-state";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const outreachStates = {
  none: "No outreach",
  draft: "Reviewed draft, not sent",
  queued: "Queued",
  sent: "Sent",
  uncertain: "Delivery uncertain, follow-up paused",
  stopped: "Stopped",
};
const suggestions = {
  reject: "Reject this pairing and continue sourcing for the buyer.",
  investigate: "Ask when availability and the unresolved requirements can be confirmed.",
  proceed: "Prepare the reviewed evidence for buyer review.",
};

function inventoryText(search: SourcingAccount["inventorySearch"]) {
  if (!search) return "Not yet checked. Search existing inventory before new sourcing.";
  return `${search.reviewedMatches ? `${search.reviewedMatches} reviewed matches` : "No suitable reviewed match"} · ${date.format(search.searchedAt)}`;
}

function WhyHere({ data }: { data: SourcingAccount }) {
  return (
    <section className="desk-card">
      <h2>Why this account is here</h2>
      <div className="desk-why">
        <div className="desk-evidence-rows">
          <div>
            <DeskIcon name="target" />
            <div>
              <h3>
                Confirmed buyer need: <a href={data.need.buyerHref}>{data.need.buyer}</a>
              </h3>
              <p>
                {data.need.vehicleClass} · {requirementLabel(data.need, "budget")} · Height ≤
                {data.need.maxHeightIn} in
              </p>
            </div>
          </div>
          <div>
            <DeskIcon name="inventory" />
            <div>
              <h3>Existing inventory checked</h3>
              <p>{inventoryText(data.inventorySearch)}</p>
            </div>
          </div>
        </div>
        {data.trigger ? (
          <div className="desk-source-quote">
            <span className="state state-needs_review">Research trigger only</span>
            <blockquote>{data.trigger.excerpt}</blockquote>
            <p>
              {data.trigger.sourceLabel} · {date.format(data.trigger.observedAt)}
            </p>
            <a href={data.trigger.url} target="_blank" rel="noreferrer">
              Read original
            </a>
          </div>
        ) : (
          <p>No source change recorded for this pairing.</p>
        )}
      </div>
    </section>
  );
}

/** Reached outreach steps remain navigable without enabling external delivery. */
export function OutreachStepper({
  current,
  reached,
  onStep,
}: {
  current: number;
  reached: number;
  onStep?: (step: number) => void;
}) {
  return (
    <nav className="desk-stepper" aria-label="Outreach progress">
      {outreachSteps.map((label, index) => (
        <button
          key={label}
          disabled={index > reached}
          aria-current={current === index ? "step" : undefined}
          onClick={() => onStep?.(index)}
        >
          <span>{index < current ? "✓" : index + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}

function PairingActivity({ data }: { data: SourcingAccount }) {
  const events = [
    ...(data.trigger
      ? [{ at: data.trigger.observedAt, text: `Trigger observed: ${data.trigger.sourceLabel}` }]
      : []),
    ...data.replies.map((reply) => ({
      at: reply.receivedAt,
      text: reply.channel === "note" ? "Recorded note received" : "Email reply received",
    })),
    ...data.facts.flatMap((fact) =>
      fact.reviewedAt
        ? [{ at: fact.reviewedAt, text: `${fieldLabels[fact.field]} ${fact.status}` }]
        : [],
    ),
    ...(data.decision
      ? [{ at: data.decision.decidedAt, text: `Decision recorded: ${data.decision.decision}` }]
      : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <section className="desk-card">
      <h2>Activity</h2>
      <ol className="desk-activity">
        {events.map((event, index) => (
          <li key={index}>
            <time dateTime={event.at.toISOString()}>{date.format(event.at)}</time>
            <span>{event.text}</span>
          </li>
        ))}
      </ol>
      {!events.length && <p>No saved activity yet.</p>}
    </section>
  );
}

type PanelProps = Omit<ComponentProps<typeof SourcingWorkspace>, "tab" | "onTab" | "onStep"> & {
  review: (tab: AccountTab, step?: number) => void;
};

function PairingFit({ data, onDecide }: PanelProps) {
  const rows = evaluateFit(data.need, data.facts);
  return (
    <>
      <section className="desk-card">
        <h2>Can this candidate meet the need?</h2>
        <FitTable need={data.need} rows={rows} />
      </section>
      <section className="desk-card">
        <h2>Decision for this pairing</h2>
        <DecisionPacket
          need={data.need}
          rows={rows}
          decision={data.decision}
          stale={Boolean(data.decision && isStale(data.decision.basis, data.need, data.facts))}
          onDecide={onDecide}
        />
      </section>
      <section className="desk-card">
        <h2>Inventory search</h2>
        <p>{inventoryText(data.inventorySearch)}</p>
      </section>
    </>
  );
}

function PairingOverview({ data, sellerHref, review }: PanelProps) {
  const rows = evaluateFit(data.need, data.facts);
  const questions = openQuestions(rows);
  const action = pairingAction(data);
  return (
    <>
      <NextAction
        title={data.nextAction}
        reason={
          data.trigger
            ? "Replacement notice found. Sale intent and authority need reviewed evidence."
            : "Review the evidence against this buyer need."
        }
        action={
          <button className="button" onClick={() => review(action.tab, action.step)}>
            {action.label}
          </button>
        }
      />
      <WhyHere data={data} />
      <section className="desk-card">
        <h2>Can this candidate meet the need?</h2>
        <FitTable need={data.need} rows={rows} />
      </section>
      <div className="desk-two-up">
        <section className="desk-card desk-contact">
          <h2>Contact readiness</h2>
          <div>
            <DeskIcon name="authority" />
            <p>
              Contact identity: {data.contact.identity.replaceAll("_", " ")}
              <br />
              Outreach permission: {data.contact.permission.replaceAll("_", " ")}
            </p>
            <a className="quiet-button" href={`${sellerHref}?tab=outreach`}>
              Review contact
            </a>
          </div>
        </section>
        <section className="desk-card">
          <h2>Information to request</h2>
          <ul className="desk-questions">
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          {questions.length ? (
            <button className="button" onClick={() => review("outreach", 1)}>
              Draft questions
            </button>
          ) : (
            <p>All requirements resolved.</p>
          )}
        </section>
      </div>
    </>
  );
}

function FrozenRequest({
  rejected,
  request,
}: {
  rejected: boolean;
  request: SourcingAccount["outreach"]["request"];
}) {
  return (
    <section className="desk-card">
      <h2>Availability request</h2>
      <p>
        {rejected
          ? "This pairing was rejected, so no further requests are offered."
          : "The reviewed request is enrolled. A reply, opt-out or uncertain delivery stops follow-up."}
      </p>
      {request && (
        <div className="desk-message">
          <h3>{request.subject}</h3>
          <p className="desk-frozen-body">{request.body}</p>
        </div>
      )}
    </section>
  );
}

function PairingDraft({ data, onSaveDraft }: PanelProps) {
  const rejected = data.decision?.decision === "reject";
  if (rejected || !["none", "draft"].includes(data.outreach.state))
    return <FrozenRequest rejected={rejected} request={data.outreach.request} />;
  return (
    <InformationRequest
      need={data.need}
      rows={evaluateFit(data.need, data.facts)}
      contact={data.contact}
      deliveryEnabled={data.outreach.deliveryEnabled}
      onSave={onSaveDraft}
    />
  );
}

function PairingReply({ data, onAccept, onClarify }: PanelProps) {
  const rows = evaluateFit(data.need, data.facts);
  return (
    <>
      <output className="desk-reply-banner">
        <DeskIcon name="reply" />
        <div>
          <strong>
            Follow-up paused ·{" "}
            {data.replies.some((reply) => reply.channel === "email")
              ? "Reply received"
              : "Reply recorded"}
          </strong>
          <p>Review the original and confirm which answers update this account.</p>
        </div>
      </output>
      <ReplyReview need={data.need} replies={data.replies} facts={data.facts} onAccept={onAccept} />
      <section className="desk-card desk-suggestion">
        <span className="desk-spark">
          <DeskIcon name="spark" />
        </span>
        <div>
          <h2>Suggested next action</h2>
          <p>{suggestions[suggestDecision(rows)]}</p>
        </div>
        <span className="state state-needs_review">Needs review</span>
        <div className="desk-actions">
          <button
            className="quiet-button"
            onClick={() =>
              onClarify?.(
                `Draft a clarification for ${data.account.name}: ${openQuestions(rows).join(" ")}`,
              )
            }
          >
            Draft clarification
          </button>
          <a className="quiet-button" href={data.need.buyerHref}>
            Open buyer need
          </a>
        </div>
      </section>
      <p className="desk-hint">
        <DeskIcon name="info" />
        The background analyst proposes; the specialist reviews. Chat can open this same review
        card.
      </p>
    </>
  );
}

function PairingOutreach(props: PanelProps) {
  const { data, step = outreachStep(data), onRecordNote, sellerHref, review } = props;
  const panels = [
    <section className="desk-card desk-request" key="contact">
      <header className="desk-card-header">
        <DeskIcon name="authority" />
        <h2>Contact review</h2>
      </header>
      <p>
        Contact identity: {data.contact.identity.replaceAll("_", " ")}. Outreach permission:{" "}
        {data.contact.permission.replaceAll("_", " ")}. Contact review happens on the account
        record, where its source and permission evidence are kept.
      </p>
      <div className="desk-actions">
        <a className="quiet-button" href={`${sellerHref}?tab=outreach`}>
          Review contact
        </a>
        <button className="button" onClick={() => review("outreach", 1)}>
          Review draft
        </button>
      </div>
    </section>,
    <PairingDraft key="draft" {...props} />,
    <section className="desk-card desk-request" key="delivery">
      <header className="desk-card-header">
        <DeskIcon name="mail" />
        <h2>Delivery</h2>
        <span className="state state-needs_review">{outreachStates[data.outreach.state]}</span>
      </header>
      {data.outreach.stopReason && <p>{data.outreach.stopReason}.</p>}
      {!data.outreach.deliveryEnabled && (
        <div className="desk-lock" role="note">
          <DeskIcon name="lock" />
          <div>
            <strong>External delivery disabled</strong>
            <p>The reviewed request stays queued. Nothing leaves this workspace.</p>
          </div>
        </div>
      )}
    </section>,
    <PairingReply key="reply" {...props} />,
  ];
  return (
    <>
      <OutreachStepper
        current={step}
        reached={Math.max(outreachStep(data), 1)}
        onStep={(value) => review("outreach", value)}
      />
      {panels[step]}
      {onRecordNote && (
        <section className="desk-card">
          <RecordNote onRecord={onRecordNote} />
        </section>
      )}
    </>
  );
}

function PairingSources({ data }: PanelProps) {
  return (
    <>
      <section className="desk-card">
        <h2>Source changes</h2>
        {data.trigger ? (
          <SourceChangeCard trigger={data.trigger} />
        ) : (
          <p>No source change recorded.</p>
        )}
      </section>
      <section className="desk-card">
        <h2>Buyer need</h2>
        <a href={data.need.buyerHref}>{data.need.buyer}</a>
        <p>
          {data.need.vehicleClass} · {requirementLabel(data.need, "budget")} · Height ≤
          {data.need.maxHeightIn} in · Revision {data.need.revision}
        </p>
      </section>
    </>
  );
}

const panels = {
  overview: PairingOverview,
  fit: PairingFit,
  outreach: PairingOutreach,
  sources: PairingSources,
  activity: PairingActivity,
};

/** Account-first review of one pairing, with a persistent caller-owned conversation. */
export default function SourcingWorkspace({
  data,
  chat,
  problem,
  sellerHref = `/desk/prospects/${data.account.id}`,
  tab,
  onTab,
  step,
  onStep,
  onClarify,
  onSaveDraft,
  onAccept,
  onDecide,
  onRecordNote,
}: {
  data: SourcingAccount;
  chat?: ReactNode;
  problem?: string;
  sellerHref?: string;
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
  step?: number;
  onStep: (step: number) => void;
  onClarify?: (text: string) => void;
  onSaveDraft?: (draft: { subject: string; body: string }) => void;
  onAccept?: (ids: string[]) => void;
  onDecide?: (decision: Decision) => void;
  onRecordNote?: (text: string) => void;
}) {
  const review = (nextTab: AccountTab, nextStep = outreachStep(data)) => {
    onStep(nextStep);
    onTab(nextTab);
  };
  const Panel = panels[tab];
  return (
    <AccountFrame
      name={data.account.name}
      place={data.account.place}
      synthetic={data.account.synthetic}
      context="Seller research"
      secondary={`Buyer need: ${data.need.buyer}`}
      tab={tab}
      onTab={onTab}
      dock={chat}
    >
      {problem && (
        <p role="alert" className="sourcing-problem">
          {problem}
        </p>
      )}
      <Panel
        data={data}
        review={review}
        sellerHref={sellerHref}
        step={step}
        onSaveDraft={onSaveDraft}
        onAccept={onAccept}
        onDecide={onDecide}
        onClarify={onClarify}
        onRecordNote={onRecordNote}
      />
    </AccountFrame>
  );
}
