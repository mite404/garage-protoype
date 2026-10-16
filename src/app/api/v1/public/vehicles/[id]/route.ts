import { getPublicVehicle } from "@/server/records";
import { failure, success } from "@/server/errors";

/** Reads the approved public projection without authentication or inference. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return success(await getPublicVehicle((await params).id));
  } catch (error) {
    return failure(error);
  }
}
