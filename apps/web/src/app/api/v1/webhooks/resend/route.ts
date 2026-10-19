import { receiveResendEvent } from "@/server/growth-integrations";
import { failure, success } from "@/server/errors";
import { boundedBody } from "@/server/evidence-http";

/** Accepts signed Resend events only; no browser or invitation reference grants write access. */
export async function POST(request: Request) {
  try {
    const raw = await (await boundedBody(request, 1000000)).text();
    return success(await receiveResendEvent(raw, request.headers));
  } catch (error) {
    return failure(error);
  }
}
