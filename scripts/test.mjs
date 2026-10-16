import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeSourceMaps } from "./coverage.mjs";

const coverage = fileURLToPath(new URL("../coverage/", import.meta.url));
rmSync(coverage, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "src/**/*.test.ts",
    "scripts/*.test.mjs",
  ],
  { stdio: "inherit", env: { ...process.env, NODE_V8_COVERAGE: coverage } },
);
if (result.error) throw result.error;
for (const name of readdirSync(coverage)) {
  const path = `${coverage}${name}`;
  const dump = JSON.parse(readFileSync(path, "utf8"));
  normalizeSourceMaps(dump);
  writeFileSync(path, JSON.stringify(dump));
}
process.exit(result.status ?? 1);
