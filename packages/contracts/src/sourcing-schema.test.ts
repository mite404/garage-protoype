import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptSelected,
  checkDecision,
  decisionBasis,
  evaluateFit,
  isStale,
  openQuestions,
  suggestDecision,
  type Fact,
  type Need,
} from "./sourcing-schema";

const pineBrook: Need = {
  id: "need-pine-brook",
  buyer: "Pine Brook FD",
  vehicleClass: "Pumper",
  revision: 1,
  budgetBasis: "total",
  maxBudgetCents: 17_500_000,
  maxHeightIn: 120,
};
const at = new Date("2026-10-19T12:00:00Z");
const fact = (input: Partial<Fact> & Pick<Fact, "id" | "field" | "value">) =>
  ({
    basis: "explicit_reply",
    sourceRef: "reply-1",
    status: "proposed",
    reviewedAt: null,
    ...input,
  }) as Fact;
const status = (facts: Fact[]) =>
  Object.fromEntries(evaluateFit(pineBrook, facts).map((row) => [row.requirement, row.status]));

test("unknown and proposed answers never pass a constraint", () => {
  const proposals = [
    fact({ id: "h", field: "heightIn", value: 118 }),
    fact({ id: "s", field: "saleStatus", value: "available" }),
  ];
  const rows = evaluateFit(pineBrook, proposals);
  assert.deepEqual(status(proposals), {
    available: "unknown",
    height: "unknown",
    budget: "unknown",
    authority: "unknown",
  });
  assert.equal(suggestDecision(rows), "investigate");
  assert.equal(openQuestions(rows).length, 4);
  assert.throws(() => checkDecision(rows, { decision: "proceed", reason: "Looks right" }));
});

test("an accepted 121 inch measurement rejects the pairing; the rest stay unresolved", () => {
  const replies = [
    fact({ id: "s", field: "saleStatus", value: "maybe_later" }),
    fact({ id: "h", field: "heightIn", value: 121, basis: "source_claim" }),
  ];
  const reviewed = acceptSelected(replies, ["h"], at);
  assert.equal(reviewed.find((f) => f.id === "s")?.status, "proposed");
  const rows = evaluateFit(pineBrook, reviewed);
  assert.equal(status(reviewed).height, "not_met");
  assert.equal(status(reviewed).available, "unknown");
  assert.equal(suggestDecision(rows), "reject");
  assert.throws(() => acceptSelected(reviewed, ["h"], at), /not a current proposal/);
});

test("a purchase-price limit compares price alone; a total budget never does", () => {
  const purchase: Need = { ...pineBrook, budgetBasis: "purchase_price" };
  const price = [
    fact({ id: "p", field: "priceCents", value: 17_500_000, status: "accepted", reviewedAt: at }),
  ];
  assert.equal(evaluateFit(purchase, price)[2]?.status, "met");
  assert.equal(evaluateFit(pineBrook, price)[2]?.status, "incomplete");
});

test("price alone never establishes all-in cost, but a partial sum over the limit fails", () => {
  const price = (value: number) => [
    fact({ id: "p", field: "priceCents", value, status: "accepted", reviewedAt: at }),
  ];
  assert.equal(status(price(16_000_000)).budget, "incomplete");
  assert.equal(status(price(17_500_001)).budget, "not_met");
  const all = [
    ...price(16_000_000),
    fact({
      id: "t",
      field: "transportCents",
      value: 1_000_000,
      status: "accepted",
      reviewedAt: at,
    }),
    fact({ id: "f", field: "feesCents", value: 500_000, status: "accepted", reviewedAt: at }),
  ];
  assert.equal(status(all).budget, "met"); // exactly $175,000 is within the limit
  const over = fact({
    id: "f",
    field: "feesCents",
    value: 500_001,
    status: "accepted",
    reviewedAt: at,
  });
  assert.equal(status([...all.slice(0, 2), over]).budget, "not_met");
});

test("proceed requires every constraint met by accepted evidence", () => {
  const accepted = (input: Parameters<typeof fact>[0]) =>
    fact({ ...input, status: "accepted", reviewedAt: at });
  const facts = [
    accepted({ id: "s", field: "saleStatus", value: "available" }),
    accepted({ id: "h", field: "heightIn", value: 120 }),
    accepted({ id: "p", field: "priceCents", value: 15_000_000 }),
    accepted({ id: "t", field: "transportCents", value: 0 }),
    accepted({ id: "f", field: "feesCents", value: 0 }),
    accepted({ id: "a", field: "authority", value: "Board of fire commissioners" }),
  ];
  const rows = evaluateFit(pineBrook, facts);
  assert.equal(suggestDecision(rows), "proceed");
  assert.equal(checkDecision(rows, { decision: "proceed", reason: "All met" }).decision, "proceed");
  const basis = decisionBasis(pineBrook, facts);
  assert.equal(isStale(basis, pineBrook, facts), false);
  assert.equal(isStale(basis, { ...pineBrook, revision: 2 }, facts), true);
  // A second accepted height that disagrees leaves height unresolved, not failed or met.
  const clash = [...facts, accepted({ id: "h2", field: "heightIn", value: 121 })];
  assert.equal(status(clash).height, "conflicting");
  assert.equal(suggestDecision(evaluateFit(pineBrook, clash)), "investigate");
  assert.equal(isStale(basis, pineBrook, clash), true);
  // Rejecting the old measurement resolves the conflict to the reviewed 121 in.
  const resolved = clash.map((f) => (f.id === "h" ? { ...f, status: "rejected" as const } : f));
  assert.equal(suggestDecision(evaluateFit(pineBrook, resolved)), "reject");
});
