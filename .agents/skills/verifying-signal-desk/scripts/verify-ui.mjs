#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const origin = process.argv[2] ?? "http://localhost:6106";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = join(root, ".amp/in/artifacts/legibility");
const session = `verify-${process.pid}`;
const pinnedNode = `v${readFileSync(join(root, ".node-version"), "utf8").trim()}`;
const played = 'window.__STORYBOOK_PREVIEW__?.currentRender?.phase === "finished"';
const errorShown =
  '[...document.querySelectorAll(".sb-errordisplay,vite-error-overlay")].some(e=>e.checkVisibility())';

// Every Storybook story, keyed by id. A story missing here fails the run, so new stories
// cannot ship unverified. `text` must be visible; play functions supply the interactions.
const stories = {
  "agent-catalog-assistance-cards--cited-answer": {
    selector: '[data-card="answer"]',
    text: ["Pump capacity", "1,250 GPM", "Synthetic brochure · Page 4"],
  },
  "agent-catalog-assistance-cards--conflict": {
    selector: '[data-card="review"]',
    text: ["What is the tank capacity?", "Compare both sources before answering."],
  },
  "agent-catalog-assistance-cards--needs-review": {
    selector: '[data-card="review"]',
    text: ["Review the seller statement before sharing any value."],
  },
  "agent-catalog-assistance-cards--unknown": {
    selector: '[data-card="review"]',
    text: ["Request a source for the missing pump-test result."],
  },
  "agent-catalog-assistance-cards--human-review": {
    selector: '[data-card="review"]',
    text: ["Human interpretation required"],
  },
  "agent-catalog-assistance-cards--jev-suggested": {
    selector: '[data-card="review"] .card-suggestion',
    text: ["Jev suggestion", "Tank capacity · 98% confidence", "Use suggested field"],
  },
  "agent-catalog-assistance-cards--jev-needs-review": {
    selector: '[data-card="review"] .card-suggestion',
    text: ["Needs human review", "The question asks for a judgment, not a recorded fact."],
  },
  "agent-catalog-assistance-cards--jev-unavailable": {
    selector: '[data-card="review"]',
    text: ["Jev routing unavailable. Route this question manually."],
  },
  "agent-catalog-assistance-cards--offer-not-accepted": {
    selector: '[data-card="handoff"]',
    text: ["Offer recorded · Not accepted", "$6,500 below current terms of $171,500"],
  },
  "agent-catalog-assistance-cards--empty-conditions": {
    selector: '[data-card="handoff"]',
    text: ["No additional conditions supplied.", "No unanswered questions supplied."],
  },
  "agent-catalog-assistance-cards--unsent-draft": {
    selector: '[data-card="draft"]',
    text: [
      "Unsent draft · Human review required",
      "No delivery action exists. Recipient identity is not verified.",
    ],
  },
  "agent-catalog-assistance-cards--stale-draft": {
    selector: '[data-card="draft"]',
    text: ["Unsent draft · Evidence changed, review again"],
  },
  "agent-catalog-scripted-demo--inline-catalog": {
    selector: ".desk-chat-card",
    text: ["Offer recorded · Not accepted", "Stale: the need or reviewed evidence changed"],
  },
  "agent-catalog-assistance-cards--evidence-review": {
    selector: '[data-card="answer"]',
    text: ["Evidence review", "Synthetic specimen · Not connected to records"],
  },
  "workspace-dispatch--evidence-review": {
    selector: ".dispatch-shell",
    text: ["Keep the next step clear.", "Unsent draft · Human review required"],
  },
  "primitives-foundations--palette-and-type": {
    selector: "#storybook-root h1",
    text: ["Evidence before answers."],
  },
  "primitives-foundations--actions-and-states": {
    selector: "button[disabled]",
    text: ["Review evidence", "Unavailable", "Conflict"],
  },
  "primitives-foundations--evidence-form": {
    selector: "form #source-name",
    text: ["Request a source", "Story specimen only. Nothing is saved or sent."],
  },
  "primitives-working-indicator--wave-and-siren": {
    selector: ".turn-progress-siren",
    text: ["Checking evidence…"],
  },
  "primitives-working-indicator--playground": {
    selector: ".turn-progress-siren",
    text: ["Checking evidence…"],
  },
  "primitives-working-indicator--siren-mid-cycle": {
    selector: ".turn-progress-siren",
    text: ["Checking evidence…"],
  },
  "conversation-reading--structured-response": { selector: ".quiet-prose h4" },
  "conversation-reading--literal-evidence": { selector: ".literal-prose" },
  "conversation-reading--connected-turn": { selector: ".conversation-turn" },
  "conversation-chat-workspace--light": {
    selector: '.chat-workspace[data-theme="light"]',
    text: ["What is blocking this purchase?"],
  },
  "conversation-chat-workspace--dark": {
    selector: '.chat-workspace[data-theme="dark"]',
    text: ["What is blocking this purchase?"],
  },
  "conversation-chat-workspace--email-editor": {
    selector: '.chat-workspace[data-editor-open="true"]',
    text: ["Local preview only. Closing keeps your edits until reload."],
  },
  "conversation-chat-workspace--dark-email-editor": {
    selector: '.chat-workspace[data-theme="dark"][data-editor-open="true"]',
    text: ["Local preview only. Closing keeps your edits until reload."],
  },
  "conversation-chat-workspace--minimized": {
    selector: '.chat-workspace[data-theme="light"]',
    dialogsHidden: true,
  },
  "conversation-chat-workspace--dark-minimized": {
    selector: '.chat-workspace[data-theme="dark"]',
    dialogsHidden: true,
  },
  "conversation-chat-workspace--retains-draft-edits": {
    selector: ".chat-workspace",
    text: ["Please include the test date and pump serial number."],
  },
  "conversation-chat-workspace--dark-retains-draft-edits": {
    selector: '.chat-workspace[data-theme="dark"]',
    text: ["Please include the test date and pump serial number."],
  },
  "conversation-chat-workspace--composes-local-message": {
    selector: ".chat-workspace",
    text: ["Preview message added. No model connected."],
  },
  "municipal-sales-workspace--default": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: [
      "Austin Fire Department",
      "Simulated deal. No payment or escrow funds held.",
      "Listed Feb 28, 2025",
    ],
  },
  "municipal-sales-workspace--dark": {
    selector: '[data-theme="dark"] nav[aria-label="Municipal sales"]',
    text: ["Austin Fire Department"],
  },
  "municipal-sales-workspace--chat-open": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: ["Austin Fire Department", "What is blocking this purchase?"],
  },
  "municipal-sales-workspace--dark-chat-open": {
    selector: '[data-theme="dark"] nav[aria-label="Municipal sales"]',
    text: ["What is blocking this purchase?"],
  },
  "municipal-sales-workspace--chat-working": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: ["Prepare a seller request for the pump-test report.", "Checking evidence…"],
  },
  "municipal-sales-workspace--dark-chat-working": {
    selector: '[data-theme="dark"] nav[aria-label="Municipal sales"]',
    text: ["Checking evidence…"],
  },
  "municipal-sales-workspace--chat-jev-suggestion": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: ["Tank capacity · 98% confidence", "Accepted suggestion for synthetic-jev-question"],
  },
  "municipal-sales-workspace--empty-activity-and-listings": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: ["No favorites or seller contact activity recorded.", "No owned listings recorded."],
  },
  "municipal-sales-workspace--no-deal-terms": {
    selector: 'nav[aria-label="Municipal sales"]',
    text: ["No proposed amount or conditions recorded."],
  },
  "sourcing-department-workspace--research": {
    selector: 'nav[aria-label="Workspace"]',
    text: ["Availability request", "Reviewed draft · Not sent"],
  },
  "sourcing-department-workspace--reply-rejects-pairing": {
    selector: 'nav[aria-label="Workspace"]',
    text: ["1 in over", "Recorded Oct 19, 2026"],
  },
  "sourcing-department-workspace--conflict-and-stale": {
    selector: 'nav[aria-label="Workspace"]',
    text: ["Conflicting", "Stale: the need or reviewed evidence changed, decide again"],
  },
  "sourcing-department-workspace--dark": {
    selector: '[data-theme="dark"] nav[aria-label="Workspace"]',
    text: ["1 in over"],
  },
  "sourcing-department-workspace--fit-margins": {
    selector: ".sourcing-fit",
    text: ["2 in under", "$3,200 over"],
  },
  "sourcing-department-workspace--chat-decision": {
    selector: ".desk-chat-card",
    text: ["Open decision", "Decide again"],
  },
  "sourcing-department-workspace--chat-cards": {
    selector: '[data-card="reply-review"]',
    text: ["Proposed updates · Not yet approved", "Reject this connection, not the seller account"],
  },
};

