"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Fields = Record<string, FormDataEntryValue>;

function reviewInput(fields: Fields) {
  return {
    name: fields.name,
    fit: fields.fit,
    identity: fields.identity,
    signal: fields.signal
      ? {
          text: fields.signal,
          source: fields.source,
          quote: fields.quote,
          permission: fields.materialPermission,
        }
      : null,
    contact: fields.email
      ? {
          name: fields.contactName,
          email: fields.email,
          permission: fields.contactPermission,
          provenance: fields.contactProvenance,
        }
      : null,
  };
}

function mergeInput(fields: Fields, input: Record<string, unknown>) {
  return { ...input, ...fields };
}

function keyedInput(fields: Fields, input: Record<string, unknown>, key: string) {
  return { key, ...input, ...fields };
}

const commandInputs = {
  review: reviewInput,
  stop: (fields) => fields.reason ?? "reply",
  reconcile: (fields, input) => ({ ...input, ...fields, providerId: fields.providerId || null }),
  import: (fields) => JSON.parse(String(fields.snapshot)),
  enroll: (fields, input, key) => ({
    ...keyedInput(fields, input, key),
    experiment: fields.experiment === "true",
  }),
  experiment: mergeInput,
  outcome: keyedInput,
  link: mergeInput,
  route: mergeInput,
  qualify: mergeInput,
  invite: mergeInput,
  schedule: mergeInput,
} satisfies Record<
  string,
  (fields: Fields, input: Record<string, unknown>, key: string) => unknown
>;

function commandStatus(kind: string, data: unknown) {
  return kind === "experiment" && data === null
    ? "Assignment unavailable. Normal reviewed outreach remains available."
    : "Saved. No external delivery or paid provider was activated.";
}

async function postCommand(payload: unknown, kind: string) {
  const response = await fetch("/api/v1/desk/growth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Command was not accepted.");
  return commandStatus(kind, result.data);
}

/** Submits a reviewed command through the same-origin, currently authorized growth boundary. */
export function GrowthCommand({
  kind,
  accountId,
  input = {},
  children,
  label,
}: {
  kind: keyof typeof commandInputs;
  accountId?: string;
  input?: Record<string, unknown>;
  children?: ReactNode;
  label: string;
}) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setStatus("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const prepare = commandInputs[kind];
      const status = await postCommand(
        { kind, accountId, input: prepare(fields, input, key) },
        kind,
      );
      setKey(crypto.randomUUID());
      setStatus(status);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed. Review before retrying.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="growth-form">
      {children}
      <button className="quiet-button" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      <output className="text-sm text-muted-foreground">{status}</output>
    </form>
  );
}
