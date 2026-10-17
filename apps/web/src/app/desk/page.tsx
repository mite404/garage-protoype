import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listEvidenceOpportunities } from "@/server/evidence";
import { listMunicipalities } from "@/server/municipalities";

export const dynamic = "force-dynamic";

/** Checks access server-side before rendering any private workspace content. */
export default async function Desk() {
  let actor;
  let opportunities;
  let municipalities;
  try {
    actor = await requireActor();
    opportunities = await listEvidenceOpportunities(actor);
    municipalities = await listMunicipalities(actor);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section className="max-w-xl">
        <p className="eyebrow mb-4">Private workspace</p>
        <h1>Access required.</h1>
        <output className="mt-6 block text-muted-foreground">
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
      <h1>Municipal sales.</h1>
      <p className="mt-6 text-muted-foreground">
        Open a department to review its acquisition, purchase conditions and next sale blocker.
      </p>
      {municipalities.map((organization) => (
        <Link
          className="panel mt-6 block"
          key={organization.id}
          href={`/desk/municipalities/${encodeURIComponent(organization.id)}`}
        >
          <h2>{organization.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {organization.city}, {organization.region} · {organization.unit}
          </p>
          {organization.synthetic && (
            <p className="mt-3 text-xs text-muted-foreground">Synthetic demonstration</p>
          )}
        </Link>
      ))}
      {!municipalities.length && (
        <p className="mt-6 text-sm text-muted-foreground">
          No municipality profiles are linked to your assigned opportunities.
        </p>
      )}
      {opportunities.length === 0 && (
        <p className="panel mt-8">No specialist opportunities are assigned to this account.</p>
      )}
      <details className="mt-8">
        <summary className="cursor-pointer font-semibold">
          Evidence workbench ({opportunities.length})
        </summary>
        {opportunities.map((opportunity) => (
          <Link
            className="panel mt-6 block"
            key={opportunity.id}
            href={`/desk/opportunities/${encodeURIComponent(opportunity.id)}`}
          >
            <h2>{opportunity.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {opportunity.nextAction || "Open evidence review"}
            </p>
            <p className="mt-4 text-sm font-semibold text-primary">Review source packet →</p>
          </Link>
        ))}
      </details>
      {actor.role === "specialist" && (
        <Link className="quiet-button mt-8" href="/desk/tokens">
          Manage local MCP tokens
        </Link>
      )}
      <form action="/auth/sign-out" method="post" className="mt-8">
        <button className="button">Sign out</button>
      </form>
    </section>
  );
}
