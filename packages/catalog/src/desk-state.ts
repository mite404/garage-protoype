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
  const { stage, vehicle } = data.connection;
  if (stage === "introduced")
    return {
      tab: "overview",
      label: "Record sale outcome",
      anchor: "connection-progress",
    } as const;
  if (stage === "ready_for_buyer_review" && vehicle)
    return {
      tab: "overview",
      label: "Record introduction",
      anchor: "connection-progress",
    } as const;
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

/** Qualifying a prospect drafts its listing, so a qualified prospect is a seller. Accounts
 * qualified before that change hold a buyer opportunity instead. */
export const prospectRole = (account: { listingVehicleId: string | null; qualified: boolean }) =>
  account.listingVehicleId
    ? "Qualified seller"
    : account.qualified
      ? "Qualified buyer"
      : "Prospect";

/** Seller qualification as the account metrics show it. */
export const qualificationLabel = (account: {
  listingVehicleId: string | null;
  qualified: boolean;
}) =>
  account.listingVehicleId ? "Draft listing" : account.qualified ? "Qualified" : "Not qualified";

/** Reads a pipeline count key such as `closedLost` as "closed lost". */
export const countLabel = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();

/** Stage labels shared by the queue, buyer needs and each connection. */
export const connectionStages: Record<string, string> = {
  investigate: "Investigating",
  awaiting_seller: "Awaiting seller",
  evidence_review: "Evidence review",
  ready_for_buyer_review: "Ready for buyer review",
  introduced: "Introduced",
  sale_closed: "Sale closed",
  closed_elsewhere: "Closed by another sale",
  rejected: "Connection rejected",
  unavailable: "Seller unavailable",
};

/** The four milestones a connection moves through on its way to a sale. */
export const connectionSteps = [
  "Investigating",
  "Ready for buyer review",
  "Introduced",
  "Sale closed",
] as const;

// Milestone index per stage; the investigating milestone covers seller outreach and review.
const stageSteps: Record<string, number> = {
  investigate: 0,
  awaiting_seller: 0,
  evidence_review: 0,
  ready_for_buyer_review: 1,
  introduced: 2,
  sale_closed: 3,
};

/** Milestone a stage has reached, or null once the connection closed without this sale. */
export const connectionStep = (stage: string): number | null => stageSteps[stage] ?? null;

/** Whether a connection is still in progress toward a sale. */
export const connectionOpen = (stage: string) =>
  connectionStep(stage) !== null && stage !== "sale_closed";

/** Who the connection is waiting on. Unreviewed proposals always put the rep back on it. */
export function connectionWaitingOn(stage: string, proposals: number) {
  if (proposals > 0) return "you" as const;
  if (stage === "awaiting_seller") return "seller" as const;
  if (stage === "introduced") return "buyer and seller" as const;
  return "you" as const;
}

/** Queue order: connections blocked on the rep first, then the ones closest to a sale. */
export function compareConnections(
  a: { stage: string; proposals: number },
  b: { stage: string; proposals: number },
) {
  const blocked = (item: typeof a) =>
    connectionWaitingOn(item.stage, item.proposals) === "you" ? 0 : 1;
  const closeness = (item: typeof a) => -(connectionStep(item.stage) ?? -1);
  return blocked(a) - blocked(b) || closeness(a) - closeness(b);
}

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
