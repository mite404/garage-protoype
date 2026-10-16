import type { ReactNode } from "react";
import { parseQuietProse } from "./markdown";
import type { Inline } from "./prose-model";

const marks = { strong: "strong", em: "em", code: "code" } satisfies Record<
  string,
  "strong" | "em" | "code"
>;

function Inlines({ content }: { content: Inline[] }) {
  return content.map((inline, i) => {
    if (inline.kind === "link")
      return (
        <a key={i} href={inline.href} rel="noreferrer">
          {inline.text}
        </a>
      );
    if (!inline.mark) return inline.text;
    const Tag = marks[inline.mark];
    return <Tag key={i}>{inline.text}</Tag>;
  });
}

/** Yaklabs' reading treatment for authored paragraphs, findings, caveats, lists, and safe links.
 * Raw HTML stays escaped text. This is a Markdown subset, not a source-verification boundary.
 */
export function Prose({ text }: { text: string }) {
  return (
    <div className="quiet-prose">
      {parseQuietProse(text).map((block, i) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p key={i}>
                <Inlines content={block.content} />
              </p>
            );
          case "heading":
            return (
              <h4 key={i}>
                <Inlines content={block.content} />
              </h4>
            );
          case "list":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines content={item} />
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}

/** Literal user messages, source excerpts and drafts preserve words, line breaks and paragraphs. */
export function LiteralProse({ text }: { text: string }) {
  return (
    <div className="quiet-prose literal-prose">
      {text.split(/\r?\n\s*\r?\n/).map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </div>
  );
}

/** Keeps a request and its result together, with supporting content one reading step below. */
export function ConversationTurn({ request, children }: { request: string; children: ReactNode }) {
  return (
    <article className="conversation-turn">
      <div className="conversation-request">
        <p className="reading-label">Specialist</p>
        <LiteralProse text={request} />
      </div>
      <div className="conversation-response">{children}</div>
    </article>
  );
}
