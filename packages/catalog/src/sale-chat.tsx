"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  SourcingCardRef,
  SourcingStreamView,
  StreamView,
} from "@signal-desk/contracts/assistance-schema";
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

// Deal and sourcing turns share one presentation; only their reference cards differ.
type Turn = StreamView | SourcingStreamView;
type Copy = { title: string; empty: string; placeholder: string };
const saleCopy: Copy = {
  title: "Sale assistant",
  empty:
    "What is blocking this acquisition? Ask about its conditions or the evidence still needed.",
  placeholder: "Ask about this sale…",
};
const ChatCopy = createContext(saleCopy);
// Renders sourcing references from the page's current records; deal cards render themselves.
const SourcingCard = createContext<(card: SourcingCardRef) => ReactNode>(() => null);

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
  const copy = useContext(ChatCopy);
  return (
    <article className="space-y-3" aria-busy="true">
      <UserMessage text={message} />
      <div className="chat-message">
        <p className="chat-message-label">{copy.title}</p>
        <div className="chat-bubble">
          <TurnProgress label="Sending" />
        </div>
      </div>
    </article>
  );
}

function ActiveProgress({ turn }: { turn: Turn }) {
  if (!isActiveTurn(turn)) return null;
  // Space the status from streamed text or cards above it, not from an empty bubble's edge.
  const below = turn.text !== "" || turn.cards.length > 0;
  return <TurnProgress label={progressLabel(turn)} spaced={below} />;
}

function TurnState({ turn }: { turn: Turn }) {
  if (isActiveTurn(turn)) return null;
  return <p className="mt-1 pl-1 text-xs text-muted-foreground">{labels[turn.state]}</p>;
}

