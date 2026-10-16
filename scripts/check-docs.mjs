import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const errors = [];

for (const file of new Set(files)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (Array.from(line).length > 100) {
      errors.push(`${file}:${index + 1}: exceeds 100 columns`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Markdown line limits passed (${new Set(files).size} files).`);
}
