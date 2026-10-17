import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes SSR cookies only. Each operation independently enforces authorization. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "no-store");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values, headers) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        response.headers.set("Cache-Control", "no-store");
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = { matcher: ["/desk/:path*", "/sign-in", "/auth/:path*", "/api/:path*"] };
