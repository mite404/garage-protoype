import { pathToFileURL } from "node:url";
import pg from "pg";

// Matches the session lock prepareTestDatabase holds while a test file owns the database.
const fixtureLock = 73002;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const fixtureSchemas = ["signal_desk", "auth"];
const usage =
  "Usage: TEST_DATABASE_URL=postgres://...@127.0.0.1/<name>_test \
node scripts/test-database.mjs status|reset";

const sessionsQuery = `select pid, coalesce(nullif(application_name, ''), 'unnamed') as application,
    coalesce(host(client_addr), 'local socket') as client, backend_start as since
  from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() order by backend_start`;
// Counts each fixture table in place so a fresh, unmigrated database reports nothing.
const leftoversQuery = `select format('%I.%I', schemaname, tablename) as "table",
    (xpath('/row/rows/text()', query_to_xml(
      format('select count(*) as rows from %I.%I', schemaname, tablename), false, true, '')))[1]
      ::text::int as rows
  from pg_tables where schemaname = any($1) order by 1`;
const lockHolderQuery = `select pid from pg_locks where locktype = 'advisory' and objid = $1
  and granted and database = (select oid from pg_database where datname = current_database())`;

/**
 * Parses a connection string the lever may inspect or reset: a loopback server and a
 * database whose name ends in `_test`. Hosted and shared databases are never loopback.
 * @throws {Error} When the URL is missing, remote, or names a non-disposable database.
 */
export function disposableTarget(connectionString) {
  if (!connectionString) throw new Error(`Set TEST_DATABASE_URL. ${usage}`);
  const url = new URL(connectionString); // → URL
  const name = decodeURIComponent(url.pathname.slice(1)); // → database name
  if (!loopbackHosts.has(url.hostname))
    throw new Error(
      `Refusing ${url.hostname || "a socket"}: only loopback databases are disposable.`,
    );
  if (!/^[a-z0-9_]+_test$/.test(name))
    throw new Error(`Refusing database "${name}": disposable names match [a-z0-9_]+_test.`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return { url, admin, name };
}

/** Lists who holds or uses the database and which fixture tables still hold rows. */
export function describe({ sessions, leftovers, lockHolder }) {
  const lock = lockHolder
    ? [`Fixture lock: held by pid ${lockHolder}, a test run or harness.`]
    : [];
  const connected = sessions.map(
    ({ pid, application, client, since }) =>
      `Connected: pid ${pid}, ${application} from ${client} since ${since.toISOString()}`,
  );
  const rows = leftovers.map(({ table, rows }) => `Leftover: ${table} has ${rows} row(s)`);
  return [...lock, ...connected, ...rows].join("\n");
}

/**
 * Returns true when no test run owns the database and no fixture rows remain. Idle
 * connections, such as the app CI starts against the same database, do not make it dirty.
 */
export const isClean = ({ leftovers, lockHolder }) => !lockHolder && !leftovers.length;

async function withClient(url, work) {
  const client = new pg.Client({
    connectionString: url.toString(),
    application_name: "signal-desk-test-database",
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Reports who is attached to the disposable database and which fixture tables hold rows.
 * Counting waits for no one: if a test file holds the fixture lock, the report names it.
 * @throws {Error} When the target is not disposable or the server is unreachable.
 */
export async function inspect(connectionString) {
  const { url, admin, name } = disposableTarget(connectionString);
  const exists = await withClient(admin, async (client) => {
    const result = await client.query("select 1 from pg_database where datname = $1", [name]);
    return result.rowCount > 0;
  });
  if (!exists) return { sessions: [], leftovers: [], lockHolder: null, exists };
  return withClient(url, async (client) => {
    const sessions = (await client.query(sessionsQuery, [name])).rows; // → Session[]
    const holder = (await client.query(lockHolderQuery, [fixtureLock])).rows[0]?.pid ?? null;
    const counted = (await client.query(leftoversQuery, [fixtureSchemas])).rows;
    const leftovers = counted.filter(({ rows }) => rows > 0); // → { table, rows }[]
    return { sessions, leftovers, lockHolder: holder, exists };
  });
}

/**
 * Drops and recreates the disposable database so the next test bootstrap migrates it fresh.
 * Refuses while any other session is attached; PostgreSQL also refuses the drop if one
 * connects in between, so a concurrent owner is never disconnected.
 * @throws {Error} When the target is not disposable or another workflow is connected.
 */
export async function reset(connectionString) {
  const { admin, name } = disposableTarget(connectionString);
  await withClient(admin, async (client) => {
    const sessions = (await client.query(sessionsQuery, [name])).rows;
    if (sessions.length)
      throw new Error(
        `Refusing to reset ${name} while another workflow is connected. Stop it first.\n` +
          describe({ sessions, leftovers: [], lockHolder: null }),
      );
    await client.query(`drop database if exists "${name}"`);
    await client.query(`create database "${name}"`);
  });
}

async function main([command]) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (command === "reset") {
    await reset(connectionString);
    console.log(
      `Recreated ${disposableTarget(connectionString).name}; tests migrate it on first use.`,
    );
    return 0;
  }
  if (command !== "status") throw new Error(usage);
  const report = await inspect(connectionString);
  const { name } = disposableTarget(connectionString);
  if (!report.exists) console.log(`${name} does not exist yet; reset creates it.`);
  else console.log(describe(report) || `${name} holds no fixture rows and no test run owns it.`);
  return isClean(report) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).then(
    (status) => process.exit(status),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
