import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { disposableTarget, inspect, isClean, reset } from "./test-database.mjs";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CI requires TEST_DATABASE_URL.");
const cli = (command, database) =>
  spawnSync(process.execPath, ["scripts/test-database.mjs", command], {
    encoding: "utf8",
    env: { ...process.env, TEST_DATABASE_URL: database },
  });

test("only loopback databases named *_test are disposable", () => {
  const hosted =
    "postgresql://postgres.ref:secret@aws-1-us-west-2.pooler.supabase.com:5432/postgres";
  assert.throws(() => disposableTarget(hosted), /only loopback/);
  assert.throws(
    () => disposableTarget("postgres://u@db.internal:5432/signal_desk_test"),
    /loopback/,
  );
  assert.throws(() => disposableTarget("postgres://u@127.0.0.1/signal_desk"), /_test/);
  assert.throws(() => disposableTarget('postgres://u@127.0.0.1/x"%3Bdrop_test'), /_test/);
  assert.throws(() => disposableTarget(undefined), /TEST_DATABASE_URL/);
  assert.equal(disposableTarget("postgres://u@[::1]:5433/harness_test").name, "harness_test");
  const refused = cli("reset", hosted);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /only loopback/);
});

test(
  "reset refuses an attached workflow and recreates an idle database",
  { skip: !url },
  async () => {
    const sibling = new URL(url);
    sibling.pathname = "/signal_desk_lever_test";
    await reset(sibling.toString());
    assert.deepEqual(await inspect(sibling.toString()), {
      sessions: [],
      leftovers: [],
      lockHolder: null,
      exists: true,
    });
    const other = new pg.Client({
      connectionString: sibling.toString(),
      application_name: "harness",
    });
    await other.connect();
    try {
      await other.query("create schema signal_desk; create table signal_desk.budgets(scope text)");
      await other.query("insert into signal_desk.budgets values ('installation'),('user')");
      await other.query("select pg_advisory_lock(73002)");
      const busy = await inspect(sibling.toString());
      assert.deepEqual(busy.leftovers, [{ table: "signal_desk.budgets", rows: 2 }]);
      assert.equal(busy.lockHolder, other.processID);
      assert.deepEqual(
        busy.sessions.map(({ pid, application }) => ({ pid, application })),
        [{ pid: other.processID, application: "harness" }],
      );
      assert.equal(isClean(busy), false);
      await assert.rejects(reset(sibling.toString()), /another workflow is connected/);
      const kept = await other.query("select count(*)::int as rows from signal_desk.budgets");
      assert.equal(kept.rows[0].rows, 2);
    } finally {
      await other.end();
    }
    const left = cli("status", sibling.toString());
    assert.equal(left.status, 1);
    assert.equal(left.stdout, "Leftover: signal_desk.budgets has 2 row(s)\n");
    assert.equal(cli("reset", sibling.toString()).status, 0);
    const clean = cli("status", sibling.toString());
    assert.equal(clean.status, 0);
    assert.match(clean.stdout, /holds no fixture rows/);
    const admin = new pg.Client({
      connectionString: disposableTarget(sibling.toString()).admin.toString(),
    });
    await admin.connect();
    await admin.query("drop database signal_desk_lever_test");
    await admin.end();
  },
);
