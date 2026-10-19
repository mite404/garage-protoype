import { useState } from "react";
import {
  evaluateFit,
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
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Card } from "@signal-desk/ui/components/ui/card";
import { LiteralProse } from "./prose";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const fitStates: Record<FitStatus, [label: string, tone: string]> = {
  met: ["Met", "state-reviewed"],
  not_met: ["Does not meet", "state-conflict"],
  unknown: ["Unknown", "state-needs_review"],
  incomplete: ["Incomplete", "state-needs_review"],
  conflicting: ["Conflicting", "state-conflict"],
};
const fieldLabels: Record<Fact["field"], string> = {
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
  reject: "Rule check: a hard constraint fails. Reject this pairing.",
  proceed: "Every hard constraint is met by reviewed evidence.",
  investigate: "No recommendation until hard constraints are resolved.",
};

const capitalize = (word: string) => word[0]!.toUpperCase() + word.slice(1);

function factValue(fact: Fact) {
  if (fact.field === "saleStatus") return saleStatuses[fact.value];
  if (fact.field === "heightIn") return `${fact.value} in`;
  if (fact.field === "authority") return fact.value;
  return usd.format(fact.value / 100);
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
                <th scope="row">{requirementLabel(need, row.requirement)}</th>
                <td>{row.evidence}</td>
                <td>
                  <span className={`state ${tone}`}>{label}</span>
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
  reviewed: "Reviewed",
  pending_review: "Pending review",
  established: "Established",
  not_established: "Not established",
};

function Readiness({
  contact,
  deliveryEnabled,
}: {
  contact: SourcingAccount["contact"];
  deliveryEnabled: boolean;
}) {
  const ready = contact.identity === "reviewed" && contact.permission === "established";
  return (
    <dl className="card-meta sourcing-readiness">
      <div>
        <dt>Contact identity</dt>
        <dd>{readiness[contact.identity]}</dd>
      </div>
      <div>
        <dt>Outreach permission</dt>
        <dd>{readiness[contact.permission]}</dd>
      </div>
      <div>
        <dt>Delivery</dt>
        <dd>
          {deliveryEnabled && ready ? "Available after review" : "Disabled in this workspace"}
        </dd>
      </div>
    </dl>
  );
}

/** Editable information request for unresolved requirements; saving never sends it. */
export function InformationRequest({
  need,
  rows,
  contact,
  deliveryEnabled,
  onSave,
}: {
  need: Need;
  rows: FitRow[];
  contact: SourcingAccount["contact"];
  deliveryEnabled: boolean;
  onSave?: (draft: { subject: string; body: string }) => void;
}) {
  const questions = openQuestions(rows);
  const [subject, setSubject] = useState(`Is your ${need.vehicleClass.toLowerCase()} for sale?`);
  const [body, setBody] = useState(() => requestBody(need, questions));
  const [saved, setSaved] = useState(false);
  if (!questions.length)
    return <p className="card-caveat">Every requirement is resolved. No request is needed.</p>;
  return (
    <Card className="assistance-card sourcing-card" data-card="information-request">
      <Badge variant="outline" className="state state-needs_review border-transparent">
        {saved ? "Reviewed draft · Not sent" : "Unsent draft"}
      </Badge>
      <h3>Information request</h3>
      <Readiness contact={contact} deliveryEnabled={deliveryEnabled} />
      <div>
        <label htmlFor="request-subject">Subject</label>
        <input
          id="request-subject"
          value={subject}
          onChange={(event) => (setSubject(event.target.value), setSaved(false))}
        />
      </div>
      <div>
        <label htmlFor="request-body">Message</label>
        <textarea
          id="request-body"
          rows={9}
          value={body}
          onChange={(event) => (setBody(event.target.value), setSaved(false))}
        />
      </div>
      <p className="card-caveat">
        A reply, opt-out or uncertain delivery stops follow-up. Researching a candidate does not
        promise the buyer a vehicle.
      </p>
      <Button
        disabled={!subject.trim() || !body.includes("STOP")}
        onClick={() => (onSave?.({ subject: subject.trim(), body }), setSaved(true))}
      >
        Save reviewed draft
      </Button>
    </Card>
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
  const effects = proposals.flatMap((proposal) => {
    const failed = consequence(need, facts, proposal);
    return failed ? [{ proposal, failed }] : [];
  });
  return (
    <Card className="assistance-card sourcing-card" data-card="reply-review">
      <h3>Replies and proposed updates</h3>
      {replies.length ? (
        replies.map((reply) => (
          <blockquote key={reply.id} className="card-citation">
            <p className="reading-label">
              {reply.channel === "email" ? "Original email" : "Recorded note"} ·{" "}
              {date.format(reply.receivedAt)}
            </p>
            <LiteralProse text={reply.text} />
          </blockquote>
        ))
      ) : (
        <p className="card-caveat">No replies recorded.</p>
      )}
      {proposals.length ? (
        <fieldset className="sourcing-proposals">
          <legend className="reading-label">Proposed updates · Not yet approved</legend>
          {proposals.map((fact) => (
            <label key={fact.id} className="sourcing-proposal">
              <input
                type="checkbox"
                checked={selected.includes(fact.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked ? [...ids, fact.id] : ids.filter((id) => id !== fact.id),
                  )
                }
              />
              <span>
                {fieldLabels[fact.field]}: <strong>{factValue(fact)}</strong>
              </span>
              <span className="sourcing-basis">{bases[fact.basis]}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="card-caveat">No proposed updates awaiting review.</p>
      )}
      {effects.map(({ proposal, failed }) => (
        <div key={proposal.id} className="card-next-action" role="note">
          <p className="reading-label">Effect on {need.buyer}&apos;s need</p>
          <p>
            Accepting {fieldLabels[proposal.field].toLowerCase()} {factValue(proposal)} fails the
            requirement “{failed}”. That rejects this pairing, not the seller account, and the buyer
            need stays open.
          </p>
        </div>
      ))}
      {proposals.length > 0 && (
        <>
          <p className="card-caveat">Unselected proposals stay unresolved.</p>
          <Button
            disabled={!selected.length}
            onClick={() => (onAccept?.(selected), setSelected([]))}
          >
            Save selected reviewed answers
          </Button>
        </>
      )}
    </Card>
  );
}

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

/** Records proceed, investigate or reject for this pairing only. */
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
      <h3>Pairing decision</h3>
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
        Applies to this pairing only. {need.buyer}&apos;s need stays open after a rejection. No
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