function StopButton({
  turn,
  pending,
  onStop,
}: {
  turn: Turn;
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
  onAcceptSuggestion,
}: {
  turn: Turn;
  pending: boolean;
  onStop: (id: string) => void;
  onAcceptSuggestion: (inquiryId: string, routingRevision: number) => void;
}) {
  const copy = useContext(ChatCopy);
  const renderSourcing = useContext(SourcingCard);
  return (
    <article className="space-y-3" aria-busy={isActiveTurn(turn)}>
      <UserMessage text={turn.message} />
      <div className="chat-message">
        <p className="chat-message-label">{copy.title}</p>
        <div className="chat-bubble">
          <Prose text={turn.text} />
          <div className="space-y-3">
            {turn.cards.map((card, index) =>
              card.kind === "sourcing" ? (
                <div key={index}>{renderSourcing(card)}</div>
              ) : (
                <AssistanceCard
                  key={index}
                  card={card}
                  onAcceptSuggestion={pending ? undefined : onAcceptSuggestion}
                />
              ),
            )}
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
  onAcceptSuggestion,
  history,
  onScroll,
}: {
  streams: Turn[];
  sending: string | undefined;
  pending: boolean;
  onStop: (id: string) => void;
  onAcceptSuggestion: (inquiryId: string, routingRevision: number) => void;
  history: RefObject<HTMLElement | null>;
  onScroll: () => void;
}) {
  const copy = useContext(ChatCopy);
  return (
    <section
      ref={history}
      aria-label="Conversation history"
      className="chat-transcript space-y-5"
      onScroll={onScroll}
    >
      {!streams.length && !sending && (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{copy.empty}</p>
      )}
      {streams.map((turn) => (
        <SavedTurn
          key={turn.id}
          turn={turn}
          pending={pending}
          onStop={onStop}
          onAcceptSuggestion={onAcceptSuggestion}
        />
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
  const copy = useContext(ChatCopy);
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
          placeholder={copy.placeholder}
          className="bg-transparent text-foreground"
        />
        <div className="chat-composer-toolbar">
          <span>Drafts only</span>
          <button
            type="submit"
            className="chat-send"
            disabled={pending || active || !input.trim()}
            aria-label={`Send to ${copy.title.toLowerCase()}`}
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

// Keep following new output only while the reader stays near the bottom of the history.
function followNearBottom(history: RefObject<HTMLElement | null>, follow: { current: boolean }) {
  const node = history.current;
  if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
}

function ChatPanel({
  denied,
  historyProps,
  composerProps,
}: {
  denied: boolean;
  historyProps: Parameters<typeof ChatHistory>[0];
  composerProps: Parameters<typeof ChatComposer>[0];
}) {
  if (denied)
    return (
      <p role="alert" className="p-5">
        Conversation access ended. Reload to sign in again.
      </p>
    );
  return (
    <>
      <ChatHistory {...historyProps} />
      <ChatComposer {...composerProps} />
    </>
  );
}

// Composer draft and the optimistic sent row, until the saved turn for it arrives.
function useComposer(
  streams: Turn[],
  pending: boolean,
  onSend: () => void,
  onSubmit: (message: string) => Promise<void>,
) {
  const [input, setInput] = useState("");
  // The submitted message and the turns saved before it, until its own saved turn arrives.
  const [sent, setSent] = useState<SentTurn>();
  const sending = sendingMessage(sent, streams);
  const active = Boolean(sending) || streams.some(isActiveTurn);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || active || pending) return;
    // Acknowledge in the same frame as Send; the saved turn replaces this row when it arrives.
    setSent({ message, known: streams.map((turn) => turn.id) });
    setInput("");
    onSend();
    await onSubmit(message).catch(() => {
      // The adapter reports the failure through connection; restore the draft for retry.
      setSent(undefined);
      setInput(message);
    });
  }
  return { input, setInput, sending, active, submit };
}

function ChatWindow({
  context,
  streams,
  pending,
  connection,
  denied,
  onSubmit,
  onStop,
  onAcceptSuggestion,
  copy,
}: Omit<ChatProps, "copy" | "renderSourcingCard"> & { copy: Copy }) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const { input, setInput, sending, active, submit } = useComposer(
    streams,
    pending,
    () => {
      follow.current = true;
    },
    onSubmit,
  );
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
        {copy.title} {active && <span className="text-xs">· Working</span>}
      </button>
      <dialog
        id="sale-chat"
        open={open}
        aria-modal="false"
        aria-label={copy.title}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") minimize();
        }}
        className="chat-window sale-chat"
      >
        <ChatWindowHeader title={copy.title} subtitle={context} icon="chat" onMinimize={minimize} />
        <ChatPanel
          denied={denied}
          historyProps={{
            streams,
            sending,
            pending,
            onAcceptSuggestion,
            history,
            onScroll: () => followNearBottom(history, follow),
            onStop,
          }}
          composerProps={{
            input,
            pending,
            active,
            composer,
            onChange: setInput,
            onSubmit: submit,
            status: connection,
          }}
        />
      </dialog>
    </>
  );
}

type ChatProps = {
  context: string;
  streams: Turn[];
  pending: boolean;
  connection: string;
  denied: boolean;
  onSubmit: (message: string) => Promise<void>;
  onStop: (turnId: string) => void;
  /** Records the specialist's acceptance of a Jev field suggestion; never generated by the model. */
  onAcceptSuggestion: (inquiryId: string, routingRevision: number) => void;
  /** Assistant name and prompts; defaults to the sale assistant. */
  copy?: Copy;
  /** Renders a sourcing reference card from the page's current saved records. */
  renderSourcingCard?: (card: SourcingCardRef) => ReactNode;
};

/** Minimizable conversation presentation; commands and saved progress belong to the caller. */
export default function SaleChat({
  copy = saleCopy,
  renderSourcingCard = () => null,
  ...props
}: ChatProps) {
  return (
    <ChatCopy value={copy}>
      <SourcingCard value={renderSourcingCard}>
        <ChatWindow {...props} copy={copy} />
      </SourcingCard>
    </ChatCopy>
  );
}
