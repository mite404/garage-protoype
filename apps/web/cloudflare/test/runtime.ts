import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type {
  OwnerFault,
  OwnerProcess,
  StreamingTestRuntime,
} from "../../src/server/test-streaming-owner";

type LaunchOptions = { providerPort?: number; fault?: OwnerFault; log?: (text: string) => void };

const root = fileURLToPath(new URL("../", import.meta.url));
const vite = fileURLToPath(new URL("../../../../node_modules/.bin/vite", import.meta.url));
const state = fileURLToPath(new URL("../.wrangler/test-state", import.meta.url));
// Every launch appends here, so a hung or failed run can be diagnosed afterwards, including in CI.
const logFile = fileURLToPath(new URL("../.wrangler/test-worker.log", import.meta.url));
const devVars = new URL("../.dev.vars", import.meta.url);
const token = randomBytes(24).toString("base64url");
const faultMarker = "SIGNAL_DESK_FAULT_REACHED";
const sweepPath = `/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}`;
// Hyperdrive's local proxy passes credentials but not startup options, so the Worker logs in as a
// role whose session defaults to the runtime role the Node owner selects with `options`.
const workerRole = "signal_desk_worker_test";
const workerPassword = randomBytes(24).toString("base64url");
let workerDatabaseUrl = "";

const faultValue = (fault?: OwnerFault) => {
  if (fault?.kind === "draft") return `draft:${fault.requestKey}`;
  if (fault?.kind === "settled") return `settled:${fault.turnId}`;
  return fault?.kind;
};

// A curated environment: every variable becomes a Worker binding, and no provider key leaks.
const workerEnv = (options: LaunchOptions, fault?: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: "development",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: workerDatabaseUrl,
  SIGNAL_DESK_TEST_SEAMS: "1",
  SIGNAL_DESK_TEST_STATE: state,
  STREAM_WORKER_TOKEN: token,
  ...(options.providerPort
    ? { SIGNAL_DESK_TEST_PROVIDER_URL: `http://127.0.0.1:${options.providerPort}/v1` }
    : {}),
  ...(fault ? { SIGNAL_DESK_TEST_FAULT: fault } : {}),
});

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("No free port.");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function createWorkerRole(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(`do $$ begin
      if not exists (select from pg_roles where rolname = '${workerRole}') then
        create role ${workerRole} login;
      end if;
    end $$`);
    await pool.query(`alter role ${workerRole} password '${workerPassword}'`);
    await pool.query(`grant signal_desk_runtime to ${workerRole}`);
    await pool.query(`alter role ${workerRole} set role signal_desk_runtime`);
  } finally {
    await pool.end();
  }
  const worker = new URL(url);
  worker.username = workerRole;
  worker.password = workerPassword;
  worker.search = "";
  return worker.toString();
}

// First requests trigger dependency optimization reloads; wait until the Worker answers.
async function waitUntilReady(origin: string, child: ChildProcess, logs: () => string) {
  let status: number | undefined;
  for (let i = 0; i < 600 && running(child); i++) {
    const response = await fetch(`${origin}/internal/ready`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    status = response?.status;
    if (response?.status === 404 && !/program reload\s*$/.test(logs())) return;
    await setTimeout(200);
  }
  throw new Error(`The Worker did not start; last readiness status ${status}\n${logs()}`);
}

// Turns submitted while no Worker ran lost their kick; production's cron sweep recovers them.
async function sweep(origin: string, fault: string | undefined, logs: () => string) {
  const response = await fetch(`${origin}${sweepPath}`).catch(() => undefined);
  if (!response?.ok && !fault) throw new Error(`The sweep failed\n${logs()}`);
}

// Runs the Worker in local workerd through `vite dev`, built with the test seams.
async function launch(options: LaunchOptions): Promise<OwnerProcess> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const fault = faultValue(options.fault);
  const args = ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const child = spawn(vite, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: workerEnv(options, fault),
  });
  const exited = once(child, "exit").then(([, signal]) => signal as NodeJS.Signals | null);
  const kill = async () => {
    if (running(child)) process.kill(-child.pid!, "SIGKILL");
    await exited;
  };
  // workerd cannot SIGKILL itself; the crash lands once the Worker holds at the boundary.
  const crashes = Boolean(fault) && fault !== "pause-dispatch";
  let logs = "";
  const log = createWriteStream(logFile, { flags: "a" });
  log.write(`\n--- launch ${new Date().toISOString()} fault=${fault ?? "none"}\n`);
  const onData = (data: Buffer) => {
    logs += data;
    log.write(data);
    options.log?.(String(data));
    if (crashes && logs.includes(faultMarker)) void kill();
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  try {
    await waitUntilReady(origin, child, () => logs);
  } catch (error) {
    await kill();
    throw error;
  }
  process.env.STREAM_WORKER_URL = origin;
  await sweep(origin, fault, () => logs);
  return { exited, kill };
}

const exists = (path: URL) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Runs the Cloudflare Worker in local workerd, with Durable Object storage that survives crashes.
 * @throws If the database role cannot be created or the Worker does not start.
 */
export const cloudflareRuntime: StreamingTestRuntime = {
  async prepare(url) {
    // Wrangler prefers .dev.vars over the environment, which would silently replace the seams.
    if (await exists(devVars))
      throw new Error("Move apps/web/cloudflare/.dev.vars aside to run the guarantee suite.");
    workerDatabaseUrl = await createWorkerRole(url);
    await rm(state, { recursive: true, force: true });
    await mkdir(state, { recursive: true });
    await rm(logFile, { force: true });
    process.env.STREAM_WORKER_TOKEN = token;
  },
  async start(providerPort) {
    const owner = await launch({ providerPort });
    return { stop: owner.kill };
  },
  spawn: launch,
};
