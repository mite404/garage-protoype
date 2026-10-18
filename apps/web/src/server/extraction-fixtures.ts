import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";
import { fixturePdf, type Packet } from "./extraction-scoring";
import { pdfPages } from "./pdf-text";

type Doc = Packet["documents"][number];

const exec = promisify(execFile);
const corpusDir = new URL("./extraction-corpus/", import.meta.url);
const publicDir = new URL("../../../../fixtures/seller-documents/", import.meta.url);

async function inTemp<T>(action: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "extraction-fixture-"));
  try {
    return await action(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cutPages(path: string, [first, last]: [number, number]) {
  return inTemp(async (dir) => {
    await exec("pdfseparate", ["-f", `${first}`, "-l", `${last}`, path, join(dir, "p%d.pdf")]);
    const parts = Array.from({ length: last - first + 1 }, (_, i) =>
      join(dir, `p${first + i}.pdf`),
    );
    await exec("pdfunite", [...parts, join(dir, "cut.pdf")]);
    return readFile(join(dir, "cut.pdf"));
  });
}

async function publicFile(doc: Doc) {
  const path = new URL(doc.file ?? "", publicDir);
  const content = await readFile(path);
  if (createHash("sha256").update(content).digest("hex") !== doc.sha256)
    throw new Error(`${doc.file} does not match its frozen checksum.`);
  return { path: path.pathname, content };
}

/** Returns the upload bytes for a labeled document: rendered synthetic text, the committed scan,
 * or a checksum-verified public fixture cut to its labeled page range.
 * @throws {Error} If a public fixture is missing or differs from its frozen checksum.
 */
export async function documentBytes(doc: Doc) {
  if (doc.format === "text")
    return { content: Buffer.from(doc.pages.join("\f")), mediaType: "text/plain" };
  if (doc.format === "text-pdf")
    return { content: fixturePdf(doc.pages), mediaType: "application/pdf" };
  if (doc.format === "scanned-pdf")
    return {
      content: await readFile(new URL(`${doc.fixture}.pdf`, corpusDir)),
      mediaType: "application/pdf",
    };
  const file = await publicFile(doc);
  const content = doc.pageRange ? await cutPages(file.path, doc.pageRange) : file.content;
  return { content, mediaType: "application/pdf" };
}

/** Returns a labeled document's page text as imports extract it, with `unpdf`. Public fixtures are
 * read whole and sliced to their labeled range: PDF.js extracts each page on its own, so this
 * matches extracting the cut file without needing poppler, and skips the import page limit.
 * @throws {Error} If a public fixture is missing or differs from its frozen checksum.
 */
export async function documentPages(doc: Doc) {
  if (doc.format === "text") return doc.pages;
  if (doc.format !== "file-pdf" && doc.format !== "image-pdf")
    return pdfPages((await documentBytes(doc)).content);
  const { content } = await publicFile(doc);
  const pdf = await getDocumentProxy(new Uint8Array(content)); // → PDFDocumentProxy
  const { text } = await extractText(pdf, { mergePages: false }); // → string[], one per page
  return doc.pageRange ? text.slice(doc.pageRange[0] - 1, doc.pageRange[1]) : text;
}

/** Renders each page of a checksum-verified public image PDF as a JPEG for image input, small
 * enough that a two-page brochure fits the 200 KB inference input limit.
 * @throws {Error} If the fixture differs from its frozen checksum or cannot be rendered.
 */
export async function pageImages(doc: Doc) {
  const file = await publicFile(doc);
  return inTemp(async (dir) => {
    await exec("pdftoppm", [
      "-r",
      "72",
      "-jpeg",
      "-jpegopt",
      "quality=60",
      file.path,
      join(dir, "page"),
    ]);
    const names = (await readdir(dir)).sort();
    return Promise.all(names.map((name) => readFile(join(dir, name))));
  });
}
