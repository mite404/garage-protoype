# Sourcing department workspace

## Sub-features

Account-first seller-candidate page for one buyer need, inside the specialist desk shell (Work
queue, Buyer needs, Accounts, Outcomes). A persistent header and tabs keep the account in view:
Overview (next action, why the account is here, fit table with explicit unknowns, contact
readiness, information to request), Vehicles & fit (fit and the pairing decision), Outreach (Contact
review, Draft review, Delivery and Reply steps, with the unsent request, the delivery lock,
original replies, selected-field acceptance and a rule-derived next action), Sources and Activity.
The Account assistant is docked beside the page at 1180px and wider and collapses to a launcher
below that. Its cards open the same page sections. The prospect account page uses the same header
and tabs, a pipeline rail and growth controls, and its dock lists analyst proposals and pairings.

## How to get to it (user POV)

App: Buyer needs lists the specialist's own pairings at `/desk/sourcing`, grouped by need; with
none, Create synthetic walkthrough seeds the Pine Brook need and Cedar Valley seller. The Work
queue at `/desk` lists the same pairings with prospects that need review. Each pairing opens at
`/desk/sourcing/[caseId]?tab=overview`. Storybook: Sourcing / Department workspace.

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
