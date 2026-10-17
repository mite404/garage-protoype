"use client";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { StreamView } from "@signal-desk/contracts/assistance-schema";
import AssistanceCard from "./assistance-cards";
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
    <p className="mt-2 text-xs text-red-800">
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
  history: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <div
      ref={history}
      aria-label="Conversation history"
      className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5"
      onScroll={onScroll}
    >
      {!streams.length && (
        <p className="rounded-lg bg-stone-50 p-4 text-sm text-stone-600">
          What is blocking this acquisition? Ask about its conditions or the evidence still needed.
        </p>
      )}
      {streams.map((turn) => (
        <article key={turn.id} className="space-y-3">
          <div className="flex flex-col items-end gap-1">
            <p className="pr-1 text-xs font-medium text-stone-600">You</p>
            <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-orange-100 px-3 py-2.5">
              <p className="whitespace-pre-wrap text-sm break-words">{turn.message}</p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-1">
            <p className="pl-1 text-xs font-medium text-stone-600">Sale assistant</p>
            <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-stone-100 px-3 py-2.5">
              <Prose text={turn.text} />
              <div className="space-y-3">
                {turn.cards.map((card, index) => (
                  <AssistanceCard key={index} card={card} />
                ))}
              </div>
            </div>
            <p className="pl-1 text-xs text-stone-500">{labels[turn.state]}</p>
            {["queued", "running", "cancelling"].includes(turn.state) && (
              <output className="pl-1 text-xs text-stone-500">
                <span aria-hidden="true" className="mr-2 inline-flex gap-1 align-middle">
                  <span className="size-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse" />
                  <span className="size-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse [animation-delay:300ms]" />
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
    </div>
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
    <form onSubmit={onSubmit} className="shrink-0 bg-white px-4 pt-3 pb-4">
      <label className="sr-only" htmlFor="sale-message">
        Message sale assistant
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-stone-300 px-2 py-1 focus-within:border-orange-600">
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
          className="min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none outline-none focus:ring-0"
        />
        <button
          type="submit"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-700 text-white transition-colors hover:bg-orange-800 disabled:opacity-50"
          disabled={pending || active || !input.trim()}
          aria-label="Send to sale assistant"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
            <path
              d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <p className="mt-2 px-1 text-xs text-stone-500">Drafts only. Nothing is sent externally.</p>
      <output className="mt-1 block text-xs text-stone-500" aria-live="polite">
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
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const active = streams.some((turn) => ["queued", "running", "cancelling"].includes(turn.state));
  useEffect(() => {
    if (open) composer.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open && follow.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [streams, open]);
  function minimize() {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
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
        className="fixed right-5 bottom-5 z-40 inline-flex min-h-11 items-center gap-2.5 rounded-xl bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_5px_14px_rgba(47,36,30,0.23)] transition-colors hover:bg-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
        hidden={open}
        aria-expanded={open}
        aria-controls="sale-chat"
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
          <path
            d="M20 11.5a8 8 0 0 1-8 8 8.7 8.7 0 0 1-3.1-.6L4 20l1.2-4.7A8 8 0 1 1 20 11.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M8.5 11.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
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
        className="fixed top-auto right-3 bottom-3 left-auto z-50 m-0 flex h-[min(540px,calc(100dvh-24px))] w-[calc(100vw-24px)] max-w-[390px] flex-col overflow-hidden rounded-xl border border-stone-600 bg-white p-0 text-inherit shadow-[0_8px_22px_rgba(30,30,30,0.16)] sm:right-6 sm:bottom-6"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-3 py-3 sm:gap-3 sm:px-4">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-700 text-white sm:size-10"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-6">
              <path
                d="M20 11.5a8 8 0 0 1-8 8 8.7 8.7 0 0 1-3.1-.6L4 20l1.2-4.7A8 8 0 1 1 20 11.5Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight sm:text-base">Sale assistant</p>
            <p className="mt-1 truncate text-xs text-stone-600">{context}</p>
          </div>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-orange-700 sm:size-9"
            aria-label="Minimize sale assistant"
            onClick={minimize}
          >
            −
          </button>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-orange-700 sm:size-9"
            aria-label="Dismiss sale assistant"
            onClick={minimize}
          >
            ×
          </button>
        </header>
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
