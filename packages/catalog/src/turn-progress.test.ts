import assert from "node:assert/strict";
import { test } from "node:test";
import { isActiveTurn, progressLabel, sendingMessage } from "./turn-progress";

test("unfinished turns show their recorded owner step, not their raw state", () => {
  assert.equal(progressLabel({ state: "queued", activity: null }), "Queued");
  assert.equal(progressLabel({ state: "running", activity: "reading_deal" }), "Reading the deal");
  assert.equal(
    progressLabel({ state: "queued", activity: "preparing_draft" }),
    "Preparing a draft",
  );
  // Stopping wins over the last step the owner recorded before cancellation.
  assert.equal(progressLabel({ state: "cancelling", activity: "writing" }), "Stopping");
});

test("only queued, running and cancelling turns are active", () => {
  const states = ["queued", "running", "cancelling", "completed", "interrupted", "cancelled"];
  assert.deepEqual(
    states.filter((state) => isActiveTurn({ state: state as never })),
    ["queued", "running", "cancelling"],
  );
});

test("a sent message shows until its own saved turn arrives, not when older turns update", () => {
  const sent = { message: "Prepare a request", known: ["a", "b"] };
  assert.equal(sendingMessage(undefined, []), undefined);
  assert.equal(sendingMessage(sent, [{ id: "a" }, { id: "b" }]), "Prepare a request");
  // An observer snapshot may briefly omit known turns; that is still not the new turn.
  assert.equal(sendingMessage(sent, [{ id: "b" }]), "Prepare a request");
  assert.equal(sendingMessage(sent, [{ id: "a" }, { id: "b" }, { id: "c" }]), undefined);
});
