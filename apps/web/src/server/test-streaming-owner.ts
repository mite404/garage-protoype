import { spawn } from "node:child_process";
import { once } from "node:events";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { migrateFlue } from "./flue-storage";
import { startStreamingOwner } from "./streaming-owner";

/** A durable boundary at which a spawned owner dies by SIGKILL, as a host crash would. */
export type OwnerFault =
  | { kind: "draft"; requestKey: string }
  | { kind: "settled"; turnId: string }
  | { kind: "pause-dispatch" };

/** An owner process the suite can crash and restart. */
export interface OwnerProcess {
  /** Resolves with the terminating signal once the owner has exited. */
  readonly exited: Promise<NodeJS.Signals | null>;
  /** Kills the owner at once, as a host crash would, and waits for exit. Safe to repeat. */
  kill(): Promise<void>;
}

/** The streaming owner under test: the Node process or the Cloudflare Worker. */
export interface StreamingTestRuntime {
  /** Prepares owner storage for a migrated disposable database. */
  prepare(url: string): Promise<void>;
  /** Starts an owner; without a provider port it uses the real transport and environment key. */
  start(providerPort?: number): Promise<{ stop(): Promise<void> }>;
  /** Starts a killable owner that dies by SIGKILL when it reaches the fault boundary. */
  spawn(options: {
    providerPort: number;
    fault?: OwnerFault;
    log: (text: string) => void;
  }): Promise<OwnerProcess>;
}

const synthetic =
  (providerPort: number): typeof streamSimple =>
  (model, context, options) =>
    streamSimple({ ...model, baseUrl: `http://127.0.0.1:${providerPort}/v1` }, context, {
      ...options,
      apiKey: "synthetic",
    });

// Crash points patch pg in the child: Flue's PostgreSQL writes mark each durable boundary.
const ownerScript = (providerPort: number, fault?: OwnerFault) => `
  import pg from 'pg';
  import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
  import { startStreamingOwner } from './apps/web/src/server/streaming-owner.ts';
  const original = pg.Client.prototype.query;
  const key = ${JSON.stringify(fault?.kind === "draft" ? fault.requestKey : "")};
  const settled = ${JSON.stringify(fault?.kind === "settled" ? fault.turnId : "")};
  const pause = ${JSON.stringify(fault?.kind === "pause-dispatch")};
  if (key || settled || pause) pg.Client.prototype.query = async function(text, ...args) {
    const statement = typeof text === 'string' ? text : text.text;
    if (pause && /update.*stream_turns.*submission_id/i.test(statement)) {
      process.stdout.write('dispatch-paused\\n');
      await original.call(this, 'select pg_advisory_lock(80002)');
      await original.call(this, 'select pg_advisory_unlock(80002)');
    }
    if ((key || settled) && /insert into flue_/i.test(statement)) {
      const found = settled
        ? await original.call(this, 'select a.id from signal_desk.inference_attempts a join signal_desk.inference_operations o on o.id=a.operation_id where o.request_key like $1 and a.report is not null', ['flue:' + settled + ':%'])
        : await original.call(this, 'select id from signal_desk.assistance_drafts where request_key=$1', [key]);
      if (found.rowCount) process.kill(process.pid, 'SIGKILL');
    }
    return original.call(this, text, ...args);
  };
  await startStreamingOwner({ transport: (model, context, options) => streamSimple(
    {...model, baseUrl: 'http://127.0.0.1:${providerPort}/v1'}, context, {...options, apiKey: 'synthetic'}) });
  process.stdout.write('ready\\n');
`;

/** Runs the PostgreSQL-backed Flue owner in this process or a spawned Node process. */
export const nodeRuntime: StreamingTestRuntime = {
  prepare: (url) => migrateFlue(url),
  start: (providerPort) =>
    startStreamingOwner(providerPort ? { transport: synthetic(providerPort) } : {}),
  async spawn({ providerPort, fault, log }) {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        ownerScript(providerPort, fault),
      ],
      {
        cwd: new URL("../../../../", import.meta.url),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (data) => log(String(data)));
    child.stderr?.on("data", (data) => log(String(data)));
    const exited = once(child, "exit").then(([, signal]) => signal as NodeJS.Signals | null);
    return {
      exited,
      async kill() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      },
    };
  },
};
