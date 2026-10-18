import { env } from "cloudflare:workers";
import pg from "pg";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

// Replaces src/transport.ts in builds made with SIGNAL_DESK_TEST_SEAMS=1. The crash points mirror
// the Node suite's: they hold the process at the same durable boundary, and the suite kills
// workerd once it reads the marker.
type TestEnv = { SIGNAL_DESK_TEST_PROVIDER_URL?: string; SIGNAL_DESK_TEST_FAULT?: string };
const testEnv = env as unknown as TestEnv;
const fault = testEnv.SIGNAL_DESK_TEST_FAULT ?? "";
// Keys contain colons themselves, such as flue-draft:<turn>:seller_request.
const kind = fault.split(":", 1)[0] ?? "";
const key = fault.slice(kind.length + 1);
// Rows whose existence proves the process passed the durable boundary.
const boundaries: Record<string, [string, string[]]> = {
  draft: ["select id from signal_desk.assistance_drafts where request_key=$1", [key]],
  settled: [
    "select a.id from signal_desk.inference_attempts a join signal_desk.inference_operations o " +
      "on o.id=a.operation_id where o.request_key like $1 and a.report is not null",
    [`flue:${key}:%`],
  ],
};
const boundary = boundaries[kind];
const pausesDispatch = kind === "pause-dispatch";

// Without a local provider, the real transport runs so missing credentials stay observable.
const providerUrl = testEnv.SIGNAL_DESK_TEST_PROVIDER_URL;
export const transport: typeof streamSimple = providerUrl
  ? (model, context, options) =>
      streamSimple({ ...model, baseUrl: providerUrl }, context, { ...options, apiKey: "synthetic" })
  : streamSimple;

const open = new WeakSet<object>();
const original = pg.Client.prototype.query as (...args: unknown[]) => Promise<pg.QueryResult>;

const statementOf = (text: unknown) =>
  typeof text === "string" ? text : ((text as { text?: string })?.text ?? "");
// A commit, or a write outside any transaction, is the moment a change becomes durable.
const makesDurable = (statement: string, client: object) =>
  /^\s*commit/i.test(statement) || (/^\s*(insert|update)/i.test(statement) && !open.has(client));

function noteTransaction(client: object, statement: string) {
  if (/^\s*begin/i.test(statement)) open.add(client);
  if (/^\s*(commit|rollback)/i.test(statement)) open.delete(client);
}

async function pauseAtDispatch(client: pg.Client, statement: string) {
  if (!pausesDispatch || !/update.*stream_turns.*submission_id/i.test(statement)) return;
  console.log("dispatch-paused");
  // One statement keeps lock and unlock on the same pooled connection.
  await original.call(client, "select pg_advisory_lock(80002), pg_advisory_unlock(80002)");
}

async function holdPastBoundary(client: pg.Client) {
  if (!boundary || !(await original.call(client, ...boundary)).rowCount) return;
  console.log(`SIGNAL_DESK_FAULT_REACHED ${fault}`);
  await new Promise<never>(() => {});
}

async function faultingQuery(this: pg.Client, text: unknown, ...args: unknown[]) {
  const statement = statementOf(text);
  const durable = makesDurable(statement, this);
  noteTransaction(this, statement);
  await pauseAtDispatch(this, statement);
  const result = await original.call(this, text, ...args);
  if (durable) await holdPastBoundary(this);
  return result;
}

if (boundary || pausesDispatch)
  pg.Client.prototype.query = faultingQuery as typeof pg.Client.prototype.query;
