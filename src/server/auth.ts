import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";
import type { PoolClient } from "pg";
import { resolveActor } from "./access";
import { AppError } from "./errors";

/** Reports configuration only, never credentials. */
export function authConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

/** Creates a request-scoped Supabase SSR client; privileged keys are never used here.
 * @throws {AppError} If prototype authentication is not configured.
 */
export async function authClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new AppError(503, "NOT_CONFIGURED", "Prototype sign-in is not configured.");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) jar.set(name, value, options);
        } catch {
          /* Server components are read-only; proxy persists refreshed cookies. */
        }
      },
    },
  });
}

/** Verifies token claims and current Supabase identity, then reloads application access.
 * Never accepts a user ID, role, or metadata supplied by a caller.
 * @throws {AppError} If no valid invited session exists.
 */
export async function requireActor(client?: PoolClient) {
  const jar = await cookies();
  if (!jar.getAll().some((cookie) => cookie.name.startsWith("sb-")))
    throw new AppError(401, "UNAUTHENTICATED", "Sign in with an invited account.");
  const supabase = await authClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = z
    .object({ sub: z.uuid(), session_id: z.uuid(), exp: z.number() })
    .safeParse(data?.claims);
  if (error || !claims.success || claims.data.exp * 1000 <= Date.now())
    throw new AppError(401, "UNAUTHENTICATED", "Session has expired or is invalid.");
  const user = await supabase.auth.getUser();
  if (
    user.error ||
    !user.data.user ||
    user.data.user.id !== claims.data.sub ||
    user.data.user.is_anonymous
  )
    throw new AppError(401, "UNAUTHENTICATED", "Session has expired or is invalid.");
  return resolveActor({ userId: user.data.user.id, sessionId: claims.data.session_id }, client);
}

/** Rejects cross-site browser mutations before authentication or side effects.
 * @throws {AppError} If Origin does not match the configured application origin.
 */
export function requireSameOrigin(request: Request) {
  if (
    !process.env.APP_ORIGIN ||
    request.headers.get("origin") !== new URL(process.env.APP_ORIGIN).origin
  )
    throw new AppError(403, "ORIGIN_DENIED", "Request origin is not permitted.");
}
