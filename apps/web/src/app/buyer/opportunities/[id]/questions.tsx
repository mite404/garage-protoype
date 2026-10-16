"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { getAssistance } from "@/server/assistance";
import AssistanceCard from "@signal-desk/catalog/assistance-card";
import { postPrototypeCommand } from "@/app/prototype-command";

/** Invited buyers retain questions and explicit offer terms; all commercial decisions stay human. */
export default function BuyerConversation({
  view,
}: {
  view: Awaited<ReturnType<typeof getAssistance>>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const retry = useRef({ body: "", key: "" });
  async function submit(input: unknown) {
    if (pending) return;
    const body = JSON.stringify(input);
    if (retry.current.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setMessage("");
    try {
      await postPrototypeCommand(
        `/api/v1/buyer/vehicles/${encodeURIComponent(view.vehicleId)}/inquiries?opportunityId=${encodeURIComponent(view.opportunityId)}`,
        body,
        retry.current.key,
      );
      retry.current = { body: "", key: "" };
      setMessage("Recorded for specialist review. No message was sent and no offer was accepted.");
      router.refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mx-auto max-w-3xl">
      <p className="eyebrow mb-3">Independent prototype · Private buyer conversation</p>
      <h1>Keep your conditions clear.</h1>
      <p className="mt-5 text-stone-600">
        Supported answers cite reviewed, shareable evidence. Everything else goes to your assigned
        specialist. No live language model, external messages, accepted offers or delivery
        commitments.
      </p>
      <Link className="quiet-button mt-5" href={`/vehicles/${encodeURIComponent(view.vehicleId)}`}>
        Inspect approved vehicle evidence ↗
      </Link>
      <div className="my-7 space-y-5">
        {view.inquiries.map((q) => (
          <div key={q.id}>
            <p className="mb-3 whitespace-pre-wrap rounded-md bg-stone-100 p-4 text-sm">
              <strong>Your inquiry</strong>
              <br />
              {q.input.text}
            </p>
            <AssistanceCard card={q.card} />
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>Ask an evidence question</h2>
        <p className="mt-3 text-sm text-stone-600">
          Try "What is the tank capacity?" or "What was the pump-test result?" Other wording needs
          human interpretation.
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit({ kind: "question", text: new FormData(event.currentTarget).get("text") });
          }}
        >
          <fieldset disabled={pending}>
            <label htmlFor="buyer-question">Your question</label>
            <textarea id="buyer-question" name="text" rows={2} required maxLength={2000} />
            <button className="button mt-4">Record question</button>
          </fieldset>
        </form>
      </section>
      <section className="panel mt-5">
        <h2>Record an explicit conditional offer</h2>
        <p className="mt-3 text-sm text-stone-600">
          This records your stated terms for a human. It is not acceptance, a bid submission or a
          promise of delivery.
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const lines = (key: string) =>
              String(form.get(key) ?? "")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
            const amount = String(form.get("amount"));
            const parts = amount.split(".");
            const cents = Number(parts[0]) * 100 + Number((parts[1] ?? "").padEnd(2, "0"));
            void submit({
              kind: "offer",
              text: form.get("text"),
              amountMinor: cents,
              currency: "USD",
              timingText: form.get("timingText"),
              conditions: lines("conditions"),
              unansweredQuestions: lines("questions"),
            });
          }}
        >
          <fieldset disabled={pending}>
            <label htmlFor="offer-text">Your original offer message</label>
            <textarea id="offer-text" name="text" required maxLength={2000} rows={2} />
            <div className="form-grid mt-4">
              <div>
                <label htmlFor="offer-amount">Offer amount (USD)</label>
                <input
                  id="offer-amount"
                  name="amount"
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                  placeholder="165000.00"
                  required
                />
              </div>
              <div>
                <label htmlFor="offer-timing">Stated timing or deadline</label>
                <input
                  id="offer-timing"
                  name="timingText"
                  required
                  maxLength={2000}
                  placeholder="Delivery before December"
                />
              </div>
            </div>
            <label className="mt-4" htmlFor="offer-conditions">
              Conditions, one per line
            </label>
            <textarea
              id="offer-conditions"
              name="conditions"
              rows={3}
              maxLength={10000}
              placeholder="Review pump-test report"
            />
            <label className="mt-4" htmlFor="offer-questions">
              Unanswered questions, one per line
            </label>
            <textarea id="offer-questions" name="questions" rows={2} maxLength={10000} />
            <button className="button mt-4">Record offer for human review</button>
          </fieldset>
        </form>
      </section>
      <output className="my-5 block text-sm text-stone-600" aria-live="polite">
        {pending ? "Recording…" : message}
      </output>
    </section>
  );
}
