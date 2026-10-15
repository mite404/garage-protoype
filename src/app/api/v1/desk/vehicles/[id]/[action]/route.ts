import { requireActor, requireSameOrigin } from "@/server/auth";
import { requireOpportunity } from "@/server/access";
import { AppError, failure, success } from "@/server/errors";
import { addSource, parseEvidence, reviewEvidence } from "@/server/evidence";
import { queueImport, loadSavedEvidence } from "@/server/imports";
import { boundedBody, sourceUpload } from "@/server/evidence-http";
import { z } from "zod";

/** Performs bounded source, import and review operations for an explicitly linked opportunity. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    const actor = await requireActor();
    requireSameOrigin(request);
    const { id, action } = await params;
    const opportunityId = parseEvidence(
      z.string().min(1).max(200),
      new URL(request.url).searchParams.get("opportunityId"),
    );
    const opportunity = await requireOpportunity(actor, opportunityId, "specialist");
    if (opportunity.vehicle_id !== id) throw new AppError(404, "NOT_FOUND", "Vehicle not found.");
    if (action === "sources")
      return success(await addSource(actor, opportunityId, await sourceUpload(request)));
    if (action === "saved-example") return success(await loadSavedEvidence(actor, opportunityId));
    const body = await (await boundedBody(request, 20000)).json().catch(() => {
      throw new AppError(422, "INVALID_INPUT", "Provide a JSON command.");
    });
    if (action === "imports") {
      const model = process.env.EVIDENCE_MODEL;
      if (!model)
        throw new AppError(
          503,
          "NOT_CONFIGURED",
          "Arbitrary extraction is unavailable. No evidence model is configured.",
        );
      const input = parseEvidence(
        z.object({ sourceIds: z.array(z.string()).min(1).max(20) }).strict(),
        body,
      );
      const key = parseEvidence(z.string().min(1).max(150), request.headers.get("Idempotency-Key"));
      return success(await queueImport(actor, opportunityId, { ...input, model, key }));
    }
    if (action === "reviews") {
      const match = request.headers.get("If-Match");
      if (!match || !/^"\d+"$/.test(match))
        throw new AppError(412, "STALE_REVIEW", "A current quoted revision is required.");
      return success(await reviewEvidence(actor, opportunityId, Number(match.slice(1, -1)), body));
    }
    throw new AppError(404, "NOT_FOUND", "Operation not found.");
  } catch (error) {
    return failure(error);
  }
}
