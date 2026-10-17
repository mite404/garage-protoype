import Link from "next/link";
import { requireActor } from "@/server/auth";
import { listTokens } from "@/server/tokens";
import { AppError } from "@/server/errors";
import Tokens from "./tokens";

export const dynamic = "force-dynamic";

/** Renders token controls only for a current interactive specialist session. */
export default async function TokenPage() {
  let actor;
  let tokens;
  try {
    actor = await requireActor();
    tokens = await listTokens(actor);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section className="max-w-xl">
        <h1>Specialist access required.</h1>
        <p className="mt-6">{error.message}</p>
        <Link className="button mt-6" href="/sign-in">
          Go to sign-in
        </Link>
      </section>
    );
  }
  return (
    <section className="max-w-2xl">
      <Link href="/desk" className="text-sm text-primary">
        ← Specialist workspace
      </Link>
      <p className="eyebrow mt-8 mb-4">Local MCP access</p>
      <h1>Connect your terminal.</h1>
      <p className="mt-5 text-muted-foreground">
        Tokens can access only your assigned records. Start read-only. Write and processing
        permissions are separate choices. No token can approve evidence or send messages.
      </p>
      <Tokens initialTokens={tokens} canSpend={actor.canSpend} />
    </section>
  );
}
