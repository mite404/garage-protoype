import { requireActor } from "@/server/auth";
import { getSource } from "@/server/records";
import { failure } from "@/server/errors";

/** Downloads an authorized source as an attachment, never as active inline HTML. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const source = await getSource(await requireActor(), (await params).id);
    return new Response(new Uint8Array(source.content), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="source"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
