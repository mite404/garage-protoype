// Adapted from mite404/yaklabs packages/runtime/src/markdown.ts, Quiet prose (ADR-140).
import type { Block } from "./prose-model";
import { parseInline } from "./markdown-inline";

// A source line, classified. A heading or list marker with nothing after it yet is kept
// empty, so a marker still streaming in shows nothing rather than a stray "#" or "-".
type Line =
  | { kind: "blank" }
  | { kind: "rule" }
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string }
  | { kind: "text"; text: string; indented: boolean };

// The block being gathered while the lines fold: paragraph lines or list items.
type Open = { kind: "paragraph"; lines: string[] } | { kind: "list"; items: string[] } | null;
type Folding = { blocks: Block[]; open: Open };

type LineOf = { [L in Line as L["kind"]]: L };
type Folds = { [K in keyof LineOf]: (state: Folding, line: LineOf[K]) => Folding };

const HEADING = /^ {0,3}#{1,6}(?:\s+(.*))?$/;
const BULLET = /^ {0,3}[-*+](?:\s+(.*))?$/;
const NUMBERED = /^ {0,3}\d{1,9}[.)]\s+(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

const EMPTY: Folding = { blocks: [], open: null };

function classify(source: string): Line {
  if (source.trim() === "") return { kind: "blank" };
  if (RULE.test(source)) return { kind: "rule" };
  const heading = HEADING.exec(source);
  if (heading) return { kind: "heading", text: (heading.at(1) ?? "").trim() };
  const item = BULLET.exec(source) ?? NUMBERED.exec(source);
  if (item) return { kind: "item", text: (item.at(1) ?? "").trim() };
  return { kind: "text", text: source.trim(), indented: /^\s/.test(source) };
}

function closeBlock(blocks: Block[], open: Open): Block[] {
  if (open === null) return blocks;
  if (open.kind === "list") {
    const items = open.items.map((item) => parseInline(item)).filter((item) => item.length > 0);
    return items.length === 0 ? blocks : [...blocks, { kind: "list", items }];
  }
  const content = parseInline(open.lines.join(" "));
  return content.length === 0 ? blocks : [...blocks, { kind: "paragraph", content }];
}

// A blank line or a rule ends whatever block is open.
function foldBreak({ blocks, open }: Folding): Folding {
  return { blocks: closeBlock(blocks, open), open: null };
}

// A heading stands alone; one with no words yet adds nothing.
function foldHeading({ blocks, open }: Folding, line: LineOf["heading"]): Folding {
  const content = parseInline(line.text);
  const closed = closeBlock(blocks, open);
  return {
    blocks: content.length === 0 ? closed : [...closed, { kind: "heading", content }],
    open: null,
  };
}

// An item joins the open list, or closes what is open and starts one.
function foldItem({ blocks, open }: Folding, line: LineOf["item"]): Folding {
  if (open?.kind === "list")
    return { blocks, open: { kind: "list", items: [...open.items, line.text] } };
  return { blocks: closeBlock(blocks, open), open: { kind: "list", items: [line.text] } };
}

// Text continues an open paragraph, or an indented line continues the last list item;
// anything else starts a paragraph.
function foldText({ blocks, open }: Folding, line: LineOf["text"]): Folding {
  if (open?.kind === "paragraph")
    return { blocks, open: { kind: "paragraph", lines: [...open.lines, line.text] } };
  if (open?.kind === "list" && line.indented) {
    const items = [...open.items.slice(0, -1), `${open.items.at(-1) ?? ""} ${line.text}`];
    return { blocks, open: { kind: "list", items } };
  }
  return { blocks: closeBlock(blocks, open), open: { kind: "paragraph", lines: [line.text] } };
}

const FOLDS: Folds = {
  blank: foldBreak,
  rule: foldBreak,
  heading: foldHeading,
  item: foldItem,
  text: foldText,
};

// Folds one line into the blocks so far and the block still open. `kind` travels beside
// `line` so the lookup and the handler's input stay paired.
function fold<K extends keyof LineOf>(state: Folding, kind: K, line: LineOf[K]): Folding {
  return FOLDS[kind](state, line);
}

const foldLine = (state: Folding, line: Line): Folding => fold(state, line.kind, line);

/**
 * Parses a reply's markdown into Quiet prose blocks (ADR-140), tolerating a source that is
 * still streaming in: an unclosed `**`, `*`, `_` or backtick shows as its kind with the
 * marker hidden, and a link shows only its text until its url closes. Headings of any level,
 * `-`, `*` and numbered lists, and paragraphs split on blank lines. Never throws.
 */
export function parseQuietProse(source: string): Block[] {
  const lines = source.split(/\r?\n/).map((line) => classify(line)); // → Line[]
  const folded = lines.reduce((state, line) => foldLine(state, line), EMPTY); // → Folding
  return closeBlock(folded.blocks, folded.open); // → Block[]
}
