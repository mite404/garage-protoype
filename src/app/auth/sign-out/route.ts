import { authClient, requireSameOrigin } from "@/server/auth";
import { AppError, failure } from "@/server/errors";

/** Ends the Supabase session so outstanding access tokens fail fresh session checks. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const client = await authClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new AppError(503, "SIGN_OUT_FAILED", "Could not end the session. Try again.");
    return new Response(null, {
      status: 303,
      headers: { Location: "/sign-in", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
