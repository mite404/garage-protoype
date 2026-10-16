import { requireActor, requireSameOrigin } from "@/server/auth";
import { requireSpending } from "@/server/access";
import { AppError, failure } from "@/server/errors";

/** Denies inquiries until buyer operations and durable spending admission exist. */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    requireSameOrigin(request);
    await requireSpending(actor);
    throw new AppError(
      503,
      "PROCESSING_DISABLED",
      "Buyer inquiries are not enabled in this foundation.",
    );
  } catch (error) {
    return failure(error);
  }
}
