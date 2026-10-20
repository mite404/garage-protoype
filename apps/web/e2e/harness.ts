// Playwright web server: one disposable *_test database, a controlled specialist sign-in, the
// synthetic NY sourcing walkthrough and a labelled local model. Never reads the prototype
// DATABASE_URL, never reaches a paid provider and never enables external delivery.
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";

delete process.env.OPENROUTER_API_KEY;
delete process.env.GROWTH_DELIVERY_MODE;
// Its own database: npm test owns TEST_DATABASE_URL, and fixtures cannot share one.
const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("Set E2E_DATABASE_URL to a loopback database ending in _test.");
if (url === process.env.TEST_DATABASE_URL)
  throw new Error("E2E_DATABASE_URL must differ from the TEST_DATABASE_URL npm test owns.");
const runtimeUrl = new URL(url);
runtimeUrl.searchParams.set("options", "-c role=signal_desk_runtime");
process.env.DATABASE_URL = runtimeUrl.toString();
process.env.MIGRATION_DATABASE_URL = url;

const port = Number(process.env.E2E_PORT ?? 3919);
const stateDir = new URL("../.e2e/", import.meta.url);
const user = randomUUID();
const session = randomUUID();
const buyer = "94e2e000-0000-4000-8000-000000000003";
const deal = "e2e-demo-deal";
const directory = [
  ["NY-SYN-MAPLE-GROVE", "Maple Grove Fire Department", "Maple Grove", "12534"],
  ["NY-SYN-NORTHFIELD", "Northfield Fire District", "Northfield", "13820"],
  ["NY-SYN-OAK-HOLLOW", "Oak Hollow Fire Company", "Oak Hollow", "12550"],
].map(([sourceId, name, city, postalCode]) => ({ sourceId, name, city, state: "NY", postalCode }));
const syntheticAnswer =
  "(Synthetic local model) First confirm **sale intent and authority**. Then resolve height " +
  "and total cost against Pine Brook's need. The request below is a draft only.";

// A previous run's session must never sign in this run's browser.
await rm(new URL("session.json", stateDir), { force: true });

const scripts = "../../../scripts/";
const { reset } = await import(scripts + "test-database.mjs");
const server = "../src/server/";
const { prepareTestDatabase } = await import(server + "test-database.ts");
const { resolveActor } = await import(server + "access.ts");
const { seedSourcing } = await import(server + "sourcing-seed.ts");
const { seedMunicipality } = await import(server + "municipality-seed.ts");
const sourcing = await import(server + "sourcing.ts");
const growth = await import(server + "growth.ts");
const { nodeRuntime } = await import(server + "test-streaming-owner.ts");
const { startTestApp } = await import(server + "test-app.ts");

async function seedAccess(db: PoolClient) {
  await db.query(
    "insert into signal_desk.identities(user_id,role,can_spend) values ($1,'specialist',true),($2,'buyer',false) on conflict do nothing",
    [user, buyer],
  );
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, user]);
  await db.query(`insert into signal_desk.inference_models
    (id,enabled,max_input_bytes,max_photos,photo_tokens,overhead_tokens,max_output_tokens,input_micro_usd,output_micro_usd,max_attempts,retry_ms,timeout_ms)
    values ('moonshotai/kimi-k3',true,200000,0,0,1000,1000,1,12,1,10,10000)
    on conflict(id) do update set enabled=true`);
  await db.query(
    "insert into signal_desk.inference_budgets(scope,limit_micro_usd,max_concurrent) values ('installation',10000000,5),($1,10000000,5) on conflict(scope) do nothing",
    [user],
  );
}

async function seedDeal(db: PoolClient) {
  await db.query(await readFile(new URL("../../../db/demo.sql", import.meta.url), "utf8"));
  await db.query(
    "insert into signal_desk.opportunities(id,vehicle_id,buyer_id,assignee_id) values ($1,'demo-pumper',$2,$3) on conflict do nothing",
    [deal, buyer, user],
  );
  await db.query("insert into signal_desk.opportunity_members values ($1,$2)", [deal, user]);
  await seedMunicipality(db, { buyerId: buyer, opportunityId: deal });
}

