import { requireActor } from "@/server/auth";
import { requireOpportunity } from "@/server/access";
import { failure, success } from "@/server/errors";

/** Reads private specialist context only after fresh membership checks. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return success(await requireOpportunity(await requireActor(), (await params).id, "specialist"));
  } catch (error) {
    return failure(error);
  }
}
