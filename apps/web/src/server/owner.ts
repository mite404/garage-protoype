import "server-only";

/** Wakes the execution owner. Commands carry only IDs; the owner rereads state from the database,
 * so a lost or repeated wake never loses or duplicates work.
 */
export interface OwnerCommands {
  /** Wakes the object that owns one logical turn. */
  kickTurn(turnId: string): Promise<unknown>;
  /** Asks the turn's object to stop it. */
  cancelTurn(turnId: string): Promise<unknown>;
}

// Node reaches a Cloudflare owner over HTTP when configured; unset keeps the Node owner, which
// finds work itself.
const post = async (path: string) => {
  const origin = process.env.STREAM_WORKER_URL;
  if (!origin) return;
  await fetch(new URL(path, origin), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.STREAM_WORKER_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(10000),
  });
};

const httpOwner: OwnerCommands = {
  kickTurn: (id) => post(`/internal/turns/${id}`),
  cancelTurn: (id) => post(`/internal/turns/${id}/cancel`),
};

// Kept on globalThis because Next.js bundles instrumentation and routes with separate module copies.
const state = ((globalThis as { [key: symbol]: unknown })[Symbol.for("signal-desk.owner")] ??= {
  commands: httpOwner,
}) as { commands: OwnerCommands };

/** Replaces how the owner is reached, such as a Workers service binding. Call once at startup. */
export function configureOwner(next: OwnerCommands) {
  state.commands = next;
}

/** Sends one wake and ignores failure: the owner's cron sweep recovers unfinished turns. */
export async function wakeOwner(command: keyof OwnerCommands, id: string) {
  await state.commands[command](id).catch(() => undefined);
}
