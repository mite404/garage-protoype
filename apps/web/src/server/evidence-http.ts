import "server-only";
import { AppError } from "./errors";

/** Bounds streamed request bodies before multipart or JSON parsing, including chunked uploads.
 * @throws {AppError} For a body exceeding the caller's fixed limit.
 */
export async function boundedBody(request: Request | Response, maxBytes: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxBytes) {
          await reader.cancel();
          throw new AppError(413, "TOO_LARGE", "Request body exceeds the upload limit.");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "application/json" },
  });
}

/** Decodes a bounded upload into untrusted input for addSource's authoritative validation.
 * @throws {AppError} For an oversized body; multipart decoding may also reject malformed data.
 */
export async function sourceUpload(request: Request) {
  const form = await (await boundedBody(request, 10600000)).formData();
  const upload = form.get("file");
  const file = upload instanceof File && upload.size ? upload : undefined;
  const text = form.get("text");
  return {
    name: form.get("name") || file?.name || "Seller note",
    mediaType: file?.type ?? "text/plain",
    content: file
      ? Buffer.from(await file.arrayBuffer())
      : Buffer.from(typeof text === "string" ? text : ""),
    kind: form.get("kind"),
    audience: form.get("audience") ?? "private",
    shareable: form.get("shareable") === "on",
    permission: form.get("permission"),
    provenance: form.get("provenance"),
    ...(form.get("blockerId") ? { blockerId: form.get("blockerId") } : {}),
  };
}
