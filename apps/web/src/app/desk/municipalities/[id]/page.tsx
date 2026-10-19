import Link from "next/link";
import MunicipalityWorkspace from "@signal-desk/catalog/municipality-workspace";
import { requireActor } from "@/server/auth";
import { getMunicipalityWorkspace } from "@/server/municipalities";
import { readStreams } from "@/server/streaming";
import { getOrganizationGrowth } from "@/server/growth-views";
import { GrowthSummary } from "../../growth-profile";
import { AppError } from "@/server/errors";
import SaleChat from "./sale-chat";

export const dynamic = "force-dynamic";

/** Loads authorized municipality data and renders its shared catalog presentation. */
export default async function MunicipalityPage({ params }: { params: Promise<{ id: string }> }) {
  let workspace;
  let streams;
  let growth;
  try {
    const actor = await requireActor();
    workspace = await getMunicipalityWorkspace(actor, (await params).id);
    streams = await readStreams(actor, workspace.acquisitions[0].id);
    growth =
      actor.role === "specialist"
        ? await getOrganizationGrowth(actor, workspace.organization.id)
        : null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <main id="main-content" className="municipal-main py-10">
        <h1>Department unavailable.</h1>
        <p className="mt-4">{error.message} No private records have been loaded.</p>
        <Link className="quiet-button mt-6" href="/desk">
          Back to departments
        </Link>
      </main>
    );
  }
  const { organization, acquisitions } = workspace;
  return (
    <MunicipalityWorkspace
      workspace={workspace}
      enrichment={growth ? <GrowthSummary profile={growth} /> : undefined}
      chat={
        <SaleChat
          opportunityId={acquisitions[0].id}
          context={`${organization.city} · ${organization.unit || organization.name}`}
          initialStreams={streams}
        />
      }
    />
  );
}
