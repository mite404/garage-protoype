import { requireActor } from "@/server/auth";
import { getSource } from "@/server/records";
import { failure } from "@/server/errors";

/** Serves authorized photos inline; other originals download as attachments, never active HTML. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const source = await getSource(await requireActor(), (await params).id);
    const image = ["image/png", "image/jpeg"].includes(source.media_type);
    return new Response(new Uint8Array(source.content), {
      headers: {
        "Content-Type": image ? source.media_type : "application/octet-stream",
        "Content-Disposition": image ? "inline" : 'attachment; filename="source"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
