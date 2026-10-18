import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// `e2e init` writes and refreshes this skill; rewrapping it by hand would be overwritten.
const generatedDirs = [".agents/skills/e2e/"];
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file && !generatedDirs.some((dir) => file.startsWith(dir)));
const errors = [];

for (const file of new Set(files)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  let generated = false;
  for (const [index, line] of lines.entries()) {
    if (file === "AGENTS.md" && line === "<!-- BEGIN:turborepo-agent-rules -->") generated = true;
    if (!generated && Array.from(line).length > 100) {
      errors.push(`${file}:${index + 1}: exceeds 100 columns`);
    }
    if (line === "<!-- END:turborepo-agent-rules -->") generated = false;
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Markdown line limits passed (${new Set(files).size} files).`);
}
