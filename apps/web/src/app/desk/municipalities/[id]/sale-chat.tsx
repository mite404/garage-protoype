"use client";
import { useEffect, useRef, useState } from "react";
import { streamView, type StreamView } from "@signal-desk/contracts/assistance-schema";
import SaleChat from "@signal-desk/catalog/sale-chat";
import { postPrototypeCommand } from "@/app/prototype-command";

async function savedStreams(endpoint: string) {
  const response = await fetch(`${endpoint}?view=snapshot`);
  if (!response.ok)
    throw new Error("Could not reload saved progress. Reconnect before submitting again.");
  const result = await response.json();
  return streamView.array().parse(result.data);
}

/** Connects the shared popup to authorized saved streams and commands. */
export default function SaleChatAdapter({
  opportunityId,
  context,
  initialStreams,
}: {
  opportunityId: string;
  context: string;
  initialStreams: StreamView[];
}) {
  const endpoint = `/api/v1/desk/opportunities/${encodeURIComponent(opportunityId)}/stream`;
  const [streams, setStreams] = useState(initialStreams);
  const [connection, setConnection] = useState("Connecting to saved conversation…");
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const retry = useRef({ body: "", key: "" });
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
        setStreams(streamView.array().parse(JSON.parse(event.data)));
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
  }, [endpoint]);
  async function command(
    body: { kind: "chat"; message: string } | { kind: "cancel"; turnId: string },
  ) {
    if (pending) return;
    const serialized = JSON.stringify(body);
    if (retry.current.body !== serialized)
      retry.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setConnection("Connected · History saved");
    try {
      await postPrototypeCommand(endpoint, serialized, retry.current.key);
      retry.current = { body: "", key: "" };
      await savedStreams(endpoint).then(setStreams, () =>
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
      context={context}
      streams={streams}
      pending={pending}
      connection={connection}
      denied={denied}
      onSubmit={(message) => command({ kind: "chat", message })}
      onStop={(turnId) => {
        void command({ kind: "cancel", turnId }).catch(() => {});
      }}
    />
  );
}
