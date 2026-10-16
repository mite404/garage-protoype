import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const coverage = fileURLToPath(new URL("../coverage/", import.meta.url));
rmSync(coverage, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "--test", "src/**/*.test.ts"],
  { stdio: "inherit", env: { ...process.env, NODE_V8_COVERAGE: coverage } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
