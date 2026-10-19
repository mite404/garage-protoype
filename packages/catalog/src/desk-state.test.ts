import assert from "node:assert/strict";
import { test } from "node:test";
import { outreachStep, pipelineStage } from "./desk-state";

test("review steps require both identity and permission, but preserve received replies", () => {
  const data = {
    contact: { identity: "reviewed", permission: "not_established" },
    outreach: { state: "none", deliveryEnabled: false, stopReason: null },
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
