import { requireActor, requireSameOrigin } from "@/server/auth";
import { requireOpportunity } from "@/server/access";
import { submitInquiry, getAssistance } from "@/server/assistance";
import { boundedBody } from "@/server/evidence-http";
import { AppError, failure, success } from "@/server/errors";

async function target(request: Request, vehicleId: string) {
  const actor = await requireActor();
  const opportunityId = new URL(request.url).searchParams.get("opportunityId") ?? "";
  const opportunity = await requireOpportunity(actor, opportunityId, "buyer");
  if (opportunity.vehicle_id !== vehicleId)
    throw new AppError(404, "NOT_FOUND", "Record not found.");
  return { actor, opportunityId };
}

/** Returns only the invited buyer's own conversation and currently supported answers. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { actor, opportunityId } = await target(request, (await context.params).id);
    return success(await getAssistance(actor, opportunityId));
  } catch (error) {
    return failure(error);
  }
}

/** Records structured terms or a bounded question, never external delivery or paid inference. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { actor, opportunityId } = await target(request, (await context.params).id);
    requireSameOrigin(request);
    const input = await (await boundedBody(request, 16000)).json();
    return success(
      await submitInquiry(
        actor,
        opportunityId,
        input,
        request.headers.get("Idempotency-Key") ?? "",
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
