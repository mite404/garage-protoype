import "server-only";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { Actor } from "./access";
import { requireHttpActor } from "./auth";
import { AppError, failure, success } from "./errors";
import { boundedBody } from "./evidence-http";
import { streamId } from "./streaming";
import { parseInput } from "./validation";

type Context = { params: Promise<{ id: string }> };
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), message: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("cancel"), turnId: streamId }).strict(),
]);

// Serves authorized persisted snapshots as server-sent events, rereading through `read` so every
// update rechecks access. Disconnecting never cancels execution.
async function observeStreams(request: Request, read: () => Promise<unknown>) {
  const initial = await read();
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
          const current = JSON.stringify(await read());
          if (controller.signal.aborted) break;
          if (current !== previous) {
            stream.enqueue(encode.encode(`data: ${current}\n\n`));
            previous = current;
          } else stream.enqueue(encode.encode(": observing\n\n"));
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error instanceof AppError &&
          [401, 403, 404].includes(error.status)
        )
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
}

/** Route handlers for one subject's streamed assistant turns: GET observes persisted snapshots,
 * POST admits an idempotent turn or records explicit cancellation.
 */
export function streamRoute(subject: {
  read: (actor: Actor, id: string) => Promise<unknown>;
  submit: (actor: Actor, id: string, message: string, key: string) => Promise<unknown>;
  cancel: (actor: Actor, id: string, turnId: string) => Promise<unknown>;
}) {
  return {
    async GET(request: Request, context: Context) {
      try {
        const actor = await requireHttpActor(request);
        const { id } = await context.params;
        return await observeStreams(request, () => subject.read(actor, id));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request, context: Context) {
      try {
        const actor = await requireHttpActor(request, true);
        const { id } = await context.params;
        const input = parseInput(command, await (await boundedBody(request, 12000)).json());
        if (input.kind === "cancel") {
          await subject.cancel(actor, id, input.turnId);
          return success({ cancelled: true });
        }
        const key = request.headers.get("Idempotency-Key") ?? "";
        return success(await subject.submit(actor, id, input.message, key));
      } catch (error) {
        return failure(error);
      }
    },
  };
}
