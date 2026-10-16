import { getPublicVehicle } from "@/server/records";
import { AppError } from "@/server/errors";

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
        <output className="mt-6 block text-stone-600">
          {error.message} No private evidence is shown.
        </output>
      </section>
    );
  }
  return (
    <section>
      <p className="eyebrow mb-4">Approved public record</p>
      <h1>{vehicle.title}</h1>
      <p className="mt-4 text-sm text-stone-500">{vehicle.prototypeLabel}</p>
      <div className="panel mt-8 max-w-3xl">
        <h2>Reviewed specifications</h2>
        {vehicle.facts.length === 0 && (
          <p className="mt-4 text-stone-600">No shareable facts have been approved yet.</p>
        )}
        <dl className="mt-4 divide-y divide-stone-200">
          {vehicle.facts.map((fact) => (
            <div key={fact.field} className="grid gap-2 py-5 sm:grid-cols-[140px_1fr]">
              <dt className="text-sm capitalize text-stone-500">{fact.field}</dt>
              <dd>
                <strong>{fact.value}</strong>
                <p className="mt-1 text-xs text-stone-500">
                  {fact.citation.sourceLabel} · {fact.citation.excerpt}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-6 text-sm text-stone-600">
        Photo coverage has not been reviewed. This record makes no claim about mechanical condition
        or safety.
      </p>
    </section>
  );
}
