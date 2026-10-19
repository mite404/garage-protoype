import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeedbackReply } from "./feedback-schema";

test("numeric survey replies preserve interest, no blocker and ambiguity", () => {
  assert.deepEqual(parseFeedbackReply("Interest: 2, Blocker: 1"), {
    interest: "need_information",
    blocker: "setup_effort",
    explanation: "",
  });
  assert.deepEqual(parseFeedbackReply("Interest: 2\nBlocker: 1"), {
    interest: "need_information",
    blocker: "setup_effort",
    explanation: "",
  });
  assert.deepEqual(parseFeedbackReply("4, 7"), {
    interest: "not_interested",
    blocker: "none",
    explanation: "",
  });
  assert.equal(parseFeedbackReply("1"), null);
  assert.equal(parseFeedbackReply("Interest: 9\nBlocker: 2"), null);
  assert.equal(parseFeedbackReply("1, 6 I have another problem"), null);
  assert.equal(parseFeedbackReply("I am not sure"), null);
});
