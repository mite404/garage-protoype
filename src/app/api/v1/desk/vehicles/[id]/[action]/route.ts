import { requireActor, requireSameOrigin } from "@/server/auth";
import { requireSpending } from "@/server/access";
import { AppError, failure } from "@/server/errors";

/** Denies processing until the spending-admission and evidence units implement it. */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    requireSameOrigin(request);
    await requireSpending(actor);
    throw new AppError(
      503,
      "PROCESSING_DISABLED",
      "Uploads and processing are not enabled in this foundation.",
    );
  } catch (error) {
    return failure(error);
  }
}
