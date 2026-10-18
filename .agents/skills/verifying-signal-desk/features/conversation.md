# Conversation reading

## Sub-features

Paragraphs, headings, strong findings, italic caveats, lists, inline code, safe links, literal
quotes, request/response grouping and narrow reading layouts.

## How to get to it (user POV)

Open Conversation / Reading in Storybook; production uses the same components inside an invited
specialist's opportunity conversation.

## Driving it with agent-browser

Run the skill's helper. Assert strong and em are semantic tags, body is 15px/24px, paragraphs have
16px separation, and the 390px document does not overflow. Check literal Markdown and HTML stay
text rather than becoming emphasis or executable nodes. Inspect desktop and narrow screenshots.

## Gotchas

The prose parser is Yaklabs' limited Markdown subset, not CommonMark. Emphasis is authored, not
inferred from keywords. Live streaming exists only in the app: the opportunity stream route runs a
Flue agent through OpenRouter, and its tools can only show evidence-checked cards and prepare
unsent drafts. Reading stories are synthetic and connect no model. Nothing is sent externally.
