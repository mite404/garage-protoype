// Simulated dashboard records. The Pine Brook / Cedar Valley pairing mirrors the synthetic seed
// in src/server/sourcing-seed.ts; the other connections are invented fixtures. Every count on the
// remix is calculated from these records, never typed in.
import { connectionStages, connectionWaitingOn } from "@signal-desk/catalog/desk-state";

type Blocker = { type: BlockerType; opened: string; resolved?: string };
type Readiness = "Exploring" | "Need confirmed" | "Ready for introduction" | "Introduced";
type Connection = {
  id: string;
  buyer: string;
  seller: string;
  vehicle: string;
  stage: keyof typeof connectionStages;
  proposals: number;
  readiness: Readiness;
  nextAction: string;
  blockers: Blocker[];
};

const blockerTypes = [
  "Sale intent unconfirmed",
  "Seller authority",
  "Vehicle fit conflict",
  "Missing evidence",
  "Contact permission",
] as const;
type BlockerType = (typeof blockerTypes)[number];

const readinessLevels: Readiness[] = [
  "Exploring",
  "Need confirmed",
  "Ready for introduction",
  "Introduced",
];

export const asOf = "2026-10-20";

const connections: Connection[] = [
  {
    id: "synthetic-cedar-valley",
    buyer: "Pine Brook FD",
    seller: "Cedar Valley Fire District",
    vehicle: "Pumper · ≤ $175,000 all-in · ≤ 120 in",
    stage: "evidence_review",
    proposals: 2,
    readiness: "Need confirmed",
    nextAction: "Review the reply. Height and sale timing are proposed, not yet reviewed.",
    blockers: [
      { type: "Sale intent unconfirmed", opened: "2026-10-18" },
      { type: "Seller authority", opened: "2026-10-18" },
      { type: "Vehicle fit conflict", opened: "2026-10-19" },
      { type: "Contact permission", opened: "2026-10-18", resolved: "2026-10-18" },
    ],
  },
  {
    id: "synthetic-north-ridge",
    buyer: "Harlow Lake FD",
    seller: "North Ridge Fire Co.",
    vehicle: "Tanker · ≤ $140,000",
    stage: "awaiting_seller",
    proposals: 0,
    readiness: "Need confirmed",
    nextAction: "Wait for the seller's reply to the reviewed information request.",
    blockers: [
      { type: "Sale intent unconfirmed", opened: "2026-10-14" },
      { type: "Contact permission", opened: "2026-10-10", resolved: "2026-10-13" },
    ],
  },
  {
    id: "synthetic-ridgeview",
    buyer: "Oak Hollow FD",
    seller: "Ridgeview Fire District",
    vehicle: "Pumper · pump test required",
    stage: "evidence_review",
    proposals: 1,
    readiness: "Need confirmed",
    nextAction: "Review the seller's pump-test report before drafting a buyer follow-up.",
    blockers: [
      { type: "Missing evidence", opened: "2026-10-12" },
      { type: "Sale intent unconfirmed", opened: "2026-10-08", resolved: "2026-10-11" },
    ],
  },
  {
    id: "synthetic-ashby",
    buyer: "West Fork FD",
    seller: "Ashby Fire District",
    vehicle: "Rescue · budget unknown",
    stage: "investigate",
    proposals: 0,
    readiness: "Exploring",
    nextAction: "Confirm who can authorize a sale before any outreach.",
    blockers: [
      { type: "Seller authority", opened: "2026-10-16" },
      { type: "Contact permission", opened: "2026-10-16" },
    ],
  },
  {
    id: "synthetic-stony-creek",
    buyer: "Millbrook FD",
    seller: "Stony Creek FD",
    vehicle: "Pumper · ≤ $160,000",
    stage: "ready_for_buyer_review",
    proposals: 0,
    readiness: "Ready for introduction",
    nextAction: "Make the proceed, investigate or reject decision for this connection.",
    blockers: [
      { type: "Vehicle fit conflict", opened: "2026-10-02", resolved: "2026-10-07" },
      { type: "Missing evidence", opened: "2026-10-03", resolved: "2026-10-09" },
    ],
  },
  {
    id: "synthetic-kettle-hill",
    buyer: "Glen Arden FD",
    seller: "Kettle Hill FD",
    vehicle: "Brush truck · ≤ $90,000",
    stage: "introduced",
    proposals: 0,
    readiness: "Introduced",
    nextAction: "Record the outcome once buyer and seller report back.",
    blockers: [
      { type: "Seller authority", opened: "2026-09-28", resolved: "2026-10-01" },
      { type: "Sale intent unconfirmed", opened: "2026-09-26", resolved: "2026-09-30" },
    ],
  },
];

// The last account the rep worked on, as the seeded walkthrough leaves it.
export const recent = {
  connection: connections[0]!,
  trigger: {
    excerpt: "New pumper scheduled to enter service in November.",
    source: "Replacement notice · Synthetic source · Oct 18",
  },
  fit: [
    { label: "Vehicle type", need: "Pumper", evidence: "Pumper (directory)", state: "Meets" },
    { label: "Budget", need: "≤ $175,000 all-in", evidence: "No asking price", state: "Unknown" },
    {
      label: "Height",
      need: "≤ 120 in",
      evidence: "121 in, proposed from reply",
      state: "Conflict",
    },
    {
      label: "Sale timing",
      need: "Confirmed for sale",
      evidence: "“Maybe later”, proposed",
      state: "Unknown",
    },
  ],
  reply: "Maybe later, once the new truck arrives. Our current pumper is 121 inches tall.",
};

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

const inFlight = connections.filter((c) => !["sale_closed", "rejected"].includes(c.stage));

const waitingOn = (c: Connection) => connectionWaitingOn(c.stage, c.proposals);

const allBlockers = connections.flatMap((c) => c.blockers);
const resolvedDays = allBlockers
  .filter((b) => b.resolved)
  .map((b) => days(b.opened, b.resolved!))
  .toSorted((a, b) => a - b);

export const metrics = {
  inFlight: inFlight.length,
  waitingOnYou: inFlight.filter((c) => waitingOn(c) === "you").length,
  openBlockers: allBlockers.filter((b) => !b.resolved).length,
  medianDaysToResolve: resolvedDays[Math.floor(resolvedDays.length / 2)],
  resolvedCount: resolvedDays.length,
  readyBuyers: connections.filter((c) => c.readiness === "Ready for introduction").length,
};

// → { level, count }[] across every buyer in the queue.
export const readiness = readinessLevels.map((level) => ({
  level,
  count: connections.filter((c) => c.readiness === level).length,
}));

// → { week, opened, resolved }[] weekly blocker flow for the trend chart.
export const weeklyFlow = ["2026-09-26", "2026-10-03", "2026-10-10", "2026-10-17"].map((week) => {
  const inWeek = (date?: string) => !!date && days(week, date) >= 0 && days(week, date) < 7;
  return {
    week: week.slice(5).replace("-", "/"),
    opened: allBlockers.filter((b) => inWeek(b.opened)).length,
    resolved: allBlockers.filter((b) => inWeek(b.resolved)).length,
  };
});

// → { buyer, seller, type, days, resolved }[] newest reviewed resolutions first.
export const resolvedLog = connections
  .flatMap((c) =>
    c.blockers
      .filter((b) => b.resolved)
      .map((b) => ({
        buyer: c.buyer,
        seller: c.seller,
        type: b.type,
        days: days(b.opened, b.resolved!),
        resolved: b.resolved!,
      })),
  )
  .toSorted((a, b) => b.resolved.localeCompare(a.resolved));
