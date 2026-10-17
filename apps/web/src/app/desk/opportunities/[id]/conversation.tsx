"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { getAssistance } from "@/server/assistance";
import type { Workbench } from "@/server/evidence";
import { fieldSchema, fieldLabels } from "@signal-desk/contracts/evidence-schema";
import AssistanceCard from "@signal-desk/catalog/assistance-card";
import { ConversationTurn, Prose } from "@signal-desk/catalog/prose";
import { postPrototypeCommand } from "@/app/prototype-command";
import { streamView, type StreamView } from "@signal-desk/contracts/assistance-schema";

type View = Awaited<ReturnType<typeof getAssistance>>;

const streamLabels = {
  queued: "Queued for generation",
  running: "Streaming · Review required",
  cancelling: "Stopping…",
  completed: "Assistant draft · Review required",
  interrupted: "Incomplete · interrupted",
  cancelled: "Incomplete · cancelled",
} satisfies Record<StreamView["state"], string>;

/** Specialist conversation and human handoff controls call the shared authorized operations only. */
export default function Conversation({
  view,
  photoRequest,
  initialStreams,
}: {
  view: View;
  photoRequest: Workbench["photoRequest"];
  initialStreams: StreamView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [streams, setStreams] = useState(initialStreams);
  const [connection, setConnection] = useState("Connecting to saved progress…");
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const observer = new EventSource(
      `/api/v1/desk/opportunities/${encodeURIComponent(view.opportunityId)}/stream`,
    );
    observer.onmessage = (event) => {
      const parsed = streamView.array().safeParse(JSON.parse(event.data));
      if (parsed.success) {
        setStreams(parsed.data);
        setConnection("Connected · Progress saved automatically");
      }
    };
    observer.onerror = async () => {
      setConnection("Connection interrupted. Reconnecting to saved progress…");
      const check = await fetch(
        `/api/v1/desk/opportunities/${encodeURIComponent(view.opportunityId)}/stream?view=snapshot`,
      ).catch(() => null);
      if (check && [401, 403, 404].includes(check.status)) {
        setDenied(true);
        setStreams([]);
        observer.close();
      }
    };
    observer.addEventListener("denied", () => {
      setDenied(true);
      setStreams([]);
      observer.close();
    });
    return () => observer.close();
  }, [view.opportunityId]);
  const retry = useRef({ body: "", key: "" });
  async function save(body: unknown, endpoint: "assistance" | "stream" = "assistance") {
    if (pending) return;
    const serialized = JSON.stringify(body);
    if (retry.current.body !== serialized)
      retry.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setMessage("");
    try {
      await postPrototypeCommand(
        `/api/v1/desk/opportunities/${encodeURIComponent(view.opportunityId)}/${endpoint}`,
        serialized,
        retry.current.key,
      );
      retry.current = { body: "", key: "" };
      setMessage(
        "Saved inside this prototype. You can return without resubmitting. Nothing was sent.",
      );
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
    void save({ kind: "chat", message: form.get("message") }, "stream");
  }
  if (denied)
    return (
      <section className="panel my-7" role="alert">
        Conversation access ended. No further private content is shown. Reload to sign in again.
      </section>
    );
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
            "Ask about the blocker to this sale. **Live assistant drafts require human review.** Cards use current evidence; missing facts remain unknown. No messages, payments or commitments leave this prototype."
          }
        />
      </div>
      <output className="mt-3 block text-xs text-muted-foreground">{connection}</output>
      <div className="my-5 space-y-5" aria-label="Conversation history">
        {!view.turns.length && !streams.length && (
          <p className="rounded-md bg-muted p-5 text-sm text-muted-foreground">
            Start with the question blocking this sale. Answers use only reviewed, shareable
            evidence.
          </p>
        )}
        {view.turns
          .filter((turn) => !streams.some((stream) => stream.id === turn.id))
          .map((turn) => (
            <ConversationTurn key={turn.id} request={turn.message}>
              {turn.cards.map((card, i) => (
                <AssistanceCard card={card} key={i} />
              ))}
              {!turn.cards.length && (
                <p className="text-sm text-muted-foreground">
                  No current card is available. Evidence may have changed. Retry the question as a
                  new turn or review its task below.
                </p>
              )}
              {turn.statuses.some((s) => s === "malformed" || s === "retired") && (
                <output className="mt-2 block text-sm text-destructive">
                  A malformed card was rejected. A tool retires after two malformed calls for this
                  turn only.
                </output>
              )}
            </ConversationTurn>
          ))}
        {streams.map((turn) => (
          <ConversationTurn key={turn.id} request={turn.message}>
            {turn.text && <Prose text={turn.text} />}
            <div className="mt-4 space-y-4">
              {turn.cards.map((card, i) => (
                <AssistanceCard card={card} key={i} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="state state-unknown">{streamLabels[turn.state]}</span>
              {(turn.state === "queued" || turn.state === "running") && (
                <button
                  className="quiet-button"
                  disabled={pending}
                  onClick={() => void save({ kind: "cancel", turnId: turn.id }, "stream")}
                >
                  Stop generation
                </button>
              )}
              {turn.errorCode && (
                <p className="text-sm text-destructive">
                  {turn.errorCode === "SPEND_UNCERTAIN"
                    ? "Provider outcome uncertain. Budget remains reserved; no automatic paid retry."
                    : "Generation stopped. Review current evidence before starting a new turn."}
                </p>
              )}
            </div>
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
      <output className="mt-3 block text-sm text-muted-foreground" aria-live="polite">
        {message}
      </output>
      <details className="mt-6 border-t border-border pt-5">
        <summary className="cursor-pointer font-semibold">
          Buyer inquiries and human next actions ({view.inquiries.length})
        </summary>
        <div className="mt-5 space-y-6">
          {view.inquiries.map((q) => (
            <article key={q.id} className="border-b border-border pb-5">
              <p className="mb-3 whitespace-pre-wrap text-sm">
                <strong>Original inquiry</strong>
                <br />
                {q.input.text}
              </p>
              <AssistanceCard card={q.card} />
              <p className="mt-2 text-xs text-muted-foreground">
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
