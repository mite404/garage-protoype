import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { legacyBaseline } from "./migrations";

const folder = new URL("../../../../db/migrations/", import.meta.url);
const migrations = readMigrationFiles({ migrationsFolder: folder.pathname });
const legacy = [
  "001-foundation.sql",
  "002-inference.sql",
  "003-evidence.sql",
  "004-photos.sql",
  "005-assistance.sql",
  "006-app-tokens.sql",
  "007-streaming.sql",
  "008-session-access.sql",
  "009-municipality-workspace.sql",
  "010-stream-activity.sql",
];

test("legacy migration names line up with the first Drizzle Kit journal entries", async () => {
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", folder), "utf8"));
  const tags = journal.entries.slice(0, legacy.length).map((entry: { tag: string }) => entry.tag);
  assert.deepEqual(
    tags.map((tag: string) => tag.slice(5)),
    legacy.map((name) => name.slice(4, -4)),
  );
});

test("a database migrated by the legacy runner adopts only its leading applied run", () => {
  const records = migrations.map(({ hash, folderMillis }) => ({ hash, createdAt: folderMillis }));
  assert.deepEqual(legacyBaseline(migrations, [...legacy].reverse()), records.slice(0, 10));
  // A gap means later files never ran in order, so they must still be applied, not adopted.
  assert.deepEqual(
    legacyBaseline(migrations, [...legacy.slice(0, 3), legacy[4]!]),
    records.slice(0, 3),
  );
  assert.deepEqual(legacyBaseline(migrations, []), []);
});
