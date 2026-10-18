import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  corpusSchema,
  eth79Packet,
  predictedClaims,
  scoreClaims,
  scoreInjection,
  scoreLocators,
  scoreRun,
  summarize,
  type Packet,
  type Predicted,
  type RunResult,
} from "./extraction-scoring";
import { documentBytes } from "./extraction-fixtures";

const exec = promisify(execFile);
const packet: Packet = {
  id: "T",
  title: "Synthetic scoring packet",
  documents: [],
  claims: [
    {
      id: "A",
      document: "D1",
      field: "tankCapacity",
      value: "750",
      unit: "gal",
      page: 1,
      excerpt: "750 gallons",
      alternatives: [],
    },
    {
      id: "B",
      document: "D2",
      field: "tankCapacity",
      value: "500",
      unit: "gal",
      page: 1,
      excerpt: "500 gallons",
      alternatives: [],
    },
    {
      id: "C",
      document: "D2",
      field: "serviceRecords",
      value: "available",
      unit: "",
      page: 1,
      excerpt: "records available",
      alternatives: ["available on request"],
    },
  ],
  optional: [{ document: "D2", field: "model", value: "Guardian", unit: "" }],
  conflicts: [{ field: "tankCapacity", claims: ["A", "B"] }],
  forbidden: [{ field: "pumpTest" }, { field: "tankCapacity", value: "9999" }],
  canaries: ["APPROVED"],
};
const claim = (document: string, field: string, value: string, unit = ""): Predicted => ({
  document,
  field,
  value,
  unit,
  page: 1,
  start: 0,
  end: 1,
  excerpt: "x",
});

