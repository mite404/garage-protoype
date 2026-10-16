import Link from "next/link";

/** Offers read-only evidence separately from invited workspace access. */
export default function Home() {
  return (
    <div className="grid items-start gap-12 md:grid-cols-[1.3fr_1fr]">
      <section className="max-w-xl py-5">
        <p className="eyebrow mb-5">Vehicle evidence, before the next step</p>
        <h1>
          Resolve the unknowns.
          <br />
          Keep people in control.
        </h1>
        <p className="mt-6 max-w-lg text-stone-600">
          A focused workspace for reviewing vehicle evidence and resolving buyer questions. Only
          approved, shareable facts reach the public record.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link className="button" href="/sign-in">
            Open your workspace
          </Link>
          <Link
            href="/vehicles/demo-pumper"
            className="text-sm font-semibold underline underline-offset-4"
          >
            View synthetic vehicle record
          </Link>
        </div>
      </section>
      <aside className="panel mt-5">
        <p className="eyebrow mb-5">Access by invitation</p>
        <h2>Evidence stays in its lane.</h2>
        <ul className="mt-6 space-y-5 text-sm text-stone-600">
          <li>
            <strong className="block text-stone-900">Public record</strong>Approved facts and
            permitted excerpts. No account required.
          </li>
          <li>
            <strong className="block text-stone-900">Private workspace</strong>Invited buyers and
            assigned specialists only.
          </li>
          <li>
            <strong className="block text-stone-900">Processing access</strong>Separate permission
            and budget checks. Disabled in this foundation.
          </li>
        </ul>
      </aside>
    </div>
  );
}
