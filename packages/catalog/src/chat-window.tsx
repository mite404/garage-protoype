import type { Ref } from "react";
import { Button } from "@signal-desk/ui/components/ui/button";

const paths = {
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  mail: "m3 5 9 7 9-7M3 5h18v14H3Z",
  minus: "M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "m9 5 7 7-7 7",
  send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
  edit: "M12 4H4v16h16v-8M16 3l5 5-10 10H6v-5L16 3Z",
  document:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6",
};

/** Small line icons shared by the chat and draft windows; no decorative icon tile. */
export function ChatIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Non-modal window controls. Closing preserves the working content, like minimizing. */
export function ChatWindowHeader({
  title,
  subtitle,
  icon,
  onMinimize,
}: {
  title: string;
  subtitle: string;
  icon: "chat" | "mail";
  onMinimize: () => void;
}) {
  return (
    <header className="chat-window-header">
      <ChatIcon name={icon} />
      <div className="chat-window-title">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Minimize ${title.toLowerCase()}`}
        onClick={onMinimize}
      >
        <ChatIcon name="minus" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onMinimize}
      >
        <ChatIcon name="close" />
      </Button>
    </header>
  );
}

/** Restores a window without clearing its messages or unsaved edits. */
export function ChatLauncher({
  title,
  icon,
  onClick,
  buttonRef,
}: {
  title: string;
  icon: "chat" | "mail";
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={buttonRef}
      variant="outline"
      className="chat-launcher"
      aria-label={`Open ${title.toLowerCase()}`}
      onClick={onClick}
    >
      <ChatIcon name={icon} />
      <span>{title}</span>
    </Button>
  );
}
