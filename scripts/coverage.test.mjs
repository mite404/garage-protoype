import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSourceMaps } from "./coverage.mjs";

test("V8 maps resolve literal route URLs without changing execution evidence", () => {
  const script = "file:///repo/.next/server/[id]/chunk.js";
  const entry = {
    data: {
      sources: ["file:///repo/src/%5Bid%5D/a%20b.tsx", "webpack://unchanged/%5Bid%5D"],
      mappings: "AAAA",
      sourcesContent: ["export const answer = 42;"],
    },
  };
  const dump = {
    result: [
      { url: script, functions: [{ ranges: [{ startOffset: 0, endOffset: 42, count: 3 }] }] },
    ],
    "source-map-cache": { "file:///repo/.next/server/%5Bid%5D/chunk.js": entry },
  };
  const execution = structuredClone(dump.result);
  normalizeSourceMaps(dump);
  assert.deepEqual(dump.result, execution);
  assert.deepEqual(dump["source-map-cache"][script], {
    data: {
      sources: ["file:///repo/src/[id]/a b.tsx", "webpack://unchanged/%5Bid%5D"],
      mappings: "AAAA",
      sourcesContent: ["export const answer = 42;"],
    },
  });
  const normalized = structuredClone(dump);
  normalizeSourceMaps(dump);
  assert.deepEqual(dump, normalized);
  assert.doesNotThrow(() => normalizeSourceMaps({ result: [] }));
});
