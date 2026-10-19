import assert from "node:assert/strict";
import { join } from "node:path";
import { openEvidenceSession } from "./browser-evidence.mjs";

const origin = process.env.POSTHOG_REVIEW_ORIGIN;
const cookie = process.env.POSTHOG_REVIEW_COOKIE;
const account = process.env.POSTHOG_REVIEW_ACCOUNT;
const state = process.env.POSTHOG_REVIEW_STATE;
assert.ok(origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && cookie && account);
assert.ok(["disabled", "assigned", "delivered"].includes(state));
const { browser, output, capture, finish } = openEvidenceSession({
  session: "posthog-trial",
  folder: "posthog-trial",
  origin,
  cookie,
});
const check = (expression) => assert.equal(browser("eval", expression).trim(), "true", expression);
let failure;
try {
  browser("open", `${origin}/desk/prospects/${account}`);
  browser("wait", "--text", "Reviewed outreach trial");
  browser("eval", "document.querySelector('textarea[name=body]').scrollIntoView({block:'center'})");
  check(
    `document.querySelector('textarea[name=body]').readOnly === ${state !== "disabled"} && document.querySelector('input[name=subject]').readOnly === ${state !== "disabled"}`,
  );
  check(
    `document.body.innerText.includes(${JSON.stringify({ disabled: "Trial disabled", assigned: "Not exposed", delivered: "Delivery confirmed" }[state])})`,
  );
  capture(`${state}-desktop`);
  if (state === "assigned") {
    browser("record", "start", join(output, "frozen-review.mp4"), "--fps", "5", "--cursor");
    const before = browser("eval", "document.querySelector('textarea[name=body]').value");
    for (const selector of ["input[name=subject]", "textarea[name=body]"]) {
      const [x, y] = JSON.parse(
        browser(
          "eval",
          `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [Math.round(r.left+20),Math.round(r.top+20)]})()`,
        ),
      );
      browser(
        "mouse",
        "move",
        String(x),
        String(y),
        "--human",
        "--duration",
        "650",
        "--steps",
        "24",
      );
    }
    browser("click", "textarea[name=body]");
    browser("press", "Control+a");
    browser("press", "x");
    assert.equal(browser("eval", "document.querySelector('textarea[name=body]').value"), before);
    browser("press", "Tab");
    check("document.activeElement.tagName === 'BUTTON'");
    check(
      "document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none'",
    );
    browser("wait", "3000");
    browser("record", "stop");
  }
  browser("set", "viewport", "390", "844", "2");
  browser("eval", "document.querySelector('textarea[name=body]').scrollIntoView({block:'center'})");
  check("document.documentElement.scrollWidth <= innerWidth");
  capture(`${state}-narrow`);
  browser("set", "viewport", "1280", "960", "2");
  browser("open", `${origin}/desk/growth`);
  browser("wait", "--text", "Reviewed outreach trial · 14-day qualified replies");
  check(
    "document.body.innerText.includes('No winner is established') && document.body.innerText.includes('Email/Google Forms surveys are unchanged')",
  );
  capture(`${state}-report`);
  console.log(
    "experiment UI passed: frozen review, exposure status, scoped report, narrow overflow",
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  finish(failure);
}
