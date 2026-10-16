// Adapted from Yaklabs' Quiet prose contract. Emphasis is authored, never inferred from words.
export type Inline =
  | { kind: "run"; text: string; mark?: "strong" | "em" | "code" }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph" | "heading"; content: Inline[] }
  | { kind: "list"; items: Inline[][] };

/** Plain text, with no inferred emphasis. */
export const text = (value: string): Inline => ({ kind: "run", text: value });
/** An authored finding, decision, or ask. */
export const strong = (value: string): Inline => ({ kind: "run", text: value, mark: "strong" });
/** An authored caveat or aside. */
export const em = (value: string): Inline => ({ kind: "run", text: value, mark: "em" });
/** An inline code literal. */
export const code = (value: string): Inline => ({ kind: "run", text: value, mark: "code" });
