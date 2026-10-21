import { useState } from "react";
import {
  evaluateFit,
  isStale,
  openQuestions,
  requirementLabel,
  suggestDecision,
  type Decision,
  type Fact,
  type FitRow,
  type FitStatus,
  type Need,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import { formatUsd } from "@signal-desk/contracts/money";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Card } from "@signal-desk/ui/components/ui/card";
import { LiteralProse } from "./prose";
import { DeskIcon } from "./desk-shell";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const fitStates: Record<FitStatus, [label: string, tone: string]> = {
  met: ["Met", "state-reviewed"],
  not_met: ["Does not meet", "state-conflict"],
  unknown: ["Unknown", "state-needs_review"],
  incomplete: ["Incomplete", "state-needs_review"],
  conflicting: ["Conflicting", "state-conflict"],
};
/** Reviewer-facing names for pairing fact fields. */
export const fieldLabels: Record<Fact["field"], string> = {
  saleStatus: "Sale status",
  authority: "Seller authority",
  heightIn: "Height",
  priceCents: "Asking price",
  transportCents: "Transport",
  feesCents: "Other charges",
};
const bases: Record<Fact["basis"], string> = {
  structured: "Form selection",
  explicit_reply: "Explicit reply",
  source_claim: "Source claim",
  ai_interpretation: "Analyst interpretation",
};
const saleStatuses = {
  available: "Available",
  maybe_later: "Maybe later",
  not_selling: "Not selling",
};
const suggestions = {
  reject: "Rule check: a hard constraint fails. Reject this connection.",
  proceed: "Every hard constraint is met by reviewed evidence.",
  investigate: "No recommendation until hard constraints are resolved.",
};

const capitalize = (word: string) => word[0]!.toUpperCase() + word.slice(1);

function factValue(fact: Fact) {
  if (fact.field === "saleStatus") return saleStatuses[fact.value];
  if (fact.field === "heightIn") return `${fact.value} in`;
  if (fact.field === "authority") return fact.value;
  return formatUsd(fact.value);
}

// Names what accepting one proposal would newly fail, so reviewers see the consequence first.
function consequence(need: Need, facts: Fact[], proposal: Fact) {
  const before = evaluateFit(need, facts);
  const after = evaluateFit(
    need,
    facts.map((fact) =>
      fact.id === proposal.id ? { ...fact, status: "accepted", reviewedAt: new Date() } : fact,
    ),
  );
  const failed = after.find(
    (row, index) => row.status === "not_met" && before[index]!.status !== "not_met",
  );
  return failed && requirementLabel(need, failed.requirement);
}

/** A cited source change shown as a research trigger, never as proof of a sale. */
export function SourceChangeCard({
  trigger,
}: {
  trigger: NonNullable<SourcingAccount["trigger"]>;
}) {
  return (
    <Card className="assistance-card sourcing-card" data-card="source-change">
      <Badge variant="outline" className="state state-needs_review border-transparent">
        Research trigger only
      </Badge>
      <blockquote className="card-citation">
        <p className="reading-label">
          {trigger.sourceLabel} · {date.format(trigger.observedAt)}
        </p>
        <LiteralProse text={trigger.excerpt} />
      </blockquote>
      <a className="sourcing-link" href={trigger.url} rel="noreferrer" target="_blank">
        Read original
      </a>
      <p className="card-caveat">
        Does not establish sale availability, seller authority or contact permission.
      </p>
    </Card>
  );
}

// Fit rows name the requirement only; a measured row states its distance from the limit instead.
const fitNames = (need: Need): Record<FitRow["requirement"], string> => ({
  available: "Available for sale",
  height: "Height",
  budget: need.budgetBasis === "total" ? "All-in cost" : "Purchase price",
  authority: "Seller authority",
});

