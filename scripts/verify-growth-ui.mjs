import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const origin = process.env.GROWTH_REVIEW_ORIGIN;
const cookie = process.env.GROWTH_REVIEW_COOKIE;
const account = process.env.GROWTH_REVIEW_ACCOUNT;
const organization = process.env.GROWTH_REVIEW_ORGANIZATION;
assert.ok(
  origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && cookie && account && organization,
  "Use only the disposable growth.test.ts fixture and its controlled local identity provider.",
);
const session = "growth-review";
const output = resolve(".amp/in/artifacts/growth");
const scratch = mkdtempSync(join(tmpdir(), "growth-browser-"));
const browsers = join(process.env.HOME, ".agent-browser/browsers");
const chrome = join(
  browsers,
  readdirSync(browsers)
    .filter((name) => name.startsWith("chrome-"))
    .sort()
    .at(-1),
  "chrome",
);
const wrapper = join(scratch, "chrome.sh");
writeFileSync(
  wrapper,
  `#!/bin/sh\nexec '${chrome}' '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4' "$@"\n`,
  { mode: 0o700 },
);
mkdirSync(output, { recursive: true });
const browser = (...args) =>
  execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 45000,
  });
const check = (expression) => assert.equal(browser("eval", expression).trim(), "true", expression);
const capture = (name) => {
  browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  browser("screenshot", join(output, `${name}.png`));
};
const pointAt = (selector) => {
  const point = JSON.parse(
    browser(
      "eval",
      `(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
  })()`,
    ),
  );
  browser(
    "mouse",
    "move",
    String(point.x),
    String(point.y),
    "--human",
    "--duration",
    "650",
    "--steps",
    "24",
  );
};
try {
  browser("--executable-path", wrapper, "open", origin);
  const separator = cookie.indexOf("=");
  browser(
    "cookies",
    "set",
    cookie.slice(0, separator),
    cookie.slice(separator + 1),
    "--url",
    origin,
    "--httpOnly",
    "--sameSite",
    "Lax",
  );
  browser("set", "viewport", "1280", "960", "2");
  browser("open", `${origin}/desk/prospects/${account}`);
  browser("wait", "--text", "Expected effort is uncertain");
  check("devicePixelRatio === 2 && matchMedia('(hover: hover)').matches");
  check(
    "document.body.innerText.includes('my team might struggle') && document.body.innerText.includes('1 distinct correlated')",
  );
  capture("account-default");
  browser("eval", "document.querySelector('input[name=name]').scrollIntoView({block:'center'})");
  browser("record", "start", join(output, "review-interaction.mp4"), "--fps", "5", "--cursor");
  pointAt("select[name=fit]");
  pointAt("input[name=name]");
  browser("click", "input[name=name]");
  browser("press", "Control+a");
  browser("type", "input[name=name]", "Reviewed NY department");
  check("document.querySelector('input[name=name]').value === 'Reviewed NY department'");
  browser("wait", "1000");
  browser("eval", "document.querySelector('.growth-form button').scrollIntoView({block:'center'})");
  pointAt("textarea[name=contactProvenance]");
  pointAt(".growth-form button");
  browser("find", "role", "button", "click", "--name", "Save human review");
  browser("wait", "--text", "Saved. No external delivery");
  browser("wait", "--fn", "document.querySelector('h1').textContent === 'Reviewed NY department'");
  check("document.querySelector('h1').textContent === 'Reviewed NY department'");
  pointAt("textarea[name=contactProvenance]");
  browser("wait", "1000");
  browser("eval", "document.querySelector('h1').scrollIntoView({block:'center'})");
  browser("wait", "1000");
  browser("record", "stop");
  capture("review-saved");
  browser(
    "eval",
    "[...document.querySelectorAll('h2')].find(h => h.textContent === 'Original answers').scrollIntoView({block:'start'})",
  );
  check("document.body.innerText.includes('Email reply · growth-reply-event')");
  capture("original-answers");
  browser(
    "eval",
    "document.querySelector('textarea[name=detail]').scrollIntoView({block:'center'})",
  );
  browser("record", "start", join(output, "outcome-interaction.mp4"), "--fps", "5", "--cursor");
  for (const [kind, detail] of [
    ["intervention", "Reviewed synthetic specification"],
    ["progressed", "Synthetic deal progressed after review"],
  ]) {
    pointAt("select[name=kind]");
    browser("select", "select[name=kind]", kind);
    browser("fill", "textarea[name=detail]", detail);
    browser("fill", "input[name=evidence]", "Synthetic operator fixture, not customer validation");
    browser(
      "eval",
      "document.querySelector('textarea[name=detail]').closest('form').querySelector('button').scrollIntoView({block:'center'})",
    );
    pointAt("textarea[name=detail]");
    pointAt("form:has(textarea[name=detail]) button");
    browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Record evidence-backed outcome",
      "--exact",
    );
    browser("wait", "--text", detail);
  }
  browser("reload");
  browser("wait", "--text", "Synthetic deal progressed after review");
  check(
    "[...document.querySelectorAll('p.growth-quote')].filter(p => p.textContent.includes('Reviewed synthetic specification')).length === 1 && [...document.querySelectorAll('p.growth-quote')].filter(p => p.textContent.includes('Synthetic deal progressed after review')).length === 1",
  );
  browser(
    "eval",
    "[...document.querySelectorAll('p.growth-quote')].find(p => p.textContent.includes('Synthetic deal progressed after review')).scrollIntoView({block:'center'})",
  );
  browser("record", "stop");
  capture("repeated-outcomes");
  browser("fill", "input[name=subject]", "Synthetic blocked outreach");
  browser("fill", "textarea[name=body]", "Synthetic only. Reply STOP to opt out.");
  browser("find", "role", "button", "click", "--name", "Approve and queue sequence", "--exact");
  browser("wait", "--text", "This recipient is suppressed.");
  capture("suppressed-outreach");
  browser("open", `${origin}/desk/municipalities/${encodeURIComponent(organization)}`);
  browser("wait", "--text", "Expected effort is uncertain");
  check(
    "document.body.innerText.includes('Active acquisition') && document.body.innerText.includes('needs human review')",
  );
  capture("existing-account-default");
  browser("eval", "document.querySelector('.growth-card').scrollIntoView({block:'start'})");
  capture("existing-account-enrichment");
  browser("open", `${origin}/desk/growth`);
  browser("wait", "--text", "A loop you can inspect.");
  check(
    "document.body.innerText.includes('External delivery disabled') && document.body.innerText.includes('1 owned accounts displayed')",
  );
  capture("operations");
  browser(
    "eval",
    "[...document.querySelectorAll('h2')].find(h => h.textContent === 'Integration boundaries').scrollIntoView({block:'start'})",
  );
  check("document.body.innerText.includes('Scheduled work and recovery')");
  capture("operations-schedules");
  browser("open", `${origin}/desk/prospects`);
  browser("wait", "--text", "Reviewed NY department");
  capture("prospect-inbox");
  browser("set", "viewport", "390", "844", "2");
  browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  check("document.documentElement.scrollWidth <= innerWidth");
  capture("prospect-narrow");
  browser("open", `${origin}/desk/prospects/unavailable-account`);
  browser("wait", "--text", "Account unavailable.");
  check("!document.body.innerText.includes('my team might struggle')");
  capture("account-unavailable");
  console.log(
    "Browser passed: persisted review, suppression error, direct account enrichment, operations, narrow overflow and unavailable-account privacy. Controlled identity provider only.",
  );
} catch (error) {
  console.error(browser("get", "url"));
  console.error(browser("get", "text", "body"));
  throw error;
} finally {
  try {
    browser("record", "stop");
  } catch {
    /* Recording may already be closed. */
  }
  browser("close");
  rmSync(scratch, { recursive: true, force: true });
}
