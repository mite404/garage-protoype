"use client";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { StreamView } from "@signal-desk/contracts/assistance-schema";
import AssistanceCard from "./assistance-cards";
import { ChatIcon, ChatWindowHeader } from "./chat-window";
import { Prose } from "./prose";
import {
  isActiveTurn,
  progressLabel,
  sendingMessage,
  TurnProgress,
  type SentTurn,
} from "./turn-progress";

const labels = {
  queued: "Waiting for the assistant…",
  running: "Writing a draft…",
  cancelling: "Stopping…",
  completed: "Draft · Human review required",
  interrupted: "Incomplete · Generation interrupted",
  cancelled: "Incomplete · Stopped",
} satisfies Record<StreamView["state"], string>;

function GenerationError({ code }: { code: string }) {
  return (
    <p className="mt-2 text-xs text-destructive">
      {code === "SPEND_UNCERTAIN"
        ? "Provider outcome uncertain. Budget remains reserved. No automatic paid retry."
        : "Generation stopped. Review the evidence before asking again."}
    </p>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="chat-message chat-message-user">
      <p className="chat-message-label">You</p>
      <div className="chat-bubble">
        <p className="whitespace-pre-wrap text-sm break-words">{text}</p>
      </div>
    </div>
  );
}

// Shown from the frame Send is pressed until the saved turn arrives to replace it.
function SendingTurn({ message }: { message: string }) {
  return (
    <article className="space-y-3" aria-busy="true">
      <UserMessage text={message} />
      <div className="chat-message">
        <p className="chat-message-label">Sale assistant</p>
        <div className="chat-bubble">
          <TurnProgress label="Sending" />
        </div>
      </div>
    </article>
  );
}

function ActiveProgress({ turn }: { turn: StreamView }) {
  if (!isActiveTurn(turn)) return null;
  // Space the status from streamed text or cards above it, not from an empty bubble's edge.
  const below = turn.text !== "" || turn.cards.length > 0;
  return <TurnProgress label={progressLabel(turn)} spaced={below} />;
}

function TurnState({ turn }: { turn: StreamView }) {
  if (isActiveTurn(turn)) return null;
  return <p className="mt-1 pl-1 text-xs text-muted-foreground">{labels[turn.state]}</p>;
}

function StopButton({
  turn,
  pending,
  onStop,
}: {
  turn: StreamView;
  pending: boolean;
  onStop: (id: string) => void;
}) {
  if (!["queued", "running"].includes(turn.state)) return null;
  return (
    <button className="quiet-button mt-2" disabled={pending} onClick={() => onStop(turn.id)}>
      Stop generation
    </button>
  );
}

function SavedTurn({
  turn,
  pending,
  onStop,
}: {
  turn: StreamView;
  pending: boolean;
  onStop: (id: string) => void;
}) {
  return (
    <article className="space-y-3" aria-busy={isActiveTurn(turn)}>
      <UserMessage text={turn.message} />
      <div className="chat-message">
        <p className="chat-message-label">Sale assistant</p>
        <div className="chat-bubble">
          <Prose text={turn.text} />
          <div className="space-y-3">
            {turn.cards.map((card, index) => (
              <AssistanceCard key={index} card={card} />
            ))}
          </div>
          <ActiveProgress turn={turn} />
        </div>
        <TurnState turn={turn} />
        {turn.errorCode && <GenerationError code={turn.errorCode} />}
        <StopButton turn={turn} pending={pending} onStop={onStop} />
      </div>
    </article>
  );
}

function ChatHistory({
  streams,
  sending,
  pending,
  onStop,
  history,
  onScroll,
}: {
  streams: StreamView[];
  sending: string | undefined;
  pending: boolean;
  onStop: (id: string) => void;
  history: RefObject<HTMLElement | null>;
  onScroll: () => void;
}) {
  return (
    <section
      ref={history}
      aria-label="Conversation history"
      className="chat-transcript space-y-5"
      onScroll={onScroll}
    >
      {!streams.length && !sending && (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          What is blocking this acquisition? Ask about its conditions or the evidence still needed.
        </p>
      )}
      {streams.map((turn) => (
        <SavedTurn key={turn.id} turn={turn} pending={pending} onStop={onStop} />
      ))}
      {sending && <SendingTurn message={sending} />}
    </section>
  );
}