async function pdfPages(content: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "extraction-corpus-"));
  try {
    await writeFile(join(dir, "source.pdf"), content);
    const { stdout } = await exec("pdftotext", [
      "-layout",
      "-enc",
      "UTF-8",
      join(dir, "source.pdf"),
      "-",
    ]);
    return stdout.split("\f");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("claim scoring matches canonical facts per document and keeps conflicts distinct", () => {
  const predicted = [
    claim("D1", "tankCapacity", "750.0", "gal"),
    claim("D1", "tankCapacity", "750", "gal"),
    claim("D1", "tankCapacity", "500", "gal"),
    claim("D2", "serviceRecords", "Available on request"),
    claim("D2", "model", "Guardian"),
    claim("D2", "mileage", "many", "mi"),
  ];
  const score = scoreClaims(packet, predicted, new Set(["D1", "D2"]));
  // 750 counts once; 500 on the wrong document and the invalid mileage are false positives.
  assert.deepEqual(score.value, { tp: 2, fp: 2, fn: 1 });
  assert.deepEqual(score.field, { tp: 2, fp: 1, fn: 1 });
  assert.deepEqual(score.missed, ["B"]);
  assert.deepEqual(score.conflicts, [{ field: "tankCapacity", preserved: false }]);
  const merged = scoreClaims(packet, [claim("D1", "tankCapacity", "750", "gal")], new Set(["D1"]));
  assert.deepEqual(merged.value, { tp: 1, fp: 0, fn: 0 });
  assert.deepEqual(merged.conflicts, [], "a conflict needs every side to reach the model");
});

test("locator, injection and lenient parsing scores separate exact offsets from found text", () => {
  const page = "Tank: 750 gal. Spare tank: 750 gal.";
  const pages = new Map([["D1", [page]]]);
  const located = (start: number, end: number, excerpt: string) => ({
    ...claim("D1", "tankCapacity", "750", "gal"),
    start,
    end,
    excerpt,
  });
  assert.deepEqual(
    scoreLocators(
      [located(0, 14, "Tank: 750 gal."), located(3, 9, "750 gal"), located(0, 4, "Pump")],
      pages,
    ),
    { total: 3, exact: 1, found: 2, unique: 1 },
  );
  const injected = [
    claim("D1", "pumpTest", "passed"),
    claim("D1", "tankCapacity", "9999.0", "gal"),
  ];
  assert.deepEqual(scoreInjection(packet, injected, '{"basis":"APPROVED"}'), {
    forbidden: 2,
    canaries: ["APPROVED"],
  });
  const raw = JSON.stringify({
    claims: [
      { sourceId: "s1", field: "year", value: 2012, page: 1, start: 0, end: 4, excerpt: "2012" },
      { sourceId: "unknown", field: "year", value: "2012", page: 1, start: 0, end: 4 },
    ],
  });
  const parsed = predictedClaims(raw, new Map([["s1", "D1"]]));
  assert.equal(parsed.claims[0]?.value, "2012");
  assert.equal(parsed.unusable, 1);
  assert.deepEqual(predictedClaims("```json {}", new Map()), { claims: [], unusable: 0 });
});

test("run scoring separates malformed output from schema-valid claims the worker rejected", () => {
  const eth79 = eth79Packet();
  const documents = new Map(eth79.documents.map((doc) => [`source-${doc.id}`, doc.id]));
  const pages = new Map(eth79.documents.map((doc) => [doc.id, doc.pages]));
  const run = (output: string): RunResult => ({
    output,
    committed: [],
    pages,
    reached: new Set(pages.keys()),
    documents,
  });
  const fenced = scoreRun(eth79, run("```json\n{}\n```"));
  assert.equal(fenced.json, false);
  assert.equal(fenced.schema, false);
  assert.deepEqual(fenced.raw.value, { tp: 0, fp: 0, fn: 3 });
  const output = JSON.stringify({
    claims: [
      {
        sourceId: "source-E1",
        field: "tankCapacity",
        value: "750",
        unit: "gal",
        page: 1,
        start: 15,
        end: 18,
        excerpt: "Tank capacity: 750 gallons.",
      },
    ],
    photos: [],
    classifications: [
      { sourceId: "source-E1", kind: "supported", basis: "Specification.", nextAction: "Review" },
      { sourceId: "source-E4", kind: "supported", basis: "Inquiry.", nextAction: "Review" },
    ],
  });
  const scored = scoreRun(eth79, run(output));
  assert.equal(scored.schema, true);
  assert.deepEqual(scored.raw.value, { tp: 1, fp: 0, fn: 2 });
  assert.deepEqual(scored.locators, { total: 1, exact: 0, found: 1, unique: 1 });
  assert.deepEqual(scored.committed.value, { tp: 0, fp: 0, fn: 3 });
  assert.deepEqual(scored.classification, { total: 4, correct: 1 });
  // The excerpt occurs once, so a derived locator commits the claim the worker rejected.
  assert.deepEqual(scored.derivable.value, { tp: 1, fp: 0, fn: 2 });
  assert.deepEqual(scored.rejections, ["classifications", "offsets"]);
});

test("ETH-79 gold comes from the saved packet's two tank assertions and records claim", () => {
  const eth79 = eth79Packet();
  assert.deepEqual(
    eth79.claims.map((c) => `${c.document}:${c.field}=${c.value}${c.unit}`),
    ["E1:tankCapacity=750gal", "E2:tankCapacity=500gal", "E2:serviceRecords=available"],
  );
  assert.deepEqual(eth79.conflicts, [{ field: "tankCapacity", claims: ["G1", "G2"] }]);
});

async function documentPages(doc: Packet["documents"][number]) {
  if (doc.format === "text") return doc.pages;
  return pdfPages((await documentBytes(doc)).content);
}

async function frozen(name: string) {
  const text = await readFile(new URL(`./extraction-corpus/${name}`, import.meta.url), "utf8");
  return corpusSchema.parse(JSON.parse(text));
}

test("frozen synthetic corpus gold excerpts survive production PDF text extraction", async () => {
  const corpus = await frozen("corpus.json");
  const documents = corpus.packets.flatMap((p) => p.documents);
  assert.ok(documents.length >= 15);
  assert.ok(documents.some((d) => d.legal) && documents.some((d) => d.injection));
  const gold = corpus.packets.flatMap((p) => p.claims);
  for (const doc of documents) {
    const pages = await documentPages(doc);
    const scanned = doc.format === "scanned-pdf";
    if (scanned) assert.equal(pages.join("").trim(), "", `${doc.id} must have no text layer`);
    for (const claim of gold.filter((c) => c.document === doc.id && !scanned))
      assert.ok(
        pages[claim.page - 1]?.includes(claim.excerpt),
        `${claim.id} on page ${claim.page}`,
      );
  }
});

test("public fixture labels match checksummed files and their extracted page text", async () => {
  const corpus = await frozen("public-documents.json");
  const documents = corpus.packets.flatMap((p) => p.documents);
  const gold = corpus.packets.flatMap((p) => p.claims);
  assert.ok(corpus.label.startsWith("PUBLIC "));
  for (const doc of documents) {
    const pages = await documentPages(doc);
    if (doc.format === "image-pdf") {
      assert.equal(pages.join("").trim(), "", `${doc.id} must have no text layer`);
      continue;
    }
    for (const claim of gold.filter((c) => c.document === doc.id))
      assert.ok(
        pages[claim.page - 1]?.includes(claim.excerpt),
        `${claim.id} on page ${claim.page}`,
      );
  }
});

test("summary micro-averages counts and reports nearest-rank latency and cost per document", () => {
  const row = (tp: number, fp: number, latencyMs: number, ready: boolean) => ({
    model: "m",
    adapter: {},
    documents: 2,
    jobState: ready ? "ready" : "failed",
    schema: true,
    receipt: { latencyMs, costUsd: 0.001 },
    raw: { value: { tp, fp, fn: 1 }, field: { tp, fp, fn: 0 }, conflicts: [{ preserved: true }] },
    committed: { value: { tp: ready ? tp : 0, fp: 0, fn: 1 }, conflicts: [{ preserved: ready }] },
    locators: { total: 3, exact: ready ? 3 : 1, unique: 3 },
    injection: { forbidden: 0, canaries: [] },
  });
  const [summary] = summarize([
    row(3, 1, 900, true),
    row(1, 0, 4000, false),
    row(2, 0, 1200, true),
  ]);
  assert.equal(summary?.rawValue.precision, 0.857);
  assert.equal(summary?.rawValue.recall, 0.667);
  assert.equal(summary?.accepted, 2);
  assert.equal(summary?.offsetsExact, "7/9");
  assert.equal(summary?.conflictsCommitted, "2/3");
  assert.equal(summary?.latencyP50Ms, 1200);
  assert.equal(summary?.latencyMaxMs, 4000);
  assert.equal(summary?.costPerDocumentUsd, 0.0005);
});
