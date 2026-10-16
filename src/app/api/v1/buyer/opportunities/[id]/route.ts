import { requireActor } from "@/server/auth";
import { requireOpportunity } from "@/server/access";
import { failure, success } from "@/server/errors";

/** Returns only the owning buyer's record reference, never internal notes. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const record = await requireOpportunity(await requireActor(), (await params).id, "buyer");
    return success({ id: record.id, vehicleId: record.vehicle_id });
  } catch (error) {
    return failure(error);
  }
}
