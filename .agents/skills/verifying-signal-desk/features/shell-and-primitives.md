# Shell and primitives

## Sub-features

Dispatch shell with main navigation and skip link, palette and type specimens, action and badge
states, and the request-a-source form with native required validation.

## How to get to it (user POV)

Open Workspace / Dispatch and Primitives / Foundations in Storybook. The app's workspace shell and
forms use the same tokens and components.

## Driving it with agent-browser

Run the skill's helper. Dispatch must show its heading and review and draft cards; Foundations must
show the type heading, a disabled action and the form. The evidence-form play function types into
Source name.

## Gotchas

Dispatch navigation links are `#` anchors, so `aria-current` stays on Workspace. Action buttons
have no handlers, and the form saves and sends nothing.
