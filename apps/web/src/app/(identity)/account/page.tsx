import Link from "next/link";
import { redirect } from "next/navigation";
import { authClient, requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Displays only the signed-in user's verified identity and current application access.
 * @throws If identity verification or application access checks are unavailable.
 */
export default async function Account() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/sign-in");
    if (error instanceof AppError && error.status === 403) redirect("/sign-in?error=access");
    throw error;
  }
  const client = await authClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.id !== actor.userId) redirect("/sign-in");
  return (
    <>
      <header className="sign-in-heading">
        <h1>Your account</h1>
        <p>Your verified identity and current application access.</p>
      </header>
      <dl className="account-details">
        <div>
          <dt>Email</dt>
          <dd>{data.user.email || "No email on record"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{actor.role === "specialist" ? "Sales specialist" : "Buyer"}</dd>
        </div>
        <div>
          <dt>Model spending</dt>
          <dd>{actor.canSpend ? "Enabled, subject to budget limits" : "Not enabled"}</dd>
        </div>
      </dl>
      <p className="sign-in-help">
        These details are read-only. Contact your prototype operator to change your account or
        access. Your role does not grant access to every opportunity.
      </p>
      <Link
        href={actor.role === "specialist" ? "/desk" : "/"}
        className="sign-in-submit sign-in-action"
      >
        {actor.role === "specialist" ? "Return to workspace" : "Back to overview"}
      </Link>
      <form action="/auth/sign-out" method="post" className="account-sign-out">
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}
