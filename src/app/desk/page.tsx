import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Checks access server-side before rendering any private workspace content. */
export default async function Desk() {
  let actor;
  try {
    actor = await requireActor();
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
      <h1>Access verified.</h1>
      <p className="mt-6 text-stone-600">
        Your private record access is checked on every operation. Evidence review and buyer
        workflows arrive in the next implementation units.
      </p>
      <div className="panel mt-8">
        <h2>Processing is not enabled.</h2>
        <p className="mt-2 text-stone-600">
          No uploads or model calls can run from this foundation.
        </p>
      </div>
      <form action="/auth/sign-out" method="post" className="mt-8">
        <button className="button">Sign out</button>
      </form>
    </section>
  );
}
