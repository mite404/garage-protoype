# Sourcing department workspace

## Sub-features

Seller-candidate department page for one buyer need: next action, why the department is here (buyer
need, inventory search, cited source change as a research trigger), fit table with explicit
unknowns, outreach status with an editable information request, original replies with
selected-field acceptance, and the pairing decision. The same cards render narrow for chat.

## How to get to it (user POV)

App: Sourcing in the workspace navigation lists the specialist's own pairings at `/desk/sourcing`;
with none, Create synthetic walkthrough seeds the Pine Brook need and Cedar Valley seller. Each
pairing opens at `/desk/sourcing/[caseId]` with the Sourcing assistant popup. Storybook:
Sourcing / Department workspace.

## Driving it with agent-browser

Storybook: run the skill's helper. Research saves a draft only after the body keeps its STOP line.
Reply rejects pairing accepts only the 121 in height, checks the fit row fails while sale timing
stays proposed, then records a rejection. Conflict and stale shows two accepted heights that
disagree as unresolved and a decision made against an older need revision as stale. The pairing
rules live in `packages/contracts/src/sourcing-schema.test.ts`.

App: after `npm run build`, run `apps/web/src/server/sourcing.test.ts` with
`SOURCING_BROWSER_EVIDENCE=1` and a disposable database. It drives `scripts/verify-sourcing-ui.mjs`
through the queue, the rejected Pine Brook pairing, a second need for the same seller, a recorded
reply accepted into the fit table, and one synthetic model turn that opens the fit card and
proposes a cited height. Screenshots and `reply-review.mp4` land in `.amp/in/artifacts/sourcing/`.

## Gotchas

A source change never establishes availability, authority or contact permission. Unknown height
is unresolved, never a pass, and price alone never establishes all-in cost. Proceed stays
disabled until every constraint is met by accepted facts. Delivery is always disabled.
Pairing outreach enrolls through growth with purpose `sourcing`; growth stops follow-up on a
reply or opt-out, but a pairing rejection does not stop that pairing's queued request yet.
