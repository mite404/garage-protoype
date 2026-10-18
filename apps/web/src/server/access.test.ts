import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import {
  grantedAccess,
  resolveActor,
  requireOpportunity,
  requireSpending,
  type AccessRow,
} from "./access";
import { getPublicVehicle, getSource } from "./records";
import { prepareTestDatabase } from "./test-database";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error("CI requires TEST_DATABASE_URL.");

test("one access row raises the same first error as the separate checks, in caller order", () => {
  const user = "10000000-0000-4000-8000-000000000003";
  const tokenId = "30000000-0000-4000-8000-000000000001";
  const session = { kind: "supabase-session", sessionId: user } as const;
  const token = { kind: "app-token", tokenId } as const;
  const deal = {
    id: "deal-a",
    vehicle_id: "truck",
    buyer_id: user,
    internal_notes: "",
    next_action: "",
  };
  const row: AccessRow = {
    active: true,
    token_id: null,
    scopes: null,
    user_id: user,
    role: "specialist",
    can_spend: true,
    revoked: null,
    opportunity: deal,
  };
  const tokenRow = { ...row, token_id: tokenId, scopes: ["read" as const] };
  const fails = (code: string, run: () => unknown) => assert.throws(run, { code });
  // An ended session is unauthenticated even when the identity is also revoked or missing.
  fails("UNAUTHENTICATED", () =>
    grantedAccess({ ...row, active: false, revoked: true }, session, []),
  );
  fails("ACCESS_REVOKED", () =>
    grantedAccess({ ...row, user_id: null, role: null, can_spend: null }, session, []),
  );
  fails("UNAUTHENTICATED", () => grantedAccess({ ...tokenRow, active: false }, token, []));
  fails("ACCESS_REVOKED", () => grantedAccess({ ...tokenRow, role: "buyer" }, token, []));
  fails("SCOPE_DENIED", () => grantedAccess({ ...tokenRow, scopes: ["write"] }, token, []));
  // Role is checked before visibility, and each caller's check order decides the first failure.
  const hidden = { ...tokenRow, opportunity: null };
  fails("FORBIDDEN", () => grantedAccess(hidden, token, ["opportunity"], "buyer"));
  fails("SCOPE_DENIED", () => grantedAccess(hidden, token, ["write", "opportunity"]));
  fails("NOT_FOUND", () => grantedAccess(hidden, token, ["opportunity", "write"]));
  // A token spends only with both the identity permission and its own spend scope.
  fails("SPENDING_DENIED", () => grantedAccess(tokenRow, token, ["spend"]));
  const granted = grantedAccess(
    { ...tokenRow, scopes: ["read", "write", "spend"] },
    token,
    ["opportunity", "spend", "write"],
    "specialist",
  );
  assert.deepEqual(granted, {
    actor: { userId: user, role: "specialist", canSpend: true, credential: token },
    opportunity: deal,
  });
  assert.equal(grantedAccess({ ...row, can_spend: false }, session, []).actor.canSpend, false);
});

