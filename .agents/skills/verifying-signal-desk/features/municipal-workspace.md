# Municipal sales workspace

## Sub-features

Department header, active acquisition with price, state and conditions, interested-in activity,
owned listings, empty and no-deal-terms states, light and dark themes, and the Sale assistant
popup with launcher, minimize, close, Escape and composer.

## How to get to it (user POV)

Storybook: Municipal sales / Workspace. App: sign in as a specialist who belongs to the seeded
opportunity, open Workspace, then the Austin Fire Department card. Seed with
`npm run db:seed:municipality`; without membership the page shows "Department unavailable."

## Driving it with agent-browser

Run the skill's helper. Chat-open stories run play functions that open the popup and check its
first message. Default, empty and no-deal-terms assert their visible copy; the default page is also
checked at 390px. `municipalities.test.ts` proves the real page, seed idempotence, photo approval,
bounded chat history and access revocation against the production build.

## Gotchas

Story and seed copy differ: the seeded condition is "Subject to review of the pump-test report."
The real page always has a deal, so no-deal-terms is Storybook only. The chat needs a model and
`OPENROUTER_API_KEY`; Storybook says "Synthetic preview · No model connected". No payments,
escrow or messages are sent.
