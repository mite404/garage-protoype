"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { getAssistance } from "@/server/assistance";
import type { Workbench } from "@/server/evidence";
import { fieldSchema, fieldLabels } from "@signal-desk/contracts/evidence-schema";
import AssistanceCard from "@signal-desk/catalog/assistance-card";
import { ConversationTurn, Prose } from "@signal-desk/catalog/prose";
import { postPrototypeCommand } from "@/app/prototype-command";

type View = Awaited<ReturnType<typeof getAssistance>>;

/** Specialist conversation and human handoff controls call the shared authorized operations only. */
export default function Conversation({
  view,
  photoRequest,
}: {
  view: View;
  photoRequest: Workbench["photoRequest"];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const retry = useRef({ body: "", key: "" });
  async function save(body: unknown) {
    if (pending) return;
    const serialized = JSON.stringify(body);
    if (retry.current.body !== serialized)
      retry.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setMessage("");
    try {
      await postPrototypeCommand(
        `/api/v1/desk/opportunities/${encodeURIComponent(view.opportunityId)}/assistance`,
        serialized,
        retry.current.key,
      );
      retry.current = { body: "", key: "" };
      setMessage("Saved inside this prototype. Nothing was sent.");
      router.refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setPending(false);
    }
  }
  function chat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save({ kind: "chat", message: form.get("message") });
  }
  return (
    <section className="panel my-7" aria-labelledby="conversation-heading" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Resolve the buyer's next question</p>
          <h2 id="conversation-heading">Specialist conversation</h2>
        </div>
        <span className="state state-unknown">Bounded assistance · No external sending</span>
      </div>
      <div className="mt-4">
        <Prose
          text={
            'Ask a single-field question such as "What is the tank capacity?" or "What was the pump-test result?"\n\n**No live language model is installed.** Other wording becomes an assigned human-review item, never a guessed answer.'
          }
        />
      </div>
      <div className="my-5 space-y-5" aria-label="Conversation history">
        {!view.turns.length && (
          <p className="rounded-md bg-stone-50 p-5 text-sm text-stone-500">
            Start with the question blocking this sale. Answers use only reviewed, shareable
            evidence.
          </p>
        )}
        {view.turns.map((turn) => (
          <ConversationTurn key={turn.id} request={turn.message}>
            {turn.cards.map((card, i) => (
              <AssistanceCard card={card} key={i} />
            ))}
            {!turn.cards.length && (
              <p className="text-sm text-stone-600">
                No current card is available. Evidence may have changed. Retry the question as a new
                turn or review its task below.
              </p>
            )}
            {turn.statuses.some((s) => s === "malformed" || s === "retired") && (
              <output className="mt-2 block text-sm text-red-800">
                A malformed card was rejected. A tool retires after two malformed calls for this
                turn only.
              </output>
            )}
          </ConversationTurn>
        ))}
      </div>
      <form onSubmit={chat}>
        <fieldset disabled={pending}>
          <label htmlFor="specialist-message">Question for the evidence desk</label>
          <textarea
            id="specialist-message"
            name="message"
            rows={2}
            required
            maxLength={2000}
            placeholder="What was the pump-test result?"
          />
          <button className="button mt-3">{pending ? "Saving…" : "Ask evidence desk"}</button>
        </fieldset>
      </form>
      <output className="mt-3 block text-sm text-stone-600" aria-live="polite">
        {message}
      </output>
      <details className="mt-6 border-t border-stone-200 pt-5">
        <summary className="cursor-pointer font-semibold">
          Buyer inquiries and human next actions ({view.inquiries.length})
        </summary>
        <div className="mt-5 space-y-6">
          {view.inquiries.map((q) => (
            <article key={q.id} className="border-b border-stone-200 pb-5">
              <p className="mb-3 whitespace-pre-wrap text-sm">
                <strong>Original inquiry</strong>
                <br />
                {q.input.text}
              </p>
              <AssistanceCard card={q.card} />
              <p className="mt-2 text-xs text-stone-500">
                Current classification · {q.classification.replaceAll("_", " ")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  className="quiet-button"
                  disabled={pending}
                  onClick={() =>
                    void save({
                      kind: "draft",
                      input: { kind: "seller_request", inquiryId: q.id, revision: view.revision },
                    })
                  }
                >
                  Prepare seller request
                </button>
                <button
                  className="quiet-button"
                  disabled={pending || q.card.kind !== "answer"}
                  onClick={() =>
                    void save({
                      kind: "draft",
                      input: { kind: "buyer_followup", inquiryId: q.id, revision: view.revision },
                    })
                  }
                >
                  Prepare reviewed buyer follow-up
                </button>
              </div>
              {q.input.kind !== "offer" && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm">Correct inquiry routing</summary>
                  <form
                    className="mt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void save({
                        kind: "correct",
                        inquiryId: q.id,
                        input: {
                          field: form.get("field") || null,
                          reason: form.get("reason"),
                          nextAction: form.get("nextAction"),
                          revision: q.history[0]?.revision,
                        },
                      });
                    }}
                  >
                    <fieldset disabled={pending}>
                      <label htmlFor={`${q.id}-field`}>Clarified question field</label>
                      <select
                        id={`${q.id}-field`}
                        name="field"
                        defaultValue={q.history[0]?.field ?? ""}
                      >
                        <option value="">Ambiguous, keep human review</option>
                        {fieldSchema.options.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabels[f]}
                          </option>
                        ))}
                      </select>
                      <label className="mt-3" htmlFor={`${q.id}-reason`}>
                        Correction basis
                      </label>
                      <input id={`${q.id}-reason`} name="reason" required maxLength={2000} />
                      <label className="mt-3" htmlFor={`${q.id}-next`}>
                        Next human action
                      </label>
                      <input id={`${q.id}-next`} name="nextAction" required maxLength={500} />
                      <button className="quiet-button mt-3">Save routing correction</button>
                    </fieldset>
                  </form>
                </details>
              )}
              <details className="mt-3 text-xs">
                <summary>Preserved classification basis</summary>
                {q.history.map((h) => (
                  <p key={h.revision} className="mt-2">
                    Revision {h.revision} · {h.kind.replaceAll("_", " ")}
                    <br />
                    {h.basis}
                  </p>
                ))}
              </details>
            </article>
          ))}
        </div>
      </details>
      <details className="mt-5">
        <summary className="cursor-pointer font-semibold">Save an edited photo request</summary>
        <form
          className="mt-4"
          key={view.revision}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void save({
              kind: "draft",
              input: {
                kind: "photo_request",
                revision: view.revision,
                recipientLabel: form.get("recipientLabel"),
                body: form.get("body"),
              },
            });
          }}
        >
          <fieldset disabled={pending}>
            <label htmlFor="photo-recipient">Proposed recipient, not a verified contact</label>
            <input
              id="photo-recipient"
              name="recipientLabel"
              defaultValue={photoRequest.recipientLabel}
              required
              maxLength={200}
            />
            <label className="mt-3" htmlFor="photo-draft">
              Unsent request for specialist review
            </label>
            <textarea
              id="photo-draft"
              name="body"
              rows={5}
              defaultValue={photoRequest.body}
              required
              maxLength={10000}
            />
            <button className="quiet-button mt-3">Save unsent photo request</button>
          </fieldset>
        </form>
      </details>
      {view.drafts.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="font-semibold">Drafts retained for human review</h3>
          {view.drafts.map((d, i) => (
            <AssistanceCard card={d} key={i} />
          ))}
        </div>
      )}
    </section>
  );
}
