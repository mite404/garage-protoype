import { extractText, getDocumentProxy } from "unpdf";
import { AppError } from "./errors";

const maxPages = 500;

const unreadable = () =>
  new AppError(422, "PDF_UNREADABLE", "PDF could not be read. Scanned PDF OCR is not supported.");

/** Extracts each page's text layer with PDF.js, which runs on Node and Workers alike. Pages
 * without text come back empty, so callers decide what counts as unreadable.
 * @throws {AppError} INVALID_PDF without a PDF header, TOO_LARGE past 500 pages before any text
 * is extracted, PDF_UNREADABLE when parsing fails.
 */
export async function pdfPages(content: Uint8Array) {
  if (new TextDecoder().decode(content.subarray(0, 5)) !== "%PDF-")
    throw new AppError(415, "INVALID_PDF", "Provide a text-based PDF.");
  const pdf = await getDocumentProxy(new Uint8Array(content)).catch(() => {
    throw unreadable();
  }); // → PDFDocumentProxy
  // Reading the page tree is cheap; extracting 778 pages costs about 1.5 s of CPU.
  if (pdf.numPages > maxPages)
    throw new AppError(413, "TOO_LARGE", `Source exceeds ${maxPages} pages.`);
  const { text } = await extractText(pdf, { mergePages: false }).catch(() => {
    throw unreadable();
  }); // → string[]
  return text;
}
