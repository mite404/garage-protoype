"use client";
import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SourcingCardRef, SourcingStreamView } from "@signal-desk/contracts/assistance-schema";
import { evaluateFit, openQuestions } from "@signal-desk/contracts/sourcing-schema";
import { accountTab, type AccountTab } from "@signal-desk/catalog/desk-shell";
import type { ChatComposerHandle } from "@signal-desk/catalog/sale-chat";
import { FitTable, SourceChangeCard } from "@signal-desk/catalog/sourcing-cards";
import SourcingWorkspace from "@signal-desk/catalog/sourcing-workspace";
import { postPrototypeCommand } from "@/app/prototype-command";
import type { getSourcingAccount } from "@/server/sourcing";
import ChatAdapter from "../../chat-adapter";

type View = Awaited<ReturnType<typeof getSourcingAccount>>;
const copy = {
  title: "Account assistant",
  empty:
    "Ask what would make this account worth pursuing, compare it with the buyer need, or draft questions for the seller.",
  placeholder: "Ask about this account…",
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
      connection: {
        ...account.connection,
        milestones: account.connection.milestones.map((milestone) => ({
          ...milestone,
          at: date(milestone.at),
        })),
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
  const [step, setStep] = useState<number>();
  const composer = useRef<ChatComposerHandle>(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  function changeTab(tab: AccountTab) {
    const next = new URLSearchParams(params);
    next.set("tab", tab);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  function review(tab: AccountTab, nextStep?: number) {
    setStep(nextStep);
    changeTab(tab);
  }
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
      // A saved change moves the stepper to the step the record has now reached.
      setStep(undefined);
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
        <section className="desk-card desk-chat-card">
          <span className="state state-needs_review">Draft only</span>
          <h3>Information request</h3>
          <p>Questions to verify before outreach.</p>
          <ul className="desk-questions">
            {openQuestions(rows).map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <h4>Citations</h4>
          <a href={account.need.buyerHref}>[1] Buyer need</a>
          {account.trigger && (
            <a href={account.trigger.url} target="_blank" rel="noreferrer">
              [2] {account.trigger.sourceLabel}
            </a>
          )}
          {account.contact.permission !== "established" && (
            <p>Contact permission required before outreach.</p>
          )}
          <button className="button" onClick={() => review("outreach", 1)}>
            Review draft
          </button>
          <button className="quiet-button" onClick={() => review("overview")}>
            Open full record
          </button>
        </section>
      );
    if (card.view === "reply_review")
      return (
        <section className="desk-card desk-chat-card">
          <h3>Proposed updates</h3>
          <p>
            {account.facts.filter((fact) => fact.status === "proposed").length} answers await
            review.
          </p>
          <button className="button" onClick={() => review("outreach", 3)}>
            Review answers
          </button>
        </section>
      );
    return (
      <section className="desk-card desk-chat-card">
        <h3>Connection decision</h3>
        <p>
          {account.decision
            ? `${account.decision.decision}: ${account.decision.reason}`
            : "No decision recorded."}
        </p>
        <button className="quiet-button" onClick={() => review("fit")}>
          Open decision
        </button>
      </section>
    );
  }
  return (
    <SourcingWorkspace
      data={account}
      tab={accountTab(params.get("tab"))}
      onTab={changeTab}
      step={step}
      onStep={setStep}
      onClarify={(text) => composer.current?.prefill(text)}
      problem={problem}
      sellerHref={view.sellerHref}
      onSaveDraft={(draft) => command({ kind: "draft", ...draft })}
      onAccept={(factIds) => command({ kind: "accept", factIds })}
      onDecide={(decision) => command({ kind: "decide", ...decision })}
      onMilestone={(kind, note) => command({ kind, note })}
      onRecordNote={async (text) => {
        await command({ kind: "record_original", text });
        setStep(3);
      }}
      chat={
        <ChatAdapter
          variant="dock"
          composerRef={composer}
          subject="sourcing"
          subjectId={view.caseId}
          context={`${account.account.name} · ${account.need.buyer} connection`}
          initialStreams={streams}
          copy={copy}
          renderSourcingCard={renderCard}
          onSettled={() => void refresh()}
        />
      }
    />
  );
}
