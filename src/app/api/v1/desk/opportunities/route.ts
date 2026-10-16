import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { listEvidenceOpportunities, parseEvidence } from "@/server/evidence";
import { success, failure } from "@/server/errors";

/** Lists at most 100 currently assigned opportunities with an opaque last-ID cursor. */
export async function GET(request: Request) {
  try {
    const cursor = parseEvidence(
      z.string().max(200),
      new URL(request.url).searchParams.get("cursor") ?? "",
    );
    const items = await listEvidenceOpportunities(await requireHttpActor(request), cursor);
    return success({ items, nextCursor: items.length === 100 ? items.at(-1)?.id : null });
  } catch (error) {
    return failure(error);
  }
}
