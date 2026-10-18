// Compares pdftotext with the unpdf extractor on the frozen extraction corpora and the full seller
// fixtures: page counts, whether each gold excerpt still occurs exactly once on its cited page
// (the worker's locator rule), extraction time, and a whitespace-insensitive text match.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";
import { corpusSchema, type Packet } from "../src/server/extraction-scoring";
import { documentBytes } from "../src/server/extraction-fixtures";

const exec = promisify(execFile);
const corpora = ["corpus.json", "public-documents.json"].map(
  (name) => new URL(`../src/server/extraction-corpus/${name}`, import.meta.url),
);
const fixtures = [
  "HME-Wildland-Type1.pdf",
  "MiniPumper_Sierra_Brochure2025.pdf",
  "TM-5-4210-220-12.pdf",
];
const fixtureDir = new URL("../../../fixtures/seller-documents/", import.meta.url);

// Raw unpdf, the same calls as pdf-text.ts without its page limit, so oversized fixtures compare too.
async function unpdfPages(content: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(content)); // → PDFDocumentProxy
  return (await extractText(pdf, { mergePages: false })).text; // → string[]
}

const squash = (text: string) => text.replace(/\s+/g, "");
const occurrences = (page: string, excerpt: string) => page.split(excerpt).length - 1;

async function popplerPages(content: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "compare-pdf-"));
  try {
    await writeFile(join(dir, "source.pdf"), content);
    const { stdout } = await exec(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", join(dir, "source.pdf"), "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const pages = stdout.split("\f");
    if (!pages.at(-1)?.trim()) pages.pop();
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

async function compareDocument(packet: Packet, doc: Packet["documents"][number]) {
  const { content, mediaType } = await documentBytes(doc);
  if (mediaType !== "application/pdf") return null;
  const poppler = await timed(() => popplerPages(content)); // → string[]
  const js = await timed(() => unpdfPages(content)); // → string[]
  const claims = packet.claims.filter((claim) => claim.document === doc.id && claim.excerpt);
  const unique = (pages: string[]) =>
    claims.filter((claim) => occurrences(pages[claim.page - 1] ?? "", claim.excerpt!) === 1).length;
  return {
    packet: packet.id,
    document: doc.id,
    format: doc.format,
    pages: `${poppler.value.length}/${js.value.length}`,
    textChars: `${squash(poppler.value.join("")).length}/${squash(js.value.join("")).length}`,
    sameTextIgnoringSpace: squash(poppler.value.join("")) === squash(js.value.join("")),
    goldExcerpts: claims.length,
    uniquePoppler: unique(poppler.value),
    uniqueUnpdf: unique(js.value),
    ms: `${poppler.ms}/${js.ms}`,
  };
}

async function compareFixture(name: string) {
  const content = await readFile(new URL(name, fixtureDir));
  const poppler = await timed(() => popplerPages(content));
  const js = await timed(() => unpdfPages(content));
  const empty = (pages: string[]) => pages.filter((page) => !page.trim()).length;
  return {
    fixture: name,
    pages: `${poppler.value.length}/${js.value.length}`,
    emptyPages: `${empty(poppler.value)}/${empty(js.value)}`,
    textChars: `${squash(poppler.value.join("")).length}/${squash(js.value.join("")).length}`,
    ms: `${poppler.ms}/${js.ms}`,
  };
}

const rows = [];
for (const url of corpora) {
  const corpus = corpusSchema.parse(JSON.parse(await readFile(url, "utf8")));
  for (const packet of corpus.packets)
    for (const doc of packet.documents) {
      const row = await compareDocument(packet, doc);
      if (row) rows.push(row);
    }
}
console.log("Labeled PDFs (pdftotext/unpdf):");
console.table(rows);
console.log("Full seller fixtures (pdftotext/unpdf):");
console.table(await Promise.all(fixtures.map(compareFixture)));