function ChatComposer({
  input,
  pending,
  active,
  composer,
  onChange,
  onSubmit,
  status,
}: {
  input: string;
  pending: boolean;
  active: boolean;
  composer: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  status: string;
}) {
  return (
    <form onSubmit={onSubmit} className="chat-compose-area">
      <label className="sr-only" htmlFor="sale-message">
        Message sale assistant
      </label>
      <div className="chat-composer">
        <textarea
          ref={composer}
          id="sale-message"
          rows={1}
          maxLength={2000}
          required
          disabled={pending}
          value={input}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask about this sale…"
          className="bg-transparent text-foreground"
        />
        <div className="chat-composer-toolbar">
          <span>Drafts only</span>
          <button
            type="submit"
            className="chat-send"
            disabled={pending || active || !input.trim()}
            aria-label="Send to sale assistant"
          >
            <ChatIcon name="send" />
          </button>
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        Drafts only. Nothing is sent externally.
      </p>
      <output className="mt-1 block text-xs text-muted-foreground" aria-live="polite">
        {status}
      </output>
    </form>
  );
}

/** Minimizable conversation presentation; commands and saved progress belong to the caller. */
export default function SaleChat({
  context,
  streams,
  pending,
  connection,
  denied,
  onSubmit,
  onStop,
}: {
  context: string;
  streams: StreamView[];
  pending: boolean;
  connection: string;
  denied: boolean;
  onSubmit: (message: string) => Promise<void>;
  onStop: (turnId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // The submitted message and the turns saved before it, until its own saved turn arrives.
  const [sent, setSent] = useState<SentTurn>();
  const launcher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const sending = sendingMessage(sent, streams);
  const active = Boolean(sending) || streams.some(isActiveTurn);
  useEffect(() => {
    if (!open) return;
    const button = launcher.current;
    composer.current?.focus();
    return () => button?.focus();
  }, [open]);
  useEffect(() => {
    if (open && follow.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [streams, sending, open]);
  function minimize() {
    setOpen(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || active || pending) return;
    // Acknowledge in the same frame as Send; the saved turn replaces this row when it arrives.
    setSent({ message, known: streams.map((turn) => turn.id) });
    setInput("");
    follow.current = true;
    await onSubmit(message).catch(() => {
      // The adapter reports the failure through connection; restore the draft for retry.
      setSent(undefined);
      setInput(message);
    });
  }
  return (
    <>
      <button
        ref={launcher}
        className="chat-launcher sale-chat-launcher"
        hidden={open}
        aria-expanded={open}
        aria-controls="sale-chat"
        onClick={() => setOpen(true)}
      >
        <ChatIcon name="chat" />
        Sale assistant {active && <span className="text-xs">· Working</span>}
      </button>
      <dialog
        id="sale-chat"
        open={open}
        aria-modal="false"
        aria-label="Sale assistant"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") minimize();
        }}
        className="chat-window sale-chat"
      >
        <ChatWindowHeader
          title="Sale assistant"
          subtitle={context}
          icon="chat"
          onMinimize={minimize}
        />
        {denied ? (
          <p role="alert" className="p-5">
            Conversation access ended. Reload to sign in again.
          </p>
        ) : (
          <>
            <ChatHistory
              streams={streams}
              sending={sending}
              pending={pending}
              history={history}
              onScroll={() => {
                const node = history.current;
                if (node)
                  follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              }}
              onStop={onStop}
            />
            <ChatComposer
              input={input}
              pending={pending}
              active={active}
              composer={composer}
              onChange={setInput}
              onSubmit={submit}
              status={connection}
            />
          </>
        )}
      </dialog>
    </>
  );
}
