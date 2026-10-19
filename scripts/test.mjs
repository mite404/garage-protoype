import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeSourceMaps } from "./coverage.mjs";
import { describe, inspect, isClean } from "./test-database.mjs";

const coverage = fileURLToPath(new URL("../coverage/", import.meta.url));
const database = process.env.TEST_DATABASE_URL;
const resetHint = "Stop the workflow that owns it, then run `npm run db:test:reset`.";

// Fixtures use fixed IDs and installation-wide rows, so a database another workflow left
// populated fails later tests with misleading constraint and count errors.
if (database) {
  const report = await inspect(database);
  if (!isClean(report)) {
    console.error(
      `The test database is in use or holds fixtures.\n${describe(report)}\n${resetHint}`,
    );
    process.exit(1);
  }
}
rmSync(coverage, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "apps/web/src/**/*.test.ts",
    "packages/*/src/**/*.test.ts",
    "scripts/*.test.mjs",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      POSTHOG_ENABLED: "false",
      NEXT_PUBLIC_POSTHOG_ENABLED: "false",
      NODE_V8_COVERAGE: coverage,
      TSX_TSCONFIG_PATH: fileURLToPath(new URL("../apps/web/tsconfig.json", import.meta.url)),
    },
  },
);
if (result.error) throw result.error;
for (const name of readdirSync(coverage)) {
  const path = `${coverage}${name}`;
  const dump = JSON.parse(readFileSync(path, "utf8"));
  normalizeSourceMaps(dump);
  writeFileSync(path, JSON.stringify(dump));
}
let status = result.status ?? 1;
if (database) {
  const report = await inspect(database);
  // This run's files have exited, so a lock holder is another workflow whose rows are not ours.
  if (report.lockHolder)
    console.error(
      `Skipped the leak check: another workflow owns the database.\n${describe(report)}`,
    );
  else if (!isClean(report)) {
    const verdict = status
      ? "Failed tests left fixtures behind."
      : "Passing tests leaked fixtures.";
    console.error(`${verdict}\n${describe(report)}\n${resetHint}`);
    if (!status) status = 1;
  }
}
process.exit(status);
