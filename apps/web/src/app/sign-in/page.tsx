import { authConfigured } from "@/server/auth";
import { Button } from "@signal-desk/ui/components/ui/button";
import { Input } from "@signal-desk/ui/components/ui/input";
import { Label } from "@signal-desk/ui/components/ui/label";

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
      <p className="mb-8 text-muted-foreground">
        Use the individual account provided by your prototype operator. There is no public
        registration.
      </p>
      <div className="panel">
        {!configured && (
          <output className="mb-6 block rounded-md border border-border bg-muted p-4 text-sm text-foreground">
            Sign-in is not configured yet. No live authentication or processing is available.
          </output>
        )}
        {error && (
          <p role="alert" className="mb-6 text-sm text-destructive">
            {error === "access"
              ? "This account does not have active application access."
              : "Sign-in failed. Check your credentials and try again."}
          </p>
        )}
        <form action="/auth/sign-in" method="post" className="space-y-5">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={!configured}
            />
          </div>
          <Button type="submit" className="min-h-11 w-full" disabled={!configured}>
            Sign in
          </Button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Need access? Contact your prototype operator. An account alone does not grant spending
          permission.
        </p>
      </div>
    </section>
  );
}
