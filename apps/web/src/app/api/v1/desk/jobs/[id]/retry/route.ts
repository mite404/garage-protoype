import { requireHttpActor } from "@/server/auth";
import { failure, success } from "@/server/errors";
import { retryImport } from "@/server/imports";

/** Requeues a failed import without discarding uncertain spending or original evidence. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request, true);
    return success(await retryImport(actor, (await params).id));
  } catch (error) {
    return failure(error);
  }
}
