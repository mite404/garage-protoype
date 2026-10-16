import { getPublicPhoto } from "@/server/records";
import { failure } from "@/server/errors";

/** Serves only currently approved public photo bytes, with no private source metadata. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const photo = await getPublicPhoto((await params).id);
    return new Response(new Uint8Array(photo.content), {
      headers: {
        "Content-Type": photo.media_type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