// Stories whose layout must also hold at a 390px phone width.
const narrow = [
  "conversation-reading--connected-turn",
  "conversation-chat-workspace--light",
  "municipal-sales-workspace--default",
  "sourcing-department-workspace--reply-rejects-pairing",
];

function browser(...args) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], {
      encoding: "utf8",
      cwd: root,
    }),
  );
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data;
}

function evaluate(source) {
  return browser("eval", source).result;
}

function catalog() {
  const entries = JSON.parse(
    execFileSync("curl", ["--fail", "--silent", `${origin}/index.json`], { encoding: "utf8" }),
  ).entries; // → Record<string, { type: string }>
  return Object.keys(entries).filter((id) => entries[id].type === "story"); // → string[]
}

function open(id, selector) {
  browser("open", `${origin}/iframe.html?id=${id}&viewMode=story`);
  browser("wait", "--fn", played);
  assert.equal(evaluate(errorShown), false, `${id}: render or play function failed`);
  browser("wait", selector);
}

function assertVisibleText(id, text) {
  // innerText applies CSS text-transform, so uppercase eyebrows compare case-insensitively.
  const page = evaluate("document.body.innerText").toLowerCase(); // → string
  for (const expected of text) {
    assert.ok(page.includes(expected.toLowerCase()), `${id}: missing "${expected}"`);
  }
}

