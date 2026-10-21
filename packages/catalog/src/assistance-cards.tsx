import type { InlineCard, RoutingSuggestion } from "@signal-desk/contracts/assistance-schema";
import { fieldLabels } from "@signal-desk/contracts/evidence-schema";
import { formatUsd } from "@signal-desk/contracts/money";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Card } from "@signal-desk/ui/components/ui/card";
import { LiteralProse, Prose } from "./prose";

// Handoff status drives the badge copy and tone.
// Draft purposes are the draft command kinds; an unknown one shows as stored.
const draftPurposes: Record<string, string> = {
  seller_request: "Seller request",
  buyer_followup: "Buyer follow-up",
  photo_request: "Photo request",
};
const handoffStates = {
  recorded_not_accepted: ["Offer recorded · Not accepted", "state-needs_review"],
} as const;

const reviewReasons = {
  low_confidence: "Jev was not confident about a single field.",
  multiple: "The question asks about more than one fact.",
  judgment: "The question asks for a judgment, not a recorded fact.",
  other: "No evidence field fits this question.",
};

// "$6,500 below current terms of $171,500", so the offer is read against the deal it changes.
function termsComparison(amount: number, terms: number) {
  const gap = amount - terms;
  if (gap === 0) return `Matches current terms of ${formatUsd(terms)}`;
  return `${formatUsd(Math.abs(gap))} ${gap < 0 ? "below" : "above"} current terms of ${formatUsd(terms)}`;
}

function Suggestion({
  suggestion,
  onAccept,
}: {
  suggestion: RoutingSuggestion;
  onAccept?: () => void;
}) {
  if (suggestion.state === "unavailable")
    return <p className="card-caveat">Jev routing unavailable. Route this question manually.</p>;
  return (
    <div className="card-suggestion">
      <p className="reading-label">
        {suggestion.state === "suggested" ? "Jev suggestion" : "Needs human review"}
      </p>
      {suggestion.state === "suggested" ? (
        <>
          <p>
            {fieldLabels[suggestion.field]} · {Math.round(suggestion.confidence * 100)}% confidence
          </p>
          <p className="card-caveat">Suggestion only. Confirm before routing.</p>
          {onAccept && (
            <Button variant="outline" onClick={onAccept}>
              Use suggested field
            </Button>
          )}
        </>
      ) : (
        <p className="card-caveat">{reviewReasons[suggestion.reason]}</p>
      )}
    </div>
  );
}

// An offer reads against the deal it would change; buyers receive no terms to compare.
function OfferCard({ card }: { card: Extract<InlineCard, { kind: "handoff" }> }) {
  return (
    <Card className="assistance-card" data-card="handoff">
      <span className={`state ${handoffStates[card.status][1]}`}>
        {handoffStates[card.status][0]}
      </span>
      <div>
        <h3 className="answer-value">{formatUsd(card.amountMinor)}</h3>
        {card.termsAmountMinor !== null && (
          <p className="reading-label">
            {termsComparison(card.amountMinor, card.termsAmountMinor)}
          </p>
        )}
      </div>
      <div>
        <p className="reading-label">Stated timing</p>
        <LiteralProse text={card.timingText} />
      </div>
      <div>
        <h4 className="reading-label">Conditions retained</h4>
        <ul className="card-list">
          {card.conditions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        {!card.conditions.length && <LiteralProse text="No additional conditions supplied." />}
      </div>
      <div>
        <h4 className="reading-label">Unanswered questions</h4>
        <ul className="card-list">
          {card.unansweredQuestions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
        {!card.unansweredQuestions.length && (
          <LiteralProse text="No unanswered questions supplied." />
        )}
      </div>
      <div className="card-next-action">
        <p className="reading-label">Next human action</p>
        <Prose text={card.nextAction} />
      </div>
      <p className="card-meta">Assigned to {card.assigneeId}</p>
    </Card>
  );
}

/** Renders only the finite authored catalog. Text is escaped by React; no generated markup runs. */
export default function AssistanceCard({
  card,
  onAcceptSuggestion,
}: {
  card: InlineCard;
  /** Offered only by specialist hosts with the current inquiry revision. */
  onAcceptSuggestion?: (inquiryId: string, routingRevision: number) => void;
}) {
  switch (card.kind) {
    case "answer":
      return (
        <Card className="assistance-card" data-card="answer">
          <span className="state state-reviewed">Reviewed, shareable evidence</span>
          <div>
            <p className="reading-label">{fieldLabels[card.field]}</p>
            <p className="answer-value">{card.value}</p>
          </div>
          <blockquote className="card-citation">
            <p className="reading-label">{card.citation.sourceLabel}</p>
            <LiteralProse text={card.citation.excerpt} />
          </blockquote>
        </Card>
      );
    case "review":
      return (
        <Card className="assistance-card" data-card="review">
          <span
            className={`state state-${card.state === "conflict" ? "conflict" : "needs_review"}`}
          >
            {card.state === "conflict"
              ? "Conflicting evidence"
              : card.state === "human_review"
                ? "Human interpretation required"
                : "Unknown · Review required"}
          </span>
          <h3>{card.question}</h3>
          {card.suggestion && (
            <Suggestion
              suggestion={card.suggestion}
              onAccept={
                onAcceptSuggestion &&
                (() => onAcceptSuggestion(card.inquiryId, card.routingRevision))
              }
            />
          )}
          <div className="card-next-action">
            <p className="reading-label">Next human action</p>
            <Prose text={card.nextAction} />
          </div>
          <p className="card-meta">
            Assigned to {card.assigneeId} · Blocker {card.blockerId}
          </p>
        </Card>
      );
    case "handoff":
      return <OfferCard card={card} />;
    case "draft":
      return (
        <Card className="assistance-card" data-card="draft">
          <span className="state state-needs_review">
            Unsent draft ·{" "}
            {card.reviewState === "stale"
              ? "Evidence changed, review again"
              : "Human review required"}
          </span>
          <h3>{draftPurposes[card.purpose] ?? card.purpose}</h3>
          <div>
            <p className="reading-label">Proposed recipient</p>
            <LiteralProse text={card.recipientLabel} />
          </div>
          <LiteralProse text={card.body} />
          <p className="card-caveat">
            No delivery action exists. Recipient identity is not verified.
          </p>
        </Card>
      );
  }
}
