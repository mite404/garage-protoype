# Chat workspace

## Sub-features

Sale assistant and Email draft windows, light and dark themes, minimize and reopen launchers,
Escape to minimize, draft edits retained across minimize and close, saved draft text in the chat
card, resizable editor, and locally composed messages with Ctrl or Cmd+Enter.

## How to get to it (user POV)

Open Conversation / Chat workspace in Storybook. It is a synthetic composition for reviewing popup
interactions; production uses the municipality Sale assistant instead.

## Driving it with agent-browser

Run the skill's helper. Opening a story runs its play function, which performs the clicks and
typing; the helper waits for it to finish and fails on Storybook's error display. Retains draft
edits and Composes local message prove interactions; Light and Dark prove bubble contrast.
Minimized stories must show only the launchers. Inspect light and dark screenshots.

## Gotchas

Theme is the root `data-theme` attribute, not a media query. "Close" only minimizes, and edits
last until reload. "Preview message added. No model connected." is the only reply.
