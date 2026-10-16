import { z } from "zod";
import { authClient, requireActor, requireSameOrigin } from "@/server/auth";
import { AppError, failure } from "@/server/errors";

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });

/** Signs in an operator-provisioned identity without offering public registration. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const form = await request.formData();
    const parsed = credentials.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) throw new AppError(422, "INVALID_INPUT", "Enter your email and password.");
    const client = await authClient();
    const { error } = await client.auth.signInWithPassword(parsed.data);
    if (error)
      return new Response(null, {
        status: 303,
        headers: { Location: "/sign-in?error=invalid", "Cache-Control": "no-store" },
      });
    try {
      await requireActor();
    } catch {
      await client.auth.signOut({ scope: "local" });
      return new Response(null, {
        status: 303,
        headers: { Location: "/sign-in?error=access", "Cache-Control": "no-store" },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { Location: "/desk", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
