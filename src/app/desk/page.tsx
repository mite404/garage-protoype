import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listEvidenceOpportunities } from "@/server/evidence";

export const dynamic = "force-dynamic";

/** Checks access server-side before rendering any private workspace content. */
export default async function Desk() {
  let actor;
  let opportunities;
  try {
    actor = await requireActor();
    opportunities = await listEvidenceOpportunities(actor);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section className="max-w-xl">
        <p className="eyebrow mb-4">Private workspace</p>
        <h1>Access required.</h1>
        <output className="mt-6 block text-stone-600">
          {error.message} No private records have been loaded.
        </output>
        <Link className="button mt-8" href="/sign-in">
          Go to sign-in
        </Link>
      </section>
    );
  }
  return (
    <section className="max-w-2xl">
      <p className="eyebrow mb-4">{actor.role} workspace</p>
      <h1>Move the next decision forward.</h1>
      <p className="mt-6 text-stone-600">
        Inspect original sources, resolve conflicting claims and keep the buyer's blocker in view.
        Your record access is checked on every operation.
      </p>
      {opportunities.length === 0 && (
        <p className="panel mt-8">No specialist opportunities are assigned to this account.</p>
      )}
      {opportunities.map((opportunity) => (
        <Link
          className="panel mt-6 block"
          key={opportunity.id}
          href={`/desk/opportunities/${encodeURIComponent(opportunity.id)}`}
        >
          <h2>{opportunity.title}</h2>
          <p className="mt-2 text-sm text-stone-600">
            {opportunity.nextAction || "Open evidence review"}
          </p>
          <p className="mt-4 text-sm font-semibold text-orange-800">Review source packet →</p>
        </Link>
      ))}
      <form action="/auth/sign-out" method="post" className="mt-8">
        <button className="button">Sign out</button>
      </form>
    </section>
  );
}
