import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockerDuration,
  compareConnections,
  connectionOpen,
  outreachStep,
  pipelineStage,
  prospectOutreachStep,
  prospectRole,
  qualificationLabel,
} from "./desk-state";

test("review steps require both identity and permission, but preserve received replies", () => {
  const data = {
    contact: { identity: "reviewed", permission: "not_established" },
    outreach: { state: "none", deliveryEnabled: false, stopReason: null, request: null },
    replies: [],
    facts: [],
  } as const;
  const base = { ...data, replies: [], facts: [] };
  assert.equal(outreachStep(base), 0);
  assert.equal(
    outreachStep({ ...base, contact: { identity: "pending_review", permission: "established" } }),
    0,
  );
  assert.equal(
    outreachStep({ ...base, contact: { identity: "reviewed", permission: "established" } }),
    1,
  );
  assert.equal(outreachStep({ ...base, outreach: { ...base.outreach, state: "uncertain" } }), 2);
  assert.equal(
    outreachStep({
      ...base,
      replies: [{ id: "note", channel: "note", text: "Maybe later", receivedAt: new Date(0) }],
    }),
    3,
  );
});

test("pipeline review does not mistake discovery or routing for contact permission", () => {
  const account = {
    identityState: "needs_review",
    routing: null,
    contactable: false,
    qualified: false,
  };
  assert.equal(pipelineStage(account, false, false), 1);
  assert.equal(pipelineStage({ ...account, identityState: "confirmed" }, false, false), 2);
  assert.equal(
    pipelineStage({ ...account, identityState: "confirmed", routing: "NY" }, false, false),
    3,
  );
  assert.equal(pipelineStage(account, true, true), 5);
  assert.equal(pipelineStage({ ...account, qualified: true }, true, true), 6);
});

test("a prospect reaches delivery only once its reviewed sequence has messages", () => {
  assert.equal(prospectOutreachStep(3, true), 0);
  assert.equal(prospectOutreachStep(4, false), 1);
  assert.equal(prospectOutreachStep(4, true), 2);
  assert.equal(prospectOutreachStep(5, false), 3);
});

test("the queue leads with connections waiting on the rep, closest to a sale first", () => {
  const items = [
    { id: "introduced", stage: "introduced", proposals: 0 },
    { id: "investigating", stage: "investigate", proposals: 0 },
    { id: "awaiting", stage: "awaiting_seller", proposals: 0 },
    { id: "reply", stage: "awaiting_seller", proposals: 2 },
    { id: "ready", stage: "ready_for_buyer_review", proposals: 0 },
  ];
  assert.deepEqual(
    items.toSorted(compareConnections).map((item) => item.id),
    ["ready", "investigating", "reply", "introduced", "awaiting"],
  );
  assert.deepEqual(
    ["introduced", "sale_closed", "closed_elsewhere", "rejected"].map(connectionOpen),
    [true, false, false, false],
  );
});

test("a qualified prospect with a listing is a seller; legacy qualification stays a buyer", () => {
  const listed = { listingVehicleId: "listing-1", qualified: true };
  const legacy = { listingVehicleId: null, qualified: true };
  const open = { listingVehicleId: null, qualified: false };
  assert.deepEqual([listed, legacy, open].map(prospectRole), [
    "Qualified seller",
    "Qualified buyer",
    "Prospect",
  ]);
  assert.deepEqual([listed, legacy, open].map(qualificationLabel), [
    "Draft listing",
    "Qualified",
    "Not qualified",
  ]);
});

test("blocker durations switch from minutes to hours to days at their boundaries", () => {
  assert.deepEqual([null, 0.001, 0.5, 1, 47.9, 48, 120].map(blockerDuration), [
    "None",
    "< 1 min",
    "30 min",
    "1.0 h",
    "47.9 h",
    "2.0 d",
    "5.0 d",
  ]);
});
