import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getWorkbench } from "@/server/evidence";
import { getAssistance } from "@/server/assistance";
import { AppError } from "@/server/errors";
import EvidenceWorkbench from "./workbench";
import Conversation from "./conversation";
import { readStreams } from "@/server/streaming";

export const dynamic = "force-dynamic";

/** Renders only a freshly authorized specialist's opportunity evidence. */
export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  let view;
  let assistance;
  let streams;
  try {
    const actor = await requireActor();
    const { id } = await params;
    assistance = await getAssistance(actor, id);
    view = await getWorkbench(actor, id);
    streams = await readStreams(actor, id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <section>
        <p className="eyebrow mb-4">Private evidence workspace</p>
        <h1>Record unavailable.</h1>
        <p className="mt-6">{error.message} No private evidence is shown.</p>
        <Link className="button mt-6" href="/sign-in">
          Go to sign-in
        </Link>
      </section>
    );
  }
  return (
    <EvidenceWorkbench
      view={view}
      conversation={
        <Conversation view={assistance} photoRequest={view.photoRequest} initialStreams={streams} />
      }
    />
  );
}
