import { getPublicVehicle } from "@/server/records";
import Image from "next/image";
import Link from "next/link";
import { AppError } from "@/server/errors";
import { photoLabels } from "@signal-desk/contracts/photo-schema";

export const dynamic = "force-dynamic";

/** Renders the same allowlisted projection as the anonymous public HTTP read. */
export default async function Vehicle({ params }: { params: Promise<{ id: string }> }) {
  let vehicle;
  try {
    vehicle = await getPublicVehicle((await params).id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section className="max-w-xl">
        <p className="eyebrow mb-4">Public vehicle record</p>
        <h1>Record unavailable.</h1>
        <output className="mt-6 block text-muted-foreground">
          {error.message} No private evidence is shown.
        </output>
      </section>
    );
  }
  return (
    <section>
      <p className="eyebrow mb-4">Approved public record</p>
      <h1>{vehicle.title}</h1>
      <p className="mt-4 text-sm text-muted-foreground">{vehicle.prototypeLabel}</p>
      <Link className="button mt-5" href={`/buyer/vehicles/${encodeURIComponent(vehicle.id)}`}>
        Ask a question or record offer terms
      </Link>
      <p className="mt-2 text-xs text-muted-foreground">
        Invited buyer account required. No external sending or offer acceptance.
      </p>
      <div className="panel mt-8 max-w-3xl">
        <h2>Reviewed specifications</h2>
        {vehicle.facts.length === 0 && (
          <p className="mt-4 text-muted-foreground">No shareable facts have been approved yet.</p>
        )}
        <dl className="mt-4 divide-y divide-border">
          {vehicle.facts.map((fact) => (
            <div key={fact.field} className="grid gap-2 py-5 sm:grid-cols-[140px_1fr]">
              <dt className="text-sm capitalize text-muted-foreground">{fact.field}</dt>
              <dd>
                <strong>{fact.value}</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fact.citation.sourceLabel} · {fact.citation.excerpt}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <section className="panel mt-6 max-w-3xl" aria-labelledby="public-photos">
        <h2 id="public-photos">Approved photo evidence</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Only reviewed, permitted photos appear here. Missing means no approved readable view is
          available, not that a component is absent. This is not an inspection or safety assessment.
        </p>
        <ul className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {vehicle.coverage.map((c) => (
            <li key={c.view} className="text-sm">
              <strong className="block">{photoLabels[c.view]}</strong>
              <span className="text-muted-foreground">
                {c.state === "covered" ? "Reviewed readable" : "Missing"}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          {vehicle.photos.map((p) => (
            <figure key={p.id}>
              <Image
                unoptimized
                width={800}
                height={600}
                className="h-52 w-full rounded-md bg-muted object-contain"
                src={p.mediaUrl}
                alt={`${photoLabels[p.view]} supplied view`}
              />
              <figcaption className="mt-2 text-sm">
                {photoLabels[p.view]} · Reviewed readable
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </section>
  );
}
