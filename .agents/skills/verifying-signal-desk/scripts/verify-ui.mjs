#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const origin = process.argv[2] ?? "http://localhost:6106";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = join(root, ".amp/in/artifacts/legibility");
const session = `verify-${process.pid}`;
const variants = [
  "cited-answer",
  "conflict",
  "needs-review",
  "unknown",
  "human-review",
  "offer-not-accepted",
  "empty-conditions",
  "unsent-draft",
  "stale-draft",
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
function open(id, selector) {
  browser("open", `${origin}/iframe.html?id=${id}&viewMode=story`);
  browser("wait", selector);
  assert.equal(
    evaluate(
      '[...document.querySelectorAll(".sb-errordisplay,vite-error-overlay")].some(e=>e.checkVisibility())',
    ),
    false,
  );
}
function capture(name) {
  browser("screenshot", "--full", join(output, `${name}.png`));
}

mkdirSync(output, { recursive: true });
try {
  for (const variant of variants) {
    open(`agent-catalog-assistance-cards--${variant}`, "[data-card]");
    browser("set", "viewport", "1280", "900", "2");
    assert.equal(evaluate('document.querySelectorAll("[data-card]").length'), 1);
    if (variant === "conflict") {
      assert.equal(
        evaluate('document.querySelector("[data-card] h3").textContent'),
        "What is the tank capacity?",
      );
      assert.equal(evaluate('document.querySelectorAll(".card-next-action li").length'), 2);
      assert.equal(
        evaluate('document.querySelector(".card-next-action strong").textContent'),
        "Compare both sources before answering.",
      );
      assert.equal(
        evaluate('document.querySelector(".card-next-action em").textContent'),
        "Neither value is approved for a buyer reply.",
      );
    }
    capture(variant === "conflict" ? "conflict" : variant);
  }
  open("conversation-reading--structured-response", ".quiet-prose h4");
  assert.deepEqual(
    evaluate(
      '({size:getComputedStyle(document.querySelector(".quiet-prose")).fontSize,line:getComputedStyle(document.querySelector(".quiet-prose")).lineHeight,gap:getComputedStyle(document.querySelector(".quiet-prose p")).marginBottom})',
    ),
    { size: "15px", line: "24px", gap: "16px" },
  );
  capture("prose");
  open("conversation-reading--literal-evidence", ".literal-prose");
  assert.equal(
    evaluate('document.querySelectorAll(".literal-prose strong,.literal-prose script").length'),
    0,
  );
  assert.ok(
    evaluate('document.querySelector(".literal-prose").textContent').includes(
      "<script>not executable</script>",
    ),
  );
  open("conversation-reading--connected-turn", ".conversation-turn");
  assert.equal(
    evaluate('document.querySelectorAll(".conversation-response > .quiet-prose > p").length'),
    2,
  );
  capture("conversation");
  browser("set", "viewport", "390", "844", "2");
  evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  assert.equal(evaluate("document.documentElement.scrollWidth"), 390);
  capture("narrow");
  console.log(`UI checks passed. Review screenshots in ${output}`);
} finally {
  browser("close");
}
