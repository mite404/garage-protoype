// Adapted from mite404/yaklabs packages/runtime/src/markdownInline.ts, Quiet prose (ADR-140).
import { code, em, strong, text, type Inline } from "./prose-model";

// Inline Markdown (ADR-140): emphasis, code and links inside one block's words, read left to
// right by one reader per marker. Each span also says whether more text could still change
// it, which is how a reply streaming in knows what it may show for good.

// Whether more text could still change a span: `none` never, `grows` only by lengthening it
// (plain text running to the end), `open` in any way (an unclosed span, or a marker that may
// yet open one).
type Hold = "none" | "grows" | "open";
// A span found at a position: what it shows, where the text after it starts, and its hold.
type Token = { segment: Inline; end: number; hold: Hold };
// Reads the span a marker opens at `at`, or declines for good (`no`) or until more text
// arrives (`later`), so the next reader can try.
type Reader = (source: string, at: number) => Token | "no" | "later";

const SPECIAL = /[`*_[]/;
const WORD = /\w/;
const SPACE = /\s/;
const SAFE_SCHEMES = new Set(["https:", "mailto:"]);

// Only https and mailto links are kept; any other scheme, or no scheme, stays plain text.
function safeHref(url: string): string | undefined {
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

// The words inside a span, with any markers nested in it dropped: Quiet prose is flat.
function plainText(source: string): string {
  return parseInline(source)
    .map((segment) => segment.text)
    .join("");
}

// The text between an opener and its closer. With no closer yet the span runs to the end,
// since the rest may still be streaming in.
function enclosed(
  source: string,
  from: number,
  close: number,
  width: number,
): { inner: string; end: number; hold: Hold } {
  if (close === -1) return { inner: source.slice(from), end: source.length, hold: "open" };
  return { inner: source.slice(from, close), end: close + width, hold: "none" };
}

function readCode(source: string, at: number): Token {
  const close = source.indexOf("`", at + 1);
  const { inner, end, hold } = enclosed(source, at + 1, close, 1);
  return { segment: code(inner), end, hold };
}

function readStrong(source: string, at: number): Token | "no" | "later" {
  if (!source.startsWith("**", at)) return at + 1 < source.length ? "no" : "later";
  if (SPACE.test(source.charAt(at + 2))) return "no";
  const close = source.indexOf("**", at + 2);
  const { inner, end, hold } = enclosed(source, at + 2, close, 2);
  return { segment: strong(plainText(inner)), end, hold };
}

// A closing `*` or `_` touches the word before it; a closing `_` also ends a word.
function emphasisClose(source: string, marker: string, from: number): number {
  for (let at = source.indexOf(marker, from); at !== -1; at = source.indexOf(marker, at + 1)) {
    const before = source.charAt(at - 1);
    const after = source.charAt(at + 1);
    if (!SPACE.test(before) && (marker === "*" || !WORD.test(after))) return at;
  }
  return -1;
}

// An opener must touch the word after it, and `_` must start a word, so "2 * 3" and
// snake_case stay text.
function opensEmphasis(source: string, at: number): boolean {
  if (SPACE.test(source.charAt(at + 1))) return false;
  return source.charAt(at) === "*" || !WORD.test(source.charAt(at - 1));
}

// `*x*` or `_x_`. A marker at the very end is hidden while more streams in; an opener glued to
// the word before it needs its closer before it counts. A `_` closer at the very end may yet
// be followed by a word, which would make it no closer.
function readEmphasis(source: string, at: number): Token | "no" | "later" {
  if (at + 1 === source.length) return { segment: text(""), end: at + 1, hold: "open" };
  if (!opensEmphasis(source, at)) return "no";
  const marker = source.charAt(at);
  const close = emphasisClose(source, marker, at + 1);
  if (close === -1 && WORD.test(source.charAt(at - 1))) return "later";
  const { inner, end, hold } = enclosed(source, at + 1, close, 1);
  const last = marker === "_" && end === source.length;
  return { segment: em(plainText(inner)), end, hold: last ? "open" : hold };
}

// `[text](url)`. Until the url closes, only the text shows; a finished link with an unsafe
// url shows its text alone. A bracket not followed by "(" is ordinary text.
function readLink(source: string, at: number): Token | "no" | "later" {
  const bracket = source.indexOf("]", at + 1);
  if (bracket === -1) {
    return { segment: text(plainText(source.slice(at + 1))), end: source.length, hold: "open" };
  }
  if (bracket + 1 === source.length) return "later";
  if (source[bracket + 1] !== "(") return "no";
  const label = plainText(source.slice(at + 1, bracket));
  const paren = source.indexOf(")", bracket + 2);
  if (paren === -1) return { segment: text(label), end: source.length, hold: "open" };
  const href = safeHref(source.slice(bracket + 2, paren).trim());
  const segment: Inline = href === undefined ? text(label) : { kind: "link", text: label, href };
  return { segment, end: paren + 1, hold: "none" };
}

// Ordinary text up to the next character that could open a span. `unsure` when a reader
// declined only until more text arrives, so the marker this text starts on may yet open one.
function readText(source: string, at: number, unsure: boolean): Token {
  const next = source.slice(at + 1).search(SPECIAL);
  const end = next === -1 ? source.length : at + 1 + next;
  const hold: Hold = unsure ? "open" : end === source.length ? "grows" : "none";
  return { segment: text(source.slice(at, end)), end, hold };
}

// The readers each marker can open, in the order they try; `**` is strong before `*` is em.
// Keep the keys in step with SPECIAL, which is where plain text stops to look.
const READERS: Partial<Record<string, readonly Reader[]>> = {
  "`": [readCode],
  "*": [readStrong, readEmphasis],
  _: [readEmphasis],
  "[": [readLink],
};

function readAt(source: string, at: number): Token {
  const readers = READERS[source.charAt(at)] ?? []; // → Reader[]
  let unsure = false;
  for (const read of readers) {
    const token = read(source, at); // → Token | "no" | "later"
    if (typeof token === "object") return unsure ? { ...token, hold: "open" } : token;
    unsure ||= token === "later";
  }
  return readText(source, at, unsure);
}

function readTokens(source: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < source.length;) {
    const token = readAt(source, at);
    tokens.push(token);
    at = token.end;
  }
  return tokens;
}

// A run of text with no mark: the only kind that joins its neighbour.
const isPlain = (segment: Inline): boolean => segment.kind === "run" && segment.mark === undefined;

// Empty spans vanish and neighbouring text joins, so the tree stays small and stable.
function tidy(segments: Inline[]): Inline[] {
  const kept: Inline[] = [];
  for (const segment of segments) {
    const last = kept.at(-1);
    if (segment.text === "") continue;
    if (last !== undefined && isPlain(last) && isPlain(segment))
      kept[kept.length - 1] = text(last.text + segment.text);
    else kept.push(segment);
  }
  return kept;
}

/** The inline content of a block's words: runs set strong, em or code, and safe links. */
export function parseInline(source: string): Inline[] {
  return tidy(readTokens(source).map((token) => token.segment));
}
