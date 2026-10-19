"use client";
import { useState } from "react";
import type { SourcingCardRef, SourcingStreamView } from "@signal-desk/contracts/assistance-schema";
import { evaluateFit, isStale } from "@signal-desk/contracts/sourcing-schema";
import {
  DecisionPacket,
  FitTable,
  InformationRequest,
  ReplyReview,
  SourceChangeCard,
} from "@signal-desk/catalog/sourcing-cards";
import SourcingWorkspace from "@signal-desk/catalog/sourcing-workspace";
import { postPrototypeCommand } from "@/app/prototype-command";
import type { getSourcingAccount } from "@/server/sourcing";
import ChatAdapter from "../../chat-adapter";

type View = Awaited<ReturnType<typeof getSourcingAccount>>;
const copy = {
  title: "Sourcing assistant",
  empty:
    "Ask what would make this pairing worth pursuing, compare it with the buyer need, or draft questions for the seller.",
  placeholder: "Ask about this pairing…",
};

// Dates arrive as JSON strings from the API; the page renders from Date values.
function revive(view: View): View {
  const { account } = view;
  const date = (value: Date | string) => new Date(value);
  return {
    ...view,
    account: {
      ...account,
      trigger: account.trigger && {
        ...account.trigger,
        observedAt: date(account.trigger.observedAt),
      },
      inventorySearch: account.inventorySearch && {
        ...account.inventorySearch,
        searchedAt: date(account.inventorySearch.searchedAt),
      },
      replies: account.replies.map((reply) => ({ ...reply, receivedAt: date(reply.receivedAt) })),
      facts: account.facts.map((fact) => ({
        ...fact,
        reviewedAt: fact.reviewedAt && date(fact.reviewedAt),
      })),
      decision: account.decision && {
        ...account.decision,
        decidedAt: date(account.decision.decidedAt),
      },
    },
  };
}

/** Connects the department page and its assistant to the same saved case and commands. */
export default function SourcingDesk({
  initial,
  streams,
}: {
  initial: View;
  streams: SourcingStreamView[];
}) {
  const [view, setView] = useState(initial);
  const [problem, setProblem] = useState("");
  const endpoint = `/api/v1/desk/sourcing/${encodeURIComponent(view.caseId)}`;
  async function refresh() {
    const response = await fetch(endpoint);
    if (response.ok) setView(revive((await response.json()).data));
  }
  async function command(body: Record<string, unknown>) {
    setProblem("");
    try {
      await postPrototypeCommand(
        endpoint,
        JSON.stringify({ ...body, revision: view.revision }),
        crypto.randomUUID(),
      );
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The command was not saved.");
    }
    await refresh();
  }
  const { account } = view;
  const rows = evaluateFit(account.need, account.facts);
  // Chat cards are references; they render from the same current record as the page.
  function renderCard(card: SourcingCardRef) {
    if (card.view === "source_change")
      return account.trigger && <SourceChangeCard trigger={account.trigger} />;
    if (card.view === "fit") return <FitTable need={account.need} rows={rows} />;
    if (card.view === "information_request")
      return (
        <InformationRequest
          need={account.need}
          rows={rows}
          contact={account.contact}
          deliveryEnabled={account.outreach.deliveryEnabled}
          onSave={(draft) => command({ kind: "draft", ...draft })}
        />
      );
    if (card.view === "reply_review")
      return (
        <ReplyReview
          need={account.need}
          replies={account.replies}
          facts={account.facts}
          onAccept={(factIds) => command({ kind: "accept", factIds })}
        />
      );
    return (
      <DecisionPacket
        need={account.need}
        rows={rows}
        decision={account.decision}
        stale={!!account.decision && isStale(account.decision.basis, account.need, account.facts)}
        onDecide={(decision) => command({ kind: "decide", ...decision })}
      />
    );
  }
  return (
    <SourcingWorkspace
      data={account}
      problem={problem}
      sellerHref={view.sellerHref}
      onSaveDraft={(draft) => command({ kind: "draft", ...draft })}
      onAccept={(factIds) => command({ kind: "accept", factIds })}
      onDecide={(decision) => command({ kind: "decide", ...decision })}
      onRecordNote={(text) => command({ kind: "record_original", text })}
      chat={
        <ChatAdapter
          subject="sourcing"
          subjectId={view.caseId}
          context={`${account.need.buyer} · ${account.account.name}`}
          initialStreams={streams}
          copy={copy}
          renderSourcingCard={renderCard}
          onSettled={() => void refresh()}
        />
      }
    />
  );
}
