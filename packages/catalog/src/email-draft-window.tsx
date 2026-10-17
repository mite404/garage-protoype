import { useId, useRef, useState } from "react";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Input } from "@signal-desk/ui/components/ui/input";
import { Textarea } from "@signal-desk/ui/components/ui/textarea";
import type { InlineCard } from "@signal-desk/contracts/assistance-schema";
import { ChatIcon, ChatWindowHeader } from "./chat-window";

export type EmailDraft = Pick<Extract<InlineCard, { kind: "draft" }>, "recipientLabel" | "body"> & {
  subject: string;
};

/** In-memory draft editor. Hidden rather than unmounted so edits and native resize survive. */
export function EmailDraftWindow({
  initialDraft,
  open,
  onMinimize,
  onSave,
}: {
  initialDraft: EmailDraft;
  open: boolean;
  onMinimize: () => void;
  onSave: (draft: EmailDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [saved, setSaved] = useState(false);
  const [large, setLarge] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <dialog
      ref={panel}
      open={open}
      hidden={!open}
      className={`chat-window email-draft-window${large ? " email-draft-large" : ""}`}
      aria-label="Email draft"
      aria-modal="false"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onMinimize();
        }
      }}
    >
      <ChatWindowHeader
        title="Email draft"
        subtitle="Seller request · Not sent"
        icon="mail"
        onMinimize={onMinimize}
      />
      <form
        className="email-draft-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
          setSaved(true);
        }}
        onChange={() => setSaved(false)}
      >
        <div className="email-draft-fields">
          <label htmlFor={`${id}-recipient`}>
            <span>To (proposed)</span>
            <Input
              id={`${id}-recipient`}
              value={draft.recipientLabel}
              onChange={(event) => setDraft({ ...draft, recipientLabel: event.target.value })}
              required
            />
          </label>
          <label htmlFor={`${id}-subject`}>
            <span>Subject</span>
            <Input
              id={`${id}-subject`}
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              required
            />
          </label>
        </div>
        <label className="email-draft-body" htmlFor={`${id}-message`}>
          <span className="sr-only">Message</span>
          <Textarea
            id={`${id}-message`}
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            required
          />
        </label>
        <footer className="email-draft-footer">
          <div className="email-draft-actions">
            <Button
              type="button"
              variant="outline"
              aria-pressed={large}
              onClick={() => {
                setLarge(!large);
                const element = panel.current;
                if (!element) return;
                element.style.removeProperty("width");
                element.style.removeProperty("height");
              }}
            >
              Resize editor
            </Button>
            <Button type="submit" className="chat-save">
              <ChatIcon name="edit" />
              Save draft
            </Button>
          </div>
          <output>
            {saved
              ? "Saved in this preview. Not sent."
              : "Local preview only. Closing keeps your edits until reload."}
          </output>
        </footer>
      </form>
    </dialog>
  );
}
