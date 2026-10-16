import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import ts from "typescript";

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(path) ? [path] : [];
  });

const imports = (path) => {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  return file.statements
    .filter((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    .map((node) => node.moduleSpecifier?.text)
    .filter(Boolean);
};

test("shared UI cannot reach the web app or server-only code", () => {
  for (const path of [...sources("packages/catalog/src"), ...sources("packages/ui/src")]) {
    for (const specifier of imports(path)) {
      assert.doesNotMatch(
        specifier,
        /^(?:@\/|next(?:\/|$)|server-only|.*apps\/web|.*src\/server)/,
        path,
      );
    }
  }
  assert.deepEqual(imports("packages/catalog/src/schema.ts"), [
    "@signal-desk/contracts/assistance-schema",
    "@signal-desk/contracts/assistance-schema",
  ]);
  assert.equal(readFileSync("packages/catalog/package.json", "utf8").includes('"./schema"'), true);
  for (const path of ["packages/catalog/src/schema.ts", ...sources("packages/contracts/src")]) {
    assert.ok(path.endsWith(".ts"), `${path} is not a React-free schema`);
    for (const specifier of imports(path)) {
      assert.doesNotMatch(
        specifier,
        /^(?:react|@signal-desk\/(?:catalog|ui)|next|server-only)/,
        path,
      );
    }
  }
});
