import { authConfigured } from "@/server/auth";

/** Shows truthful configuration and sign-in failures without a demo bypass. */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = authConfigured();
  const { error } = await searchParams;
  return (
    <section className="mx-auto max-w-md">
      <p className="eyebrow mb-4">Invited workspace</p>
      <h1 className="mb-5">Welcome back.</h1>
      <p className="mb-8 text-stone-600">
        Use the individual account provided by your prototype operator. There is no public
        registration.
      </p>
      <div className="panel">
        {!configured && (
          <output className="mb-6 block rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Sign-in is not configured yet. No live authentication or processing is available.
          </output>
        )}
        {error && (
          <p role="alert" className="mb-6 text-sm text-red-800">
            {error === "access"
              ? "This account does not have active application access."
              : "Sign-in failed. Check your credentials and try again."}
          </p>
        )}
        <form action="/auth/sign-in" method="post" className="space-y-5">
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              disabled={!configured}
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={!configured}
            />
          </div>
          <button className="button w-full" disabled={!configured}>
            Sign in
          </button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-stone-500">
          Need access? Contact your prototype operator. An account alone does not grant spending
          permission.
        </p>
      </div>
    </section>
  );
}
