import { requireActor } from "@/server/auth";
import { requireOpportunity } from "@/server/access";
import { getAssistance } from "@/server/assistance";
import { AppError } from "@/server/errors";
import { BuyerAccessNotice } from "@/app/buyer-access-notice";
import BuyerConversation from "./questions";

export const dynamic = "force-dynamic";

/** Shows only this invited buyer's existing opportunity, never another buyer's negotiation. */
export default async function BuyerOpportunity({ params }: { params: Promise<{ id: string }> }) {
  let view;
  try {
    const actor = await requireActor();
    const { id } = await params;
    await requireOpportunity(actor, id, "buyer");
    view = await getAssistance(actor, id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <BuyerAccessNotice message={error.message} />;
  }
  return <BuyerConversation view={view} />;
}
