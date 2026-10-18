# Authored assistance cards

## Sub-features

Reviewed answer and citation; conflict, needs-review, unknown and human review; offer not
accepted, with and without conditions; unsent and stale drafts; a two-card evidence review. The
agent supplies references, not factual card values. Only the next action renders the restricted
Markdown subset; every other card field stays literal.
Review cards can carry a Jev routing suggestion: a suggested field with confidence and a
"Use suggested field" control, a needs-human-review reason, or an unavailable notice.

## How to get to it (user POV)

Open Storybook's Agent catalog / Assistance cards. Production cards appear in an authorized
opportunity's Specialist conversation, the municipality Sale assistant, and buyer inquiries with
buyer-safe data.

## Driving it with agent-browser

Run the skill's helper. Every variant must render its `[data-card]` and no visible Storybook error.
The conflict story must show its question, next action, two listed values, and review caveat.
Evidence review renders a review and an answer card together.
Inspect answer, offer, draft and stale screenshots; verify conditions and citations remain visible.

## Gotchas

Storybook source values are synthetic, not resolved production facts. Do not infer safety from a
badge: needs-review and unknown share the "Unknown · Review required" badge. Production
permissions and stale evidence are tested through the shared server operations.
A Jev suggestion is advisory. The button only calls the host's handler; acceptance, revision
checks and buyer stripping are tested in `jev-routing.test.ts`, not in Storybook.
