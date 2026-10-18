"use client";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { StreamView } from "@signal-desk/contracts/assistance-schema";
import AssistanceCard from "./assistance-cards";
import { ChatIcon, ChatWindowHeader } from "./chat-window";
import { Prose } from "./prose";

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

function ChatHistory({
  streams,
  pending,
  onStop,
  history,
  onScroll,
}: {
  streams: StreamView[];
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
      {!streams.length && (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          What is blocking this acquisition? Ask about its conditions or the evidence still needed.
        </p>
      )}
      {streams.map((turn) => (
        <article key={turn.id} className="space-y-3">
          <div className="chat-message chat-message-user">
            <p className="chat-message-label">You</p>
            <div className="chat-bubble">
              <p className="whitespace-pre-wrap text-sm break-words">{turn.message}</p>
            </div>
          </div>
          <div className="chat-message">
            <p className="chat-message-label">Sale assistant</p>
            <div className="chat-bubble">
              <Prose text={turn.text} />
              <div className="space-y-3">
                {turn.cards.map((card, index) => (
                  <AssistanceCard key={index} card={card} />
                ))}
              </div>
            </div>
            <p className="mt-1 pl-1 text-xs text-muted-foreground">{labels[turn.state]}</p>
            {["queued", "running", "cancelling"].includes(turn.state) && (
              <output className="pl-1 text-xs text-muted-foreground">
                <span aria-hidden="true" className="mr-2 inline-flex gap-1 align-middle">
                  <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
                  <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse [animation-delay:300ms]" />
                </span>
                Sale assistant is working…
              </output>
            )}
            {turn.errorCode && <GenerationError code={turn.errorCode} />}
            {["queued", "running"].includes(turn.state) && (
              <button
                className="quiet-button mt-2"
                disabled={pending}
                onClick={() => onStop(turn.id)}
              >
                Stop generation
              </button>
            )}
          </div>
        </article>
      ))}
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
  const launcher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const active = streams.some((turn) => ["queued", "running", "cancelling"].includes(turn.state));
  useEffect(() => {
    if (!open) return;
    const button = launcher.current;
    composer.current?.focus();
    return () => button?.focus();
  }, [open]);
  useEffect(() => {
    if (open && follow.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [streams, open]);
  function minimize() {
    setOpen(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || active || pending) return;
    await onSubmit(input.trim()).then(
      () => {
        setInput("");
        follow.current = true;
      },
      // The adapter reports the failure through connection; preserve the draft for retry.
      () => {},
    );
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