// Maple Grove already has a recorded reply; Northfield starts at identity review.
type Actor = Awaited<ReturnType<typeof resolveActor>>;
type Prospect = { id: string; name: string; directory: { sourceId: string } };

async function seedWalkthrough(actor: Actor) {
  await seedSourcing(actor);
  await growth.importDirectory(actor, {
    source: "usfa",
    snapshot: "synthetic-e2e",
    synthetic: true,
    rows: directory,
  });
  const prospects = await growth.listProspects(actor);
  const maple = prospects.find(
    (prospect: { directory: { sourceId: string } }) =>
      prospect.directory.sourceId === "NY-SYN-MAPLE-GROVE",
  );
  await growth.reviewProspect(actor, maple.id, {
    name: maple.name,
    fit: "unknown",
    identity: "confirmed",
    signal: null,
    contact: {
      name: "Synthetic chief",
      email: "maple-grove@example.test",
      permission: "allowlisted_test",
      provenance: "Synthetic fixture contact.",
    },
  });
  const [need] = (await sourcing.listSourcingCases(actor)).map(
    (item: { needId: string }) => item.needId,
  );
  const caseId = await sourcing.openConnection(actor, {
    needId: need,
    sellerProspectId: maple.id,
    nextAction: "Review the reply before changing the fit.",
    sourceChange: {
      dedupeKey: `synthetic:maple-grove:${user}`,
      sourceLabel: "Board minutes · Synthetic source",
      url: "https://example.org/synthetic/maple-grove-minutes",
      excerpt: "Board approved purchase of a replacement engine for delivery in spring.",
      observedAt: new Date("2026-10-15T00:00:00Z"),
      synthetic: true,
    },
  });
  const opened = await sourcing.getSourcingAccount(actor, caseId);
  await sourcing.runSourcingCommand(actor, caseId, {
    kind: "draft",
    revision: opened.revision,
    subject: "Is your pumper being offered for sale?",
    body: "Could you confirm sale status, authority, height and price? Reply STOP to opt out.",
  });
  const drafted = await sourcing.getSourcingAccount(actor, caseId);
  await sourcing.runSourcingCommand(actor, caseId, {
    kind: "record_original",
    revision: drafted.revision,
    text: "Maybe later, once the new truck arrives. Our current pumper is 121 inches tall.",
  });
  await seedReadyConnection(actor, prospects, maple.id);
}

