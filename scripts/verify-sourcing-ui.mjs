import assert from "node:assert/strict";
import { join } from "node:path";
import { openEvidenceSession } from "./browser-evidence.mjs";

const origin = process.env.SOURCING_REVIEW_ORIGIN;
const cookie = process.env.SOURCING_REVIEW_COOKIE;
const rejected = process.env.SOURCING_REVIEW_REJECTED;
const open = process.env.SOURCING_REVIEW_OPEN;
assert.ok(
  origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && cookie && rejected && open,
  "Use only the disposable sourcing.test.ts fixture and its controlled local identity provider.",
);
const { browser, output, capture, finish } = openEvidenceSession({
  session: "sourcing-review",
  folder: "sourcing",
  origin,
  cookie,
});
const check = (expression) => assert.equal(browser("eval", expression).trim(), "true", expression);
const text = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`;
const scrollTo = (heading) =>
  browser(
    "eval",
    `[...document.querySelectorAll('h2')].find(h => h.textContent === ${JSON.stringify(heading)}).scrollIntoView({block:'start'})`,
  );
let failure;
try {
  browser("open", `${origin}/desk/sourcing`);
  browser("wait", "--text", "Cedar Valley Fire District for Pine Brook FD");
  check(
    `${text("stays open after this pairing was rejected")} && ${text("Find another candidate")} && ${text("Harbor Point FD")}`,
  );
  capture("queue");

  // The rejected pairing keeps its recorded basis; the seller is not marked rejected.
  browser("open", `${origin}/desk/sourcing/${rejected}`);
  browser("find", "role", "button", "click", "--name", "Vehicles & fit");
  browser("wait", "--text", "Decision for this pairing");
  check(`${text("Reviewed height 121 in exceeds 120 in.")} && ${text("Potential seller")}`);
  scrollTo("Can this candidate meet the need?");
  check(text("Does not meet"));
  capture("rejected-pairing");

  browser("open", `${origin}/desk/sourcing/${open}`);
  browser("wait", "--text", "Why this account is here");
  check(`${text("Research trigger only")} && ${text("Message sending disabled")}`);
  capture("research-default");
  browser("find", "role", "button", "click", "--name", "Outreach", "--exact");
  browser("record", "start", join(output, "reply-review.mp4"), "--fps", "5", "--cursor");
  browser("fill", "#sourcing-note", "Available now. Our pumper is 118 inches tall.");
  browser("find", "role", "button", "click", "--name", "Record reply");
  browser("wait", "--text", "118 in");
  browser("find", "role", "checkbox", "click", "--name", "Height: 118 in");
  browser("find", "role", "button", "click", "--name", "Save selected reviewed answers");
  browser("wait", "--fn", "!document.querySelector('.sourcing-proposal input:checked')");
  browser("find", "role", "button", "click", "--name", "Vehicles & fit");
  browser("wait", "--text", "Decision for this pairing");
  scrollTo("Can this candidate meet the need?");
  browser("wait", "1000");
  browser("record", "stop");
  check(text("118 in"));
  capture("height-accepted");

  // The assistant opens the same fit card from saved records and only proposes.
  browser(
    "eval",
    "document.querySelector('#sale-chat').open || [...document.querySelectorAll('button')].find(b => b.textContent.includes('Account assistant'))?.click()",
  );
  browser("fill", "#sale-message", "What does the seller's note say about height?");
  browser("find", "role", "button", "click", "--name", "Send to account assistant");
  browser("wait", "--text", "review the proposal before deciding");
  check("document.querySelector('#sale-chat').innerText.includes('Height ≤125 in')");
  capture("assistant-fit-card");
  browser("find", "role", "button", "click", "--name", "Minimize account assistant");
  scrollTo("Decision for this pairing");
  check(`${text("No recommendation until")} || ${text("Investigate")}`);
  capture("decision-open");

  browser("set", "viewport", "390", "844", "2");
  browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  check("document.documentElement.scrollWidth <= innerWidth");
  capture("research-narrow");
  browser("open", `${origin}/desk/sourcing/unavailable-case`);
  browser("wait", "--text", "Sourcing case unavailable.");
  check(`!${text("Cedar Valley")}`);
  capture("case-unavailable");
  console.log(
    "Browser passed: queue, rejected pairing basis, recorded reply review, assistant fit card, narrow overflow and unavailable-case privacy. Controlled identity provider only.",
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  finish(failure);
}
