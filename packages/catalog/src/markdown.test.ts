import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuietProse } from "./markdown";

test("conversation prose preserves authored hierarchy without inventing emphasis or unsafe links", () => {
  assert.deepEqual(
    parseQuietProse(
      "## Evidence needed\n\nThe tank remains **unconfirmed**.\n\n*Do not share a value.*\n\n- Brochure: 750 gal\n- Seller: 500 gal\n\nKeep `source_id` literal.\n\n[Source](https://example.test/report) and [unsafe](javascript:alert).",
    ),
    [
      { kind: "heading", content: [{ kind: "run", text: "Evidence needed" }] },
      {
        kind: "paragraph",
        content: [
          { kind: "run", text: "The tank remains " },
          { kind: "run", text: "unconfirmed", mark: "strong" },
          { kind: "run", text: "." },
        ],
      },
      { kind: "paragraph", content: [{ kind: "run", text: "Do not share a value.", mark: "em" }] },
      {
        kind: "list",
        items: [
          [{ kind: "run", text: "Brochure: 750 gal" }],
          [{ kind: "run", text: "Seller: 500 gal" }],
        ],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "run", text: "Keep " },
          { kind: "run", text: "source_id", mark: "code" },
          { kind: "run", text: " literal." },
        ],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "link", text: "Source", href: "https://example.test/report" },
          { kind: "run", text: " and unsafe." },
        ],
      },
    ],
  );
  assert.deepEqual(parseQuietProse("<script>alert(1)</script>\n\n500 gal is not approved."), [
    { kind: "paragraph", content: [{ kind: "run", text: "<script>alert(1)</script>" }] },
    { kind: "paragraph", content: [{ kind: "run", text: "500 gal is not approved." }] },
  ]);
});
