import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Textarea } from "@signal-desk/ui/components/ui/textarea";
import { ChatIcon, ChatLauncher, ChatWindowHeader } from "./chat-window";
import { EmailDraftWindow, type EmailDraft } from "./email-draft-window";

type VehicleContext = {
  department: string;
  vehicle: string;
  imageUrl: string;
  proposal: string;
  condition: string;
  blocker: string;
};

type ChatWorkspaceProps = {
  context: VehicleContext;
  initialDraft: EmailDraft;
  initialChatState?: "open" | "minimized";
  initialEditorState?: "closed" | "open" | "minimized";
};

function PurchaseSummary({ context }: { context: VehicleContext }) {
  return (
    <details className="chat-card chat-summary" open>
      <summary>
        <ChatIcon name="document" />
        <strong>Purchase summary</strong>
        <ChatIcon name="arrow" />
      </summary>
      <dl>
        <div>
          <dt>Proposal</dt>
          <dd>{context.proposal}</dd>
        </div>
        <div>
          <dt>Condition</dt>
          <dd>{context.condition}</dd>
        </div>
        <div>
          <dt>Blocker</dt>
          <dd>{context.blocker}</dd>
        </div>
      </dl>
    </details>
  );
}

function DraftCard({ draft, onEdit }: { draft: EmailDraft; onEdit: () => void }) {
  return (
    <article className="chat-card chat-draft-card" aria-label="Seller request preview">
      <div className="chat-card-heading">
        <ChatIcon name="document" />
        <h3>Seller request</h3>
        <span className="chat-badge">Draft</span>
      </div>
      <p className="chat-recipient">
        <span>To</span>
        {draft.recipientLabel}
      </p>
      <p className="chat-draft-text">{draft.body}</p>
      <Button variant="ghost" className="chat-edit-draft" onClick={onEdit}>
        <ChatIcon name="edit" />
        Edit draft
      </Button>
    </article>
  );
}

function ChatComposer({
  inputRef,
  onMessage,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onMessage: (text: string) => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim()) return;
        onMessage(message);
        setMessage("");
        inputRef.current?.focus({ preventScroll: true });
      }}
    >
      <Textarea
        ref={inputRef}
        aria-label="Message sale assistant"
        placeholder="Ask about this purchase..."
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="chat-composer-toolbar">
        <span>Ctrl / ⌘ + Enter</span>
        <Button
          type="submit"
          size="icon"
          className="chat-send"
          aria-label="Send to sale assistant"
          disabled={!message.trim()}
        >
          <ChatIcon name="send" />
        </Button>
      </div>
    </form>
  );
}

function ChatTranscript({
  context,
  draft,
  onEdit,
  messages,
}: {
  context: VehicleContext;
  draft: EmailDraft;
  onEdit: () => void;
  messages: string[];
}) {
  const transcript = useRef<HTMLElement>(null);
  useEffect(() => {
    if (messages.length) transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages]);
  return (
    <section ref={transcript} className="chat-transcript" aria-label="Conversation">
      <div className="chat-message chat-message-user">
        <p className="chat-message-label">
          You <time>10:24 AM</time>
        </p>
        <p className="chat-bubble">What is blocking this purchase?</p>
      </div>
      <div className="chat-message chat-message-assistant">
        <p className="chat-message-label">
          Sale assistant <time>10:24 AM</time>
        </p>
        <p className="chat-bubble">
          The pump-test report is missing. Your proposed purchase remains contingent on its review.
        </p>
      </div>
      <PurchaseSummary context={context} />
      <DraftCard draft={draft} onEdit={onEdit} />
      {messages.map((text, index) => (
        <div className="chat-message chat-message-user" key={index}>
          <p className="chat-message-label">
            You <span>Preview</span>
          </p>
          <p className="chat-bubble">{text}</p>
        </div>
      ))}
      {messages.length > 0 && (
        <output className="chat-preview-notice">Preview message added. No model connected.</output>
      )}
    </section>
  );
}

/** Synthetic chat composition for reviewing popup interactions without server operations. */
export function ChatWorkspace({
  context,
  initialDraft,
  initialChatState = "open",
  initialEditorState = "closed",
}: ChatWorkspaceProps) {
  const [chatState, setChatState] = useState(initialChatState);
  const [editorState, setEditorState] = useState(initialEditorState);
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState<string[]>([]);
  const chatLauncher = useRef<HTMLButtonElement>(null);
  const emailLauncher = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatState === "minimized") chatLauncher.current?.focus({ preventScroll: true });
    else composer.current?.focus({ preventScroll: true });
  }, [chatState]);

  useEffect(() => {
    if (editorState === "open")
      root.current
        ?.querySelector<HTMLInputElement>(".email-draft-fields input")
        ?.focus({ preventScroll: true });
    if (editorState === "minimized") emailLauncher.current?.focus({ preventScroll: true });
  }, [editorState]);

  return (
    <div ref={root} className="chat-workspace" data-editor-open={editorState === "open"}>
      <div className="chat-stage-label">
        <span>Signal Desk</span>
        <p>Municipal sales · Synthetic workspace</p>
      </div>
      <div className="chat-window-dock">
        {editorState !== "closed" && (
          <EmailDraftWindow
            initialDraft={initialDraft}
            open={editorState === "open"}
            onMinimize={() => setEditorState("minimized")}
            onSave={setDraft}
          />
        )}
        <dialog
          open={chatState === "open"}
          hidden={chatState !== "open"}
          className="chat-window chat-panel"
          aria-label="Sale assistant"
          aria-modal="false"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setChatState("minimized");
            }
          }}
        >
          <ChatWindowHeader
            title="Sale assistant"
            subtitle={context.department}
            icon="chat"
            onMinimize={() => setChatState("minimized")}
          />
          <div className="chat-vehicle-context">
            <img
              src={context.imageUrl}
              alt="Synthetic pumper illustration"
              width="88"
              height="64"
            />
            <div>
              <h3>{context.vehicle}</h3>
              <p>{context.proposal} proposed</p>
            </div>
          </div>
          <ChatTranscript
            context={context}
            draft={draft}
            onEdit={() => setEditorState("open")}
            messages={messages}
          />
          <footer className="chat-compose-area">
            <Button
              variant="outline"
              className="chat-draft-action"
              onClick={() => setEditorState("open")}
            >
              <ChatIcon name="edit" />
              <span>Draft seller request</span>
              <span className="chat-accent-square">
                <ChatIcon name="arrow" />
              </span>
            </Button>
            <ChatComposer
              inputRef={composer}
              onMessage={(text) => setMessages([...messages, text])}
            />
            <p className="chat-disclaimer">Synthetic demo. Drafts only; nothing sent externally.</p>
          </footer>
        </dialog>
      </div>
      <div className="chat-launcher-dock">
        {editorState === "minimized" && (
          <ChatLauncher
            buttonRef={emailLauncher}
            title="Email draft"
            icon="mail"
            onClick={() => setEditorState("open")}
          />
        )}
        {chatState === "minimized" && (
          <ChatLauncher
            buttonRef={chatLauncher}
            title="Sale assistant"
            icon="chat"
            onClick={() => {
              setChatState("open");
              if (editorState === "open" && window.matchMedia("(max-width: 900px)").matches) {
                setEditorState("minimized");
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
