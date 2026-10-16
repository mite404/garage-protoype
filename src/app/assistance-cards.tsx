import Link from "next/link";
import type { InlineCard } from "@/server/assistance-schema";
import { fieldLabels } from "@/server/evidence-schema";

/** Gives both buyer entry points the same invited-access explanation without private record details. */
export function BuyerAccessNotice({ message }: { message: string }) {
  return (
    <section>
      <h1>Invited buyer access</h1>
      <p className="my-5">{message}</p>
      <Link className="button" href="/sign-in">
        Sign in with an invited buyer account
      </Link>
    </section>
  );
}

/** Renders only the finite authored catalog. Text is escaped by React; no generated markup runs. */
export default function AssistanceCard({ card }: { card: InlineCard }) {
  switch (card.kind) {
    case "answer":
      return (
        <article className="claim-card" data-card="answer">
          <p className="state state-reviewed">Reviewed, shareable evidence</p>
          <h3 className="mt-3 font-semibold">{fieldLabels[card.field]}</h3>
          <p className="text-2xl font-semibold">{card.value}</p>
          <blockquote className="mt-3 text-sm text-stone-600">
            {card.citation.sourceLabel}
            <br />
            {card.citation.excerpt}
          </blockquote>
        </article>
      );
    case "review":
      return (
        <article className="claim-card" data-card="review">
          <p className={`state state-${card.state === "conflict" ? "conflict" : "needs_review"}`}>
            {card.state === "conflict"
              ? "Conflicting evidence"
              : card.state === "human_review"
                ? "Human interpretation required"
                : "Unknown · Review required"}
          </p>
          <h3 className="mt-3 font-semibold">No supported answer yet.</h3>
          <p className="mt-2 text-sm">{card.nextAction}</p>
          <p className="mt-3 break-all text-xs text-stone-500">
            Assigned specialist · {card.assigneeId}
            <br />
            Blocker · {card.blockerId}
          </p>
        </article>
      );
    case "handoff":
      return (
        <article className="claim-card" data-card="handoff">
          <p className="state state-needs_review">Offer recorded · Not accepted</p>
          <h3 className="mt-3 text-2xl font-semibold">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: card.currency,
              maximumFractionDigits: 2,
            }).format(card.amountMinor / 100)}
          </h3>
          <p className="mt-2 text-sm">Stated timing · {card.timingText}</p>
          <h4 className="mt-3 text-sm font-semibold">Conditions retained</h4>
          <ul className="list-inside list-disc text-sm">
            {card.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          {!card.conditions.length && <p className="text-sm">No additional conditions supplied.</p>}
          <h4 className="mt-3 text-sm font-semibold">Unanswered questions</h4>
          <ul className="list-inside list-disc text-sm">
            {card.unansweredQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm">{card.nextAction}</p>
          <p className="mt-2 break-all text-xs text-stone-500">
            Assigned specialist · {card.assigneeId}
          </p>
        </article>
      );
    case "draft":
      return (
        <article className="claim-card" data-card="draft">
          <p className="state state-needs_review">
            Unsent draft ·{" "}
            {card.reviewState === "stale"
              ? "Evidence changed, review again"
              : "Human review required"}
          </p>
          <h3 className="mt-3 font-semibold">{card.purpose.replaceAll("_", " ")}</h3>
          <p className="mt-2 text-sm">Proposed recipient · {card.recipientLabel}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm">{card.body}</p>
          <p className="mt-3 text-xs text-stone-500">
            No delivery action exists. Recipient identity is not verified.
          </p>
        </article>
      );
  }
}
