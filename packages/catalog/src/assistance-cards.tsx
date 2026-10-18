import type { InlineCard, RoutingSuggestion } from "@signal-desk/contracts/assistance-schema";
import { fieldLabels } from "@signal-desk/contracts/evidence-schema";
import { Badge } from "@signal-desk/ui/components/ui/badge";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Card } from "@signal-desk/ui/components/ui/card";
import { LiteralProse, Prose } from "./prose";

const reviewReasons = {
  low_confidence: "Jev was not confident about a single field.",
  multiple: "The question asks about more than one fact.",
  judgment: "The question asks for a judgment, not a recorded fact.",
  other: "No evidence field fits this question.",
};

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
          <Badge variant="outline" className="state state-reviewed border-transparent">
            Reviewed, shareable evidence
          </Badge>
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
          <Badge
            variant="outline"
            className={`state border-transparent state-${card.state === "conflict" ? "conflict" : "needs_review"}`}
          >
            {card.state === "conflict"
              ? "Conflicting evidence"
              : card.state === "human_review"
                ? "Human interpretation required"
                : "Unknown · Review required"}
          </Badge>
          <div>
            <p className="reading-label">Question</p>
            <h3>{card.question}</h3>
          </div>
          {card.suggestion && (
            <Suggestion
              suggestion={card.suggestion}
              onAccept={
                onAcceptSuggestion &&
                (() => onAcceptSuggestion(card.inquiryId, card.routingRevision))
              }
            />
          )}
          <p className="card-caveat">No supported answer yet.</p>
          <div className="card-next-action">
            <p className="reading-label">Next human action</p>
            <Prose text={card.nextAction} />
          </div>
          <dl className="card-meta">
            <div>
              <dt>Assigned specialist</dt>
              <dd>{card.assigneeId}</dd>
            </div>
            <div>
              <dt>Blocker reference</dt>
              <dd>{card.blockerId}</dd>
            </div>
          </dl>
        </Card>
      );
    case "handoff":
      return (
        <Card className="assistance-card" data-card="handoff">
          <Badge variant="outline" className="state state-needs_review border-transparent">
            Offer recorded · Not accepted
          </Badge>
          <h3 className="answer-value">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: card.currency,
              maximumFractionDigits: 2,
            }).format(card.amountMinor / 100)}
          </h3>
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
          <dl className="card-meta">
            <div>
              <dt>Assigned specialist</dt>
              <dd>{card.assigneeId}</dd>
            </div>
          </dl>
        </Card>
      );
    case "draft":
      return (
        <Card className="assistance-card" data-card="draft">
          <Badge variant="outline" className="state state-needs_review border-transparent">
            Unsent draft ·{" "}
            {card.reviewState === "stale"
              ? "Evidence changed, review again"
              : "Human review required"}
          </Badge>
          <h3>{card.purpose.replaceAll("_", " ")}</h3>
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