// Oak Hollow is a qualified seller whose listing already meets Harbor Point's need, so the queue
// has a connection ready for the introduction; Maple Grove competes for the same need.
async function seedReadyConnection(actor: Actor, prospects: Prospect[], mapleId: string) {
  const oak = prospects.find((prospect) => prospect.directory.sourceId === "NY-SYN-OAK-HOLLOW")!;
  await growth.reviewProspect(actor, oak.id, {
    name: oak.name,
    fit: "fit",
    identity: "confirmed",
    signal: {
      text: "Oak Hollow's board voted to sell its 2012 pumper this winter.",
      source: "Synthetic board minutes",
      quote: "sell its 2012 pumper",
      permission: "synthetic",
    },
    contact: null,
  });
  const listing = await sourcing.qualifySeller(actor, oak.id, {
    vehicleTitle: "2012 Oak Hollow pumper",
    reply: "Yes, the 2012 pumper is for sale and the board has authorized it.",
    provenance: "Synthetic call note",
    permission: "synthetic",
  });
  const needId = await sourcing.createBuyerNeed(actor, {
    buyerLabel: "Harbor Point FD",
    statement: "Harbor Point FD needs a pumper priced at most $150,000 and 120 in high.",
    provenance: "Synthetic permissioned call note",
    constraints: {
      vehicleClass: "Pumper",
      budgetBasis: "purchase_price",
      maxBudgetCents: 15_000_000,
      maxHeightIn: 120,
    },
    synthetic: true,
  });
  const caseId = await sourcing.openConnection(actor, {
    needId,
    vehicleId: listing.vehicleId,
    nextAction: "Introduce Harbor Point to Oak Hollow.",
  });
  await sourcing.openConnection(actor, {
    needId,
    sellerProspectId: mapleId,
    nextAction: "Confirm whether Maple Grove's pumper fits Harbor Point.",
  });
  const opened = await sourcing.getSourcingAccount(actor, caseId);
  await sourcing.runSourcingCommand(actor, caseId, {
    kind: "record_original",
    revision: opened.revision,
    text: "Yes, it is for sale at $140,000. It is 118 inches tall. Chief Park authorizes it.",
  });
  let current = await sourcing.getSourcingAccount(actor, caseId);
  const sourceRef = current.account.replies[0]!.id;
  for (const answer of [
    { field: "saleStatus", value: "available" },
    { field: "authority", value: "Chief Park" },
    { field: "priceCents", value: 14_000_000 },
  ])
    await sourcing.proposeSourcingFact(actor, caseId, current.revision, { sourceRef, answer });
  current = await sourcing.getSourcingAccount(actor, caseId);
  await sourcing.runSourcingCommand(actor, caseId, {
    kind: "accept",
    revision: current.revision,
    factIds: current.account.facts.map((fact: { id: string }) => fact.id),
  });
  current = await sourcing.getSourcingAccount(actor, caseId);
  await sourcing.runSourcingCommand(actor, caseId, {
    kind: "decide",
    revision: current.revision,
    decision: "proceed",
    reason: "Available, 118 in, $140,000 and authorized by the chief.",
  });
}

// Opens the information-request card, then answers in fixed, labelled text.
async function syntheticModel(request: IncomingMessage, response: ServerResponse) {
  const body: Buffer[] = [];
  for await (const bytes of request) body.push(Buffer.from(bytes));
  const input = JSON.parse(Buffer.concat(body).toString());
  const chunk = (delta: unknown, finish_reason: string | null = null) =>
    response.write(
      `data: ${JSON.stringify({ id: "synthetic", model: "moonshotai/kimi-k3", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  if (input.messages.some((message: { role: string }) => message.role === "tool")) {
    chunk({ content: syntheticAnswer });
    chunk({}, "stop");
  } else {
    const call = { name: "show_card", arguments: '{"tool":"information_request","props":{}}' };
    chunk({ tool_calls: [{ index: 0, id: "request-card", type: "function", function: call }] });
    chunk({}, "tool_calls");
  }
  response.write(
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

// Every run starts empty: the walkthrough seed has one owner per database. Reset refuses
// remote hosts and any other connected session.
await reset(url);
const pool = new Pool({ connectionString: url });
const db = await pool.connect();
try {
  await db.query("begin");
  await prepareTestDatabase(db);
  await db.query("commit");
  await nodeRuntime.prepare(url);
  await seedAccess(db);
  await seedDeal(db);
} finally {
  // Destroying the connection drops prepareTestDatabase's session advisory lock.
  db.release(true);
}
await seedWalkthrough(await resolveActor({ userId: user, sessionId: session }));
const provider = createServer(syntheticModel).listen(0, "127.0.0.1");
await once(provider, "listening");
const owner = await nodeRuntime.start((provider.address() as { port: number }).port);
const app = await startTestApp(user, session, port);
await mkdir(stateDir, { recursive: true });
await writeFile(
  new URL("session.json", stateDir),
  JSON.stringify({ origin: app.origin, cookie: app.cookie }),
);
process.stdout.write(`E2E app ready at ${app.origin}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.stop();
    await owner.stop();
    provider.close();
    await pool.end();
    process.exit(0);
  });
