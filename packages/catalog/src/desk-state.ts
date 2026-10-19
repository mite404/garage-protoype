import type { SourcingAccount } from "@signal-desk/contracts/sourcing-schema";

/** Ordered review steps, not authorization to deliver a message. */
export const outreachSteps = ["Contact review", "Draft review", "Delivery", "Reply"] as const;

/** Latest reached step from persisted records; replies never imply reviewed contact permission. */
export function outreachStep(
  data: Pick<SourcingAccount, "contact" | "outreach" | "replies" | "facts">,
): number {
  if (data.replies.length || data.facts.some((fact) => fact.status === "proposed")) return 3;
  if (!["none", "draft"].includes(data.outreach.state)) return 2;
  if (
    data.outreach.state === "draft" ||
    (data.contact.identity === "reviewed" && data.contact.permission === "established")
  )
    return 1;
  return 0;
}

/** Navigation for the next review; all fit decisions remain in sourcing-schema. */
export function pairingAction(data: SourcingAccount) {
  if (data.facts.some((fact) => fact.status === "proposed"))
    return { tab: "outreach", step: 3, label: "Review reply" } as const;
  if (data.decision) return { tab: "fit", label: "Open decision" } as const;
  if (data.trigger && data.outreach.state === "none")
    return { tab: "sources", label: "Review source" } as const;
  return {
    tab: "outreach",
    step: outreachStep(data) === 3 ? 3 : 1,
    label: data.replies.length ? "Review reply" : "Review draft",
  } as const;
}

/** Outreach step a prospect has reached from its pipeline stage (see `pipelineStage`). */
export function prospectOutreachStep(stage: number, hasMessages: boolean) {
  if (stage >= 5) return 3;
  if (stage < 4) return 0;
  return hasMessages ? 2 : 1;
}

/** Qualification creates a buyer opportunity, so a qualified prospect is a buyer account. */
export const prospectRole = (qualified: boolean) => (qualified ? "Qualified buyer" : "Prospect");

/** Reads a pipeline count key such as `closedLost` as "closed lost". */
export const countLabel = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();

/** Stage labels shared by the queue and buyer-need pairings. */
export const pairingStages: Record<string, string> = {
  evidence_review: "Evidence review",
  investigate: "Investigating",
  awaiting_seller: "Awaiting seller",
  ready_for_buyer_review: "Ready for buyer review",
  handed_off: "Handed off",
  rejected: "Pairing rejected",
  unavailable: "Seller unavailable",
};

/** Review priority is independent of alphabetical stage labels. */
export const stagePriority: Record<string, number> = {
  evidence_review: 0,
  ready_for_buyer_review: 1,
  investigate: 2,
  awaiting_seller: 3,
  unavailable: 4,
  rejected: 5,
  handed_off: 6,
};

type Pipeline = {
  identityState: string;
  routing: string | null;
  contactable: boolean;
  qualified: boolean;
};
/** Current account pipeline stage from reviewed profile records. */
export function pipelineStage(account: Pipeline, sequence: boolean, reply: boolean) {
  if (account.qualified) return 6;
  if (reply) return 5;
  if (sequence) return 4;
  if (account.identityState !== "confirmed") return 1;
  if (!account.routing) return 2;
  if (!account.contactable) return 3;
  return 4;
}