function assertDialogsHidden(id) {
  const visible = evaluate(
    '[...document.querySelectorAll("[role=dialog],dialog")].filter(d=>d.checkVisibility()).length',
  );
  assert.equal(visible, 0, `${id}: a minimized window is still visible`);
}

function capture(name) {
  browser("screenshot", "--full", join(output, `${name}.png`));
}

function checkConflict() {
  assert.equal(evaluate('document.querySelectorAll(".card-next-action li").length'), 2);
  assert.equal(
    evaluate('document.querySelector(".card-next-action em").textContent'),
    "Neither value is approved for a buyer reply.",
  );
}

function checkProseRhythm() {
  assert.deepEqual(
    evaluate(
      '({size:getComputedStyle(document.querySelector(".quiet-prose")).fontSize,line:getComputedStyle(document.querySelector(".quiet-prose")).lineHeight,gap:getComputedStyle(document.querySelector(".quiet-prose p")).marginBottom})',
    ),
    { size: "15px", line: "24px", gap: "16px" },
  );
}

function checkLiteralEvidence() {
  assert.equal(
    evaluate('document.querySelectorAll(".literal-prose strong,.literal-prose script").length'),
    0,
  );
  assert.ok(
    evaluate('document.querySelector(".literal-prose").textContent').includes(
      "<script>not executable</script>",
    ),
  );
}

function checkConnectedTurn() {
  assert.equal(
    evaluate('document.querySelectorAll(".conversation-response > .quiet-prose > p").length'),
    2,
  );
}

const extraChecks = {
  "agent-catalog-assistance-cards--conflict": checkConflict,
  "conversation-reading--structured-response": checkProseRhythm,
  "conversation-reading--literal-evidence": checkLiteralEvidence,
  "conversation-reading--connected-turn": checkConnectedTurn,
};

function verifyStory(id) {
  const spec = stories[id];
  open(id, spec.selector);
  assertVisibleText(id, spec.text ?? []);
  if (spec.dialogsHidden) assertDialogsHidden(id);
  extraChecks[id]?.();
  capture(id.replace(/^[a-z-]+--/, (prefix) => `${prefix.slice(0, -2)}.`));
}

function verifyNarrow(id) {
  open(id, stories[id].selector);
  evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  assert.equal(evaluate("document.documentElement.scrollWidth"), 390, `${id}: overflows 390px`);
  capture(`narrow.${id}`);
}

assert.equal(process.version, pinnedNode, `run with the pinned Node ${pinnedNode}`);
const ids = catalog(); // → string[]
const unmapped = ids.filter((id) => !(id in stories));
const removed = Object.keys(stories).filter((id) => !ids.includes(id));
assert.deepEqual(unmapped, [], "stories missing from verify-ui.mjs; add a check for each");
assert.deepEqual(removed, [], "verify-ui.mjs lists stories Storybook no longer has");

mkdirSync(output, { recursive: true });
try {
  browser("set", "viewport", "1280", "900", "2");
  for (const id of ids) verifyStory(id);
  browser("set", "viewport", "390", "844", "2");
  for (const id of narrow) verifyNarrow(id);
  console.log(`UI checks passed for ${ids.length} stories. Review screenshots in ${output}`);
} finally {
  browser("close");
}
