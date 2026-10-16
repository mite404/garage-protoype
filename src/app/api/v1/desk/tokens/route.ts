import { requireTokenManager } from "@/server/auth";
import { boundedBody } from "@/server/evidence-http";
import { listTokens, issueToken } from "@/server/tokens";
import { success, failure } from "@/server/errors";

/** Lists only the signed-in specialist's secret-free token metadata. */
export async function GET(request: Request) {
  try {
    return success(await listTokens(await requireTokenManager(request)));
  } catch (error) {
    return failure(error);
  }
}

/** Returns the token secret once to an authenticated same-origin specialist session. */
export async function POST(request: Request) {
  try {
    const actor = await requireTokenManager(request, true);
    return success(await issueToken(actor, await (await boundedBody(request, 4000)).json()));
  } catch (error) {
    return failure(error);
  }
}
