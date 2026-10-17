import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { boundedBody } from "@/server/evidence-http";
import { parseInput } from "@/server/validation";
import { cancelStream, readStreams, streamId, submitStream } from "@/server/streaming";
import { failure, success } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), message: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("cancel"), turnId: streamId }).strict(),
]);

/** Observes authorized persisted snapshots only. Disconnect never cancels execution. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request);
    const { id } = await context.params;
    const initial = await readStreams(actor, id);
    if (new URL(request.url).searchParams.get("view") === "snapshot") return success(initial);
    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const encode = new TextEncoder();
    const body = new ReadableStream({
      async start(stream) {
        let previous = JSON.stringify(initial);
        stream.enqueue(encode.encode(`data: ${previous}\n\n`));
        try {
          while (!controller.signal.aborted) {
            await setTimeout(350, undefined, { signal: controller.signal });
            const current = JSON.stringify(await readStreams(actor, id));
            if (controller.signal.aborted) break;
            if (current !== previous) {
              stream.enqueue(encode.encode(`data: ${current}\n\n`));
              previous = current;
            } else stream.enqueue(encode.encode(": observing\n\n"));
          }
        } catch {
          if (!controller.signal.aborted)
            stream.enqueue(encode.encode("event: denied\ndata: {}\n\n"));
        } finally {
          if (!controller.signal.aborted) stream.close();
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Separates idempotent admission and explicit cancellation from observation. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request, true);
    const { id } = await context.params;
    const input = parseInput(command, await (await boundedBody(request, 12000)).json());
    if (input.kind === "cancel") {
      await cancelStream(actor, id, input.turnId);
      return success({ cancelled: true });
    }
    return success(
      await submitStream(actor, id, input.message, request.headers.get("Idempotency-Key") ?? ""),
    );
  } catch (error) {
    return failure(error);
  }
}
