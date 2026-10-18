"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { getAssistance } from "@/server/assistance";
import type { Workbench } from "@/server/evidence";
import { fieldSchema, fieldLabels } from "@signal-desk/contracts/evidence-schema";
import AssistanceCard from "@signal-desk/catalog/assistance-card";
import { ConversationTurn, Prose } from "@signal-desk/catalog/prose";
import {
  isActiveTurn,
  progressLabel,
  sendingMessage,
  TurnProgress,
  type SentTurn,
} from "@signal-desk/catalog/turn-progress";
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

// The saved turns after an accepted command, or undefined when they cannot be reloaded yet.
async function savedStreams(endpoint: string) {
  try {
    const response = await fetch(`${endpoint}?view=snapshot`);
    if (!response.ok) return undefined;
    return streamView.array().parse((await response.json()).data);
  } catch {
    return undefined;
  }
}

function StreamStatus({ turn }: { turn: StreamView }) {
  if (isActiveTurn(turn)) return <TurnProgress label={progressLabel(turn)} />;
  return <span className="state state-unknown">{streamLabels[turn.state]}</span>;
}

function StreamError({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <p className="text-sm text-destructive">
      {code === "SPEND_UNCERTAIN"
        ? "Provider outcome uncertain. Budget remains reserved; no automatic paid retry."
        : "Generation stopped. Review current evidence before starting a new turn."}
    </p>
  );
}

function StopGeneration({
  turn,
  pending,
  onCancel,
}: {
  turn: StreamView;
  pending: boolean;
  onCancel: (turnId: string) => void;
}) {
  if (turn.state !== "queued" && turn.state !== "running") return null;
  return (
    <button className="quiet-button" disabled={pending} onClick={() => onCancel(turn.id)}>
      Stop generation
    </button>
  );
}

function StreamTurns({
  streams,
  sending,
  pending,
  onAcceptSuggestion,
  onCancel,
}: {
  streams: StreamView[];
  sending: string | undefined;
  pending: boolean;
  onAcceptSuggestion: (inquiryId: string, routingRevision: number) => void;
  onCancel: (turnId: string) => void;
}) {
  return (
    <>
      {streams.map((turn) => (
        <ConversationTurn key={turn.id} request={turn.message}>
          <Prose text={turn.text} />
          <div className="mt-4 space-y-4">
            {turn.cards.map((card, i) => (
              <AssistanceCard card={card} key={i} onAcceptSuggestion={onAcceptSuggestion} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StreamStatus turn={turn} />
            <StopGeneration turn={turn} pending={pending} onCancel={onCancel} />
            <StreamError code={turn.errorCode} />
          </div>
        </ConversationTurn>
      ))}
      {sending && (
        <ConversationTurn request={sending}>
          <TurnProgress label="Sending" />
        </ConversationTurn>
      )}
    </>
  );
}

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
  // The submitted question and the turns saved before it, until its own saved turn arrives.
  const streamEndpoint = `/api/v1/desk/opportunities/${encodeURIComponent(view.opportunityId)}/stream`;
  const [sent, setSent] = useState<SentTurn>();
  const sending = sendingMessage(sent, streams);
  useEffect(() => {
    const observer = new EventSource(streamEndpoint);
    observer.onmessage = (event) => {
      const parsed = streamView.array().safeParse(JSON.parse(event.data));
      if (parsed.success) {
        setStreams(parsed.data);
        setConnection("Connected · Progress saved automatically");
      }
    };
    observer.onerror = async () => {
      setConnection("Connection interrupted. Reconnecting to saved progress…");
      const check = await fetch(`${streamEndpoint}?view=snapshot`).catch(() => null);
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
  }, [streamEndpoint]);
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
      return true;
    } catch (error) {
      setMessage(String(error));
      return false;
    } finally {
      setPending(false);
    }
  }
  function accept(inquiryId: string, revision: number) {
    void save({ kind: "accept_suggestion", inquiryId, revision });
  }
  function chat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("message") as HTMLTextAreaElement;
    const question = field.value;
    // Acknowledge in the same frame as Send; the saved turn replaces this row when it arrives.
    setSent({ message: question, known: streams.map((turn) => turn.id) });
    field.value = "";
    void save({ kind: "chat", message: question }, "stream").then(async (saved) => {
      // Show the accepted turn now rather than after the observer's next poll.
      const reloaded = saved ? await savedStreams(streamEndpoint) : undefined;
      if (reloaded) setStreams(reloaded);
      if (saved) return;
      setSent(undefined);
      field.value = question;
    });
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
      <section className="my-5 space-y-5" aria-label="Conversation history">
        {!view.turns.length && !streams.length && !sending && (
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
                <AssistanceCard card={card} key={i} onAcceptSuggestion={accept} />
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
        <StreamTurns
          streams={streams}
          sending={sending}
          pending={pending}
          onAcceptSuggestion={accept}
          onCancel={(turnId) => void save({ kind: "cancel", turnId }, "stream")}
        />
      </section>
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
              <AssistanceCard card={q.card} onAcceptSuggestion={accept} />
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