test(
  "fresh access, ownership, private bytes, and approved projection",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const db = await pool.connect();
    const buyerA = "10000000-0000-4000-8000-000000000001";
    const buyerB = "10000000-0000-4000-8000-000000000002";
    const specialist = "10000000-0000-4000-8000-000000000003";
    const sessionId = "20000000-0000-4000-8000-000000000001";
    const specialistSession = "20000000-0000-4000-8000-000000000003";
    try {
      await db.query("begin");
      await prepareTestDatabase(db);
      await db.query(
        `insert into signal_desk.identities (user_id, role, can_spend)
      values ($1,'buyer',true),($2,'buyer',false),($3,'specialist',true)`,
        [buyerA, buyerB, specialist],
      );
      await db.query(`insert into auth.sessions (id,user_id) values ($1,$2)`, [sessionId, buyerA]);
      await db.query(`insert into signal_desk.vehicles (id,title,internal_notes,published_at)
      values ('truck','Synthetic pumper','PRIVATE PRICE',now()),('hidden','Hidden','secret',null)`);
      await db.query(
        `insert into signal_desk.opportunities (id,vehicle_id,buyer_id,internal_notes)
      values ('deal-a','truck',$1,'PRIVATE BUYER A'),('deal-b','truck',$2,'PRIVATE BUYER B')`,
        [buyerA, buyerB],
      );
      await db.query(
        `insert into signal_desk.sources (id,opportunity_id,owner_id,audience,name,media_type,content)
      values ('private','deal-a',$1,'private','note','text/plain',decode('6869','hex')),
      ('sales','deal-a',$1,'sales','report','text/plain',decode('6f6b','hex'))`,
        [buyerA],
      );
      await db.query(`insert into signal_desk.public_facts
      (vehicle_id,field,value,citation_excerpt,source_label,approved_at,shareable)
      values ('truck','year','2004','Year 2004','Synthetic brochure',now(),true),
      ('truck','price','PRIVATE PRICE','secret','internal',now(),false),
      ('truck','tank','500','Unreviewed','note',null,true)`);
      const actor = await resolveActor({ userId: buyerA, sessionId }, db);
      assert.equal(actor.role, "buyer");
      await assert.rejects(resolveActor({ userId: buyerB, sessionId }, db), { status: 401 });
      assert.equal((await requireOpportunity(actor, "deal-a", undefined, db)).id, "deal-a");
      await assert.rejects(requireOpportunity(actor, "deal-b", undefined, db), { status: 404 });
      await assert.rejects(requireOpportunity(actor, "deal-a", "specialist", db), { status: 403 });
      await assert.rejects(
        requireOpportunity({ ...actor, role: "specialist" }, "deal-a", "specialist", db),
        { status: 403 },
      );
      await assert.rejects(getSource(actor, "missing", db), { status: 404 });
      assert.equal((await getSource(actor, "private", db)).content.toString(), "hi");
      await db.query("insert into auth.sessions (id,user_id) values ($1,$2)", [
        specialistSession,
        specialist,
      ]);
      const sales = await resolveActor({ userId: specialist, sessionId: specialistSession }, db);
      await assert.rejects(requireOpportunity(sales, "deal-a", "specialist", db), { status: 404 });
      await assert.rejects(getSource(sales, "sales", db), { status: 404 });
      await db.query(
        "insert into signal_desk.opportunity_members(opportunity_id,user_id) values ('deal-a',$1)",
        [specialist],
      );
      assert.equal(
        (await requireOpportunity(sales, "deal-a", "specialist", db)).internal_notes,
        "PRIVATE BUYER A",
      );
      assert.equal((await getSource(sales, "sales", db)).content.toString(), "ok");
      await assert.rejects(getSource(sales, "private", db), { status: 404 });
      await db.query("delete from signal_desk.opportunity_members where user_id=$1", [specialist]);
      await assert.rejects(getSource(sales, "sales", db), { status: 404 });
      const vehicle = await getPublicVehicle("truck", db);
      assert.deepEqual(vehicle, {
        id: "truck",
        title: "Synthetic pumper",
        facts: [
          {
            field: "year",
            value: "2004",
            citation: { sourceLabel: "Synthetic brochure", excerpt: "Year 2004" },
          },
        ],
        photos: [],
        coverage: [
          { view: "front", state: "missing" },
          { view: "rear", state: "missing" },
          { view: "driver_side", state: "missing" },
          { view: "passenger_side", state: "missing" },
          { view: "cab", state: "missing" },
          { view: "pump_panel", state: "missing" },
          { view: "odometer", state: "missing" },
          { view: "identification_plate", state: "missing" },
        ],
        prototypeLabel: "Independent prototype · synthetic or permissioned evidence",
      });
      await assert.rejects(getPublicVehicle("hidden", db), { status: 404 });
      assert.doesNotMatch(JSON.stringify(vehicle), /PRIVATE|Unreviewed/);
      // Hosted Supabase does not let the operator grant custom roles auth-schema usage.
      await db.query("revoke usage on schema auth from signal_desk_runtime");
      await db.query("set local role signal_desk_runtime");
      assert.equal((await requireOpportunity(actor, "deal-a", undefined, db)).id, "deal-a");
      assert.equal((await getPublicVehicle("truck", db)).title, "Synthetic pumper");
      await db.query("savepoint denied_write");
      await assert.rejects(db.query("update signal_desk.identities set can_spend=true"), {
        code: "42501",
      });
      await db.query("rollback to savepoint denied_write");
      await db.query("reset role");
      await requireSpending(actor, db);
      await db.query("update signal_desk.identities set can_spend=false where user_id=$1", [
        buyerA,
      ]);
      await assert.rejects(requireSpending(actor, db), { status: 403 });
      await db.query("update signal_desk.identities set revoked_at=now() where user_id=$1", [
        buyerA,
      ]);
      await assert.rejects(requireOpportunity(actor, "deal-a", undefined, db), { status: 403 });
      await db.query("update signal_desk.identities set revoked_at=null where user_id=$1", [
        buyerA,
      ]);
      await db.query("delete from auth.sessions where id=$1", [sessionId]);
      await assert.rejects(resolveActor({ userId: buyerA, sessionId }, db), { status: 401 });
      await db.query(
        "insert into auth.sessions (id,user_id,not_after) values ($1,$2,now()-interval '1 second')",
        [sessionId, buyerA],
      );
      await assert.rejects(resolveActor({ userId: buyerA, sessionId }, db), { status: 401 });
    } finally {
      await db.query("rollback");
      db.release();
      await pool.end();
    }
  },
);
