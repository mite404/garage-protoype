import Link from "next/link";
import { requireActor } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getSourcingAccount } from "@/server/sourcing";
import { readSourcingStreams } from "@/server/streaming";
import SourcingDesk from "./sourcing-desk";

export const dynamic = "force-dynamic";

/** Loads one owned sourcing case and its assistant history from saved, authorized records. */
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  let view;
  let streams;
  try {
    const actor = await requireActor();
    const { id } = await params;
    view = await getSourcingAccount(actor, id);
    streams = await readSourcingStreams(actor, id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <main id="main-content" className="municipal-main py-10">
        <h1>Sourcing case unavailable.</h1>
        <p className="mt-4">{error.message} No private records have been loaded.</p>
        <Link className="quiet-button mt-6" href="/desk/sourcing">
          Back to sourcing
        </Link>
      </main>
    );
  }
  return <SourcingDesk initial={view} streams={streams} />;
}
