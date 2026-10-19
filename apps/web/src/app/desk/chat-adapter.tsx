"use client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  sourcingStreamView,
  streamView,
  type SourcingStreamView,
  type StreamView,
} from "@signal-desk/contracts/assistance-schema";
import SaleChat from "@signal-desk/catalog/sale-chat";
import { postPrototypeCommand } from "@/app/prototype-command";

type Turn = StreamView | SourcingStreamView;
// Each subject has its own stream endpoint and card contract.
const subjects = {
  opportunity: { base: "/api/v1/desk/opportunities", schema: streamView.array() },
  sourcing: { base: "/api/v1/desk/sourcing", schema: sourcingStreamView.array() },
};

async function savedStreams(
  endpoint: string,
  schema: (typeof subjects)[keyof typeof subjects]["schema"],
) {
  const response = await fetch(`${endpoint}?view=snapshot`);
  if (!response.ok)
    throw new Error("Could not reload saved progress. Reconnect before submitting again.");
  const result = await response.json();
  return schema.parse(result.data) as Turn[];
}

const countFinished = (turns: Turn[]) =>
  turns.filter((turn) => turn.state === "completed" || turn.state === "interrupted").length;

/** Connects the shared popup to one subject's authorized saved streams and commands. */
export default function ChatAdapter({
  subject = "opportunity",
  subjectId,
  context,
  initialStreams,
  copy,
  renderSourcingCard,
  onSettled,
}: {
  subject?: keyof typeof subjects;
  subjectId: string;
  context: string;
  initialStreams: Turn[];
  /** Called when a saved turn finishes, so the page can reload records the assistant changed. */
  onSettled?: () => void;
} & Pick<ComponentProps<typeof SaleChat>, "copy" | "renderSourcingCard">) {
  const { base: root, schema } = subjects[subject];
  const base = `${root}/${encodeURIComponent(subjectId)}`;
  const endpoint = `${base}/stream`;
  const assistanceEndpoint = `${base}/assistance`;
  const [streams, setStreams] = useState(initialStreams);
  const [connection, setConnection] = useState("Connecting to saved conversation…");
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const retry = useRef({ body: "", key: "" });
  const settled = useRef(onSettled);
  const finished = useRef(countFinished(initialStreams));
  useEffect(() => {
    settled.current = onSettled;
  });
  useEffect(() => {
    const count = countFinished(streams);
    if (count > finished.current) settled.current?.();
    finished.current = count;
  }, [streams]);
  useEffect(() => {
    const observer = new EventSource(endpoint);
    let disposed = false;
    function deny() {
      if (disposed) return;
      setDenied(true);
      setStreams([]);
      observer.close();
    }
    observer.onmessage = (event) => {
      try {
        setStreams(schema.parse(JSON.parse(event.data)));
        setConnection("Connected · History saved");
      } catch {
        setConnection("Could not read saved progress. Reconnecting…");
      }
    };
    observer.onerror = async () => {
      setConnection("Connection interrupted. Reconnecting to saved history…");
      const response = await fetch(`${endpoint}?view=snapshot`).catch(() => null);
      if (response && [401, 403, 404].includes(response.status)) deny();
    };
    observer.addEventListener("denied", deny);
    return () => {
      disposed = true;
      observer.close();
    };
  }, [endpoint, schema]);
  async function command(
    target: string,
    body:
      | { kind: "chat"; message: string }
      | { kind: "cancel"; turnId: string }
      | { kind: "accept_suggestion"; inquiryId: string; revision: number },
  ) {
    if (pending) return;
    const serialized = JSON.stringify(body);
    if (retry.current.body !== serialized)
      retry.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setConnection("Connected · History saved");
    try {
      await postPrototypeCommand(target, serialized, retry.current.key);
      retry.current = { body: "", key: "" };
      await savedStreams(endpoint, schema).then(setStreams, () =>
        setConnection("Message accepted. Reconnecting to saved progress…"),
      );
    } catch (failure) {
      setConnection(String(failure));
      throw failure;
    } finally {
      setPending(false);
    }
  }
  return (
    <SaleChat
      copy={copy}
      renderSourcingCard={renderSourcingCard}
      context={context}
      streams={streams}
      pending={pending}
      connection={connection}
      denied={denied}
      onSubmit={(message) => command(endpoint, { kind: "chat", message })}
      onStop={(turnId) => {
        void command(endpoint, { kind: "cancel", turnId }).catch(() => {});
      }}
      onAcceptSuggestion={(inquiryId, revision) => {
        // Routing acceptance is an assistance command; chat and cancel belong to the stream.
        void command(assistanceEndpoint, { kind: "accept_suggestion", inquiryId, revision }).catch(
          () => {},
        );
      }}
    />
  );
}
