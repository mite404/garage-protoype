"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { postPrototypeCommand } from "@/app/prototype-command";

type Fields = Record<string, FormDataEntryValue>;
type Option = { value: string; label: string };

// Whole dollars entered by the specialist become integer cents for the need contract.
const cents = (dollars: FormDataEntryValue | undefined) => Math.round(Number(dollars) * 100);

function needInput(fields: Fields) {
  return {
    buyerLabel: fields.buyerLabel,
    statement: fields.statement,
    provenance: fields.provenance,
    constraints: {
      vehicleClass: fields.vehicleClass,
      budgetBasis: fields.budgetBasis,
      maxBudgetCents: cents(fields.maxBudget),
      maxHeightIn: Number(fields.maxHeightIn),
    },
    synthetic: fields.synthetic === "on",
  };
}

// A seller option is either a seller account or one of its vehicles, encoded as `kind:id`.
const targetKeys: Record<string, string> = { vehicle: "vehicleId", seller: "sellerProspectId" };

function connectionInput(fields: Fields, base: Record<string, string>) {
  const { target, ...rest } = fields;
  const [kind = "", id] = String(target ?? "").split(":");
  const key = targetKeys[kind];
  return { ...base, ...rest, ...(key ? { [key]: id } : {}) };
}

function useCommand(kind: "create_need" | "open_connection") {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  // A new connection opens its page; a new need stays here, ready for the next one.
  function settle(caseId: string | undefined, form: HTMLFormElement) {
    if (caseId) return router.push(`/desk/sourcing/${encodeURIComponent(caseId)}`);
    form.reset();
    setStatus("Saved. Nothing was sent.");
    router.refresh();
  }
  async function submit(event: FormEvent<HTMLFormElement>, input: unknown) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setPending(true);
    setStatus("");
    try {
      const data = (await postPrototypeCommand(
        "/api/v1/desk/sourcing",
        JSON.stringify({ kind, input }),
        crypto.randomUUID(),
      )) as { caseId?: string };
      settle(data.caseId, form);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed. Review before retrying.");
    } finally {
      setPending(false);
    }
  }
  return { pending, status, submit };
}

function Submit({ pending, label, status }: { pending: boolean; label: string; status: string }) {
  return (
    <>
      <button className="quiet-button" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      <output className="text-sm text-muted-foreground">{status}</output>
    </>
  );
}

/** Records a confirmed buyer need. It creates no vehicle, opportunity or buyer login. */
export function BuyerNeedForm() {
  const { pending, status, submit } = useCommand("create_need");
  return (
    <form
      className="growth-form"
      onSubmit={(event) =>
        submit(event, needInput(Object.fromEntries(new FormData(event.currentTarget))))
      }
    >
      <label>
        Buyer
        <input name="buyerLabel" required maxLength={200} />
      </label>
      <label>
        Confirmed need, as the buyer stated it
        <textarea name="statement" required maxLength={2000} />
      </label>
      <label>
        Need provenance
        <input name="provenance" required maxLength={500} />
      </label>
      <div className="growth-pair">
        <label>
          Vehicle class
          <input name="vehicleClass" required maxLength={100} defaultValue="Pumper" />
        </label>
        <label>
          Budget basis
          <select name="budgetBasis" defaultValue="total">
            <option value="total">All-in total</option>
            <option value="purchase_price">Purchase price only</option>
          </select>
        </label>
        <label>
          Maximum budget (USD)
          <input name="maxBudget" type="number" required min={1} step={1} inputMode="numeric" />
        </label>
        <label>
          Maximum height (inches)
          <input name="maxHeightIn" type="number" required min={1} max={240} step={0.5} />
        </label>
      </div>
      <label className="growth-check">
        <input name="synthetic" type="checkbox" defaultChecked />
        Synthetic record
      </label>
      <Submit pending={pending} label="Record buyer need" status={status} />
    </form>
  );
}

/** Opens a connection from one side: a buyer need toward a seller or vehicle, or a vehicle toward
 * a buyer need. The server checks ownership of both sides; nothing is sent. */
export function ConnectionForm({
  label,
  fieldLabel,
  name,
  options,
  base = {},
  children,
}: {
  label: string;
  fieldLabel: string;
  // `target` chooses a seller or vehicle; `needId` chooses a buyer need.
  name: "target" | "needId";
  options: Option[];
  base?: Record<string, string>;
  children?: ReactNode;
}) {
  const { pending, status, submit } = useCommand("open_connection");
  if (!options.length) return null;
  return (
    <form
      className="growth-form"
      onSubmit={(event) =>
        submit(event, connectionInput(Object.fromEntries(new FormData(event.currentTarget)), base))
      }
    >
      {children}
      <label>
        {fieldLabel}
        <select name={name} required>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next action
        <input
          name="nextAction"
          required
          maxLength={300}
          defaultValue="Confirm fit, availability and authority before the introduction."
        />
      </label>
      <Submit pending={pending} label={label} status={status} />
    </form>
  );
}
