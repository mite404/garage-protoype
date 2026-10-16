import { requireTokenManager } from "@/server/auth";
import { revokeToken } from "@/server/tokens";
import { success, failure } from "@/server/errors";

/** Revokes a token belonging to this same-origin specialist session. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return success(await revokeToken(await requireTokenManager(request, true), (await params).id));
  } catch (error) {
    return failure(error);
  }
}