/** Hard constraints against reviewed evidence; unknowns stay visible and never pass. */
export function FitTable({ need, rows }: { need: Need; rows: FitRow[] }) {
  return (
    <div className="sourcing-fit">
      <table>
        <caption className="sr-only">
          {need.buyer} {need.vehicleClass.toLowerCase()} requirements
        </caption>
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Reviewed evidence</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const [label, tone] = fitStates[row.status];
            return (
              <tr key={row.requirement}>
                <th scope="row">
                  <span className="desk-requirement">
                    <DeskIcon name={row.requirement} />
                    {fitNames(need)[row.requirement]}
                  </span>
                </th>
                <td>{row.evidence}</td>
                <td>
                  <span className={`state ${tone}`}>
                    {row.margin ? (
                      <>
                        <span className="sr-only">{label}: </span>
                        {row.margin}
                      </>
                    ) : (
                      label
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="card-caveat">
        {suggestions[suggestDecision(rows)]} Mechanical condition needs a separate inspection.
      </p>
    </div>
  );
}

function requestBody(need: Need, questions: string[]) {
  return [
    `We are researching a possible fit for a department seeking a ${need.vehicleClass.toLowerCase()}. Could you confirm:`,
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    "Reply STOP to opt out of further messages.",
  ].join("\n\n");
}

const readiness = {
  reviewed: "reviewed",
  pending_review: "pending review",
  established: "established",
  not_established: "not established",
};

function ReadinessCheck({ label, value }: { label: string; value: keyof typeof readiness }) {
  const ready = value === "reviewed" || value === "established";
  return (
    <li data-ready={ready}>
      <DeskIcon name={ready ? "check" : "pending"} />
      {label}: {readiness[value]}
    </li>
  );
}

function DeliveryState({ enabled }: { enabled: boolean }) {
  if (enabled)
    return (
      <p className="desk-delivery">Delivery is available only after contact and draft review.</p>
    );
  return (
    <div className="desk-lock" role="note">
      <DeskIcon name="lock" />
      <div>
        <strong>External delivery disabled</strong>
        <p>Outreach is not available in this workspace.</p>
      </div>
    </div>
  );
}

type RequestProps = {
  need: Need;
  rows: FitRow[];
  contact: SourcingAccount["contact"];
  deliveryEnabled: boolean;
  onSave?: (draft: { subject: string; body: string }) => void;
};

// Mirrors growth's frozen two-step sequence; the steps are queued, never sent from here.
const sequence = ["Availability request", "Reminder after 3 days without a reply"];

function RequestForm({ need, rows, contact, deliveryEnabled, onSave }: RequestProps) {
  const questions = openQuestions(rows);
  const [subject, setSubject] = useState(`Is your ${need.vehicleClass.toLowerCase()} for sale?`);
  const [body, setBody] = useState(() => requestBody(need, questions));
  const [saved, setSaved] = useState(false);
  return (
    <>
      <section className="desk-card desk-request" data-card="information-request">
        <header className="desk-card-header">
          <DeskIcon name="source" />
          <h2>Availability request</h2>
          <span className="state state-needs_review">
            {saved ? "Reviewed draft · Not sent" : "Unsent draft"}
          </span>
        </header>
        <div className="desk-request-status">
          <ul className="desk-checks">
            <ReadinessCheck label="Contact identity" value={contact.identity} />
            <ReadinessCheck label="Outreach permission" value={contact.permission} />
          </ul>
          <DeliveryState enabled={deliveryEnabled} />
        </div>
      </section>
      <section className="desk-card desk-message">
        <h2>Message</h2>
        <label htmlFor="request-subject">Subject</label>
        <input
          id="request-subject"
          value={subject}
          onChange={(event) => (setSubject(event.target.value), setSaved(false))}
        />
        <label htmlFor="request-body">Body</label>
        <textarea
          id="request-body"
          rows={11}
          value={body}
          onChange={(event) => (setBody(event.target.value), setSaved(false))}
        />
        <fieldset className="desk-additional" disabled>
          <legend>Additional options</legend>
          <label>
            <input type="checkbox" /> Include Google Form
          </label>
          <span>
            <DeskIcon name="info" />
            Connect a form first
          </span>
        </fieldset>
      </section>
      <section className="desk-card desk-sequence">
        <h2>Follow-up sequence (internal)</h2>
        <ol>
          {sequence.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              Step {index + 1}: {step.toLowerCase()}
            </li>
          ))}
        </ol>
        <p className="desk-hint">
          <DeskIcon name="info" />A reply, opt-out, or uncertain delivery pauses follow-up.
        </p>
      </section>
      <footer className="desk-submit">
        <p className="desk-hint">
          <DeskIcon name="info" />
          Researching a candidate does not mean promising a buyer a truck.
        </p>
        <Button
          disabled={!subject.trim() || !body.includes("STOP")}
          onClick={() => (onSave?.({ subject: subject.trim(), body }), setSaved(true))}
        >
          Save reviewed draft
        </Button>
      </footer>
    </>
  );
}

/** Editable information request for unresolved requirements; saving never sends it. */
export function InformationRequest(props: RequestProps) {
  if (!openQuestions(props.rows).length)
    return (
      <section className="desk-card">
        <p>Every requirement is resolved. No request is needed.</p>
      </section>
    );
  return <RequestForm {...props} />;
}

const channels = {
  email: ["mail", "Email"],
  note: ["note", "Recorded note"],
} as const;

function OriginalResponses({ replies }: { replies: SourcingAccount["replies"] }) {
  return (
    <section className="desk-card desk-originals">
      <h2>Original response</h2>
      {replies.length ? (
        replies.map((reply) => {
          const [icon, label] = channels[reply.channel];
          return (
            <article key={reply.id} id={`reply-${reply.id}`}>
              <header>
                <DeskIcon name={icon} />
                <span>{label}</span>
                <time dateTime={reply.receivedAt.toISOString()}>
                  {date.format(reply.receivedAt)}
                </time>
              </header>
              <blockquote>
                <LiteralProse text={reply.text} />
              </blockquote>
            </article>
          );
        })
      ) : (
        <p className="desk-hint">No replies recorded.</p>
      )}
      <p className="desk-hint">Original responses are retained exactly as received.</p>
    </section>
  );
}

function ProposalRow({
  fact,
  cited,
  checked,
  onToggle,
}: {
  fact: Fact;
  cited: boolean;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <tr className="sourcing-proposal">
      <td>
        <input
          type="checkbox"
          aria-label={`${fieldLabels[fact.field]}: ${factValue(fact)}`}
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </td>
      <th scope="row">{fieldLabels[fact.field]}</th>
      <td>{factValue(fact)}</td>
      <td>
        {bases[fact.basis]}
        {fact.basis === "ai_interpretation" && " · Review"}
      </td>
      <td>{cited ? <a href={`#reply-${fact.sourceRef}`}>Original</a> : "Saved source"}</td>
    </tr>
  );
}

/** Original replies beside proposed facts; only selected proposals become reviewed facts. */
export function ReplyReview({
  need,
  replies,
  facts,
  onAccept,
}: {
  need: Need;
  replies: SourcingAccount["replies"];
  facts: Fact[];
  onAccept?: (factIds: string[]) => void;
}) {
  const proposals = facts.filter((fact) => fact.status === "proposed");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const effects = proposals.flatMap((proposal) => {
    const failed = consequence(need, facts, proposal);
    return failed ? [{ proposal, failed }] : [];
  });
  const toggle = (id: string, checked: boolean) =>
    setSelected((ids) => (checked ? [...ids, id] : ids.filter((other) => other !== id)));
  return (
    <div className="desk-reply" data-card="reply-review">
      <OriginalResponses replies={replies} />
      <section className="desk-card desk-proposals">
        <h2>Proposed updates · Not yet approved</h2>
        {proposals.length ? (
          <div className="desk-table-scroll">
            <table className="desk-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Select all proposed answers"
                      checked={proposals.every((fact) => selected.includes(fact.id))}
                      onChange={(event) =>
                        setSelected(event.target.checked ? proposals.map((fact) => fact.id) : [])
                      }
                    />
                  </th>
                  <th scope="col">Field</th>
                  <th scope="col">Proposed answer</th>
                  <th scope="col">Basis</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((fact) => (
                  <ProposalRow
                    key={fact.id}
                    fact={fact}
                    cited={replies.some((reply) => reply.id === fact.sourceRef)}
                    checked={selected.includes(fact.id)}
                    onToggle={(checked) => toggle(fact.id, checked)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="desk-hint">No proposed updates awaiting review.</p>
        )}
        {effects.map(({ proposal, failed }) => (
          <div key={proposal.id} className="desk-effect" role="note">
            <DeskIcon name="alert" />
            <div>
              <strong>Effect on {need.buyer}&apos;s need</strong>
              <p>
                Accepting {fieldLabels[proposal.field].toLowerCase()} {factValue(proposal)} fails “
                {failed}”. Reject this connection, not the seller account. Keep the buyer need open.
              </p>
            </div>
          </div>
        ))}
        {proposals.length > 0 && (
          <>
            <div className="desk-split-actions">
              <Button
                disabled={!selected.length}
                onClick={() => (onAccept?.(selected), setSelected([]), setNotice(""))}
              >
                Save selected reviewed answers
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected([]);
                  setNotice("Kept unresolved. No reviewed facts changed.");
                }}
              >
                Keep unresolved
              </Button>
            </div>
            <output aria-live="polite" className="desk-hint">
              {notice || "Unselected proposals stay unresolved."}
            </output>
          </>
        )}
      </section>
    </div>
  );
}

// A recorded connection decision with its date and need revision, flagged when stale; otherwise
// the rule suggestion.
function Recorded({
  decision,
  suggested,
  stale,
}: {
  decision: SourcingAccount["decision"];
  suggested: Decision["decision"];
  stale: boolean;
}) {
  if (!decision) return <p className="card-caveat">{suggestions[suggested]}</p>;
  return (
    <div className="card-next-action">
      <p className="reading-label">
        Recorded {date.format(decision.decidedAt)} against need revision{" "}
        {decision.basis.needRevision}
        {stale && (
          <>
            {" "}
            <span className="state state-conflict">
              Stale: the need or reviewed evidence changed, decide again
            </span>
          </>
        )}
      </p>
      <p>
        <strong>{capitalize(decision.decision)}</strong>: {decision.reason}
      </p>
    </div>
  );
}

/** The chat summary of the connection decision; a decision made against an older need or
 * evidence is flagged and asks for a new one. */
export function DecisionChatCard({
  account,
  rows,
  onOpen,
}: {
  account: Pick<SourcingAccount, "decision" | "need" | "facts">;
  rows: FitRow[];
  onOpen: () => void;
}) {
  const stale = Boolean(
    account.decision && isStale(account.decision.basis, account.need, account.facts),
  );
  const [buttonClass, action] = stale
    ? ["button", "Decide again"]
    : ["quiet-button", "Open decision"];
  return (
    <section className="desk-card desk-chat-card">
      <h3>Connection decision</h3>
      <Recorded decision={account.decision} suggested={suggestDecision(rows)} stale={stale} />
      <button className={buttonClass} onClick={onOpen}>
        {action}
      </button>
    </section>
  );
}

/** Records proceed, investigate or reject for this connection only. */
export function DecisionPacket({
  need,
  rows,
  decision,
  stale = false,
  onDecide,
}: {
  need: Need;
  rows: FitRow[];
  decision: SourcingAccount["decision"];
  stale?: boolean;
  onDecide?: (decision: Decision) => void;
}) {
  const suggested = suggestDecision(rows);
  // Follows the rule suggestion until the specialist picks, and never keeps a stale proceed.
  const [picked, setChoice] = useState<Decision["decision"]>();
  const choice = picked === "proceed" ? suggested : (picked ?? suggested);
  const [reason, setReason] = useState("");
  const failed = rows.filter((row) => row.status === "not_met");
  return (
    <Card className="assistance-card sourcing-card" data-card="decision">
      <h3>Connection decision</h3>
      <Recorded decision={decision} suggested={suggested} stale={stale} />
      {failed.length > 0 && (
        <ul className="card-list">
          {failed.map((row) => (
            <li key={row.requirement}>
              {requirementLabel(need, row.requirement)}: {row.evidence}
            </li>
          ))}
        </ul>
      )}
      <fieldset className="sourcing-choices">
        <legend className="reading-label">Decision</legend>
        {(["proceed", "investigate", "reject"] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="pairing-decision"
              value={option}
              checked={choice === option}
              disabled={option === "proceed" && suggested !== option}
              onChange={() => setChoice(option)}
            />
            {capitalize(option)}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="decision-reason">Reason</label>
        <textarea
          id="decision-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <p className="card-caveat">
        Applies to this connection only. {need.buyer}&apos;s need stays open after a rejection. No
        mechanical or safety guarantee.
      </p>
      <Button
        disabled={!reason.trim()}
        onClick={() => onDecide?.({ decision: choice, reason: reason.trim() })}
      >
        Record decision
      </Button>
    </Card>
  );
}

/** Records a reply received outside email, such as a call, verbatim; parsing only proposes. */
export function RecordNote({ onRecord }: { onRecord: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="sourcing-note"
      onSubmit={(event) => {
        event.preventDefault();
        onRecord(text.trim());
        setText("");
      }}
    >
      <label htmlFor="sourcing-note">Record a reply received by phone or in person</label>
      <textarea
        id="sourcing-note"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="card-caveat">
        Saved verbatim. Explicit measurements become proposals for your review, never facts.
      </p>
      <Button type="submit" variant="outline" disabled={!text.trim()}>
        Record reply
      </Button>
    </form>
  );
}
