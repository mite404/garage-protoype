# Sourcing department workspace

## Sub-features

Account-first page for one buyer-seller connection (ADR-039), inside the specialist desk shell (Work
queue, Buyer needs, Accounts, Outcomes). A persistent header and tabs keep the account in view:
Overview (next action, connection progress from investigating through ready for buyer review and
introduced to sale closed, with the introduction and sale notes, why the account is here, fit table
with explicit unknowns, contact readiness, information to request), Vehicles & fit (fit and the
connection decision), Outreach (Contact review, Draft review, Delivery and Reply steps, with the
unsent request, the delivery lock, original replies, selected-field acceptance and a rule-derived
next action), Sources and Activity. The Account assistant is docked beside the page at 1180px and
wider and collapses to a launcher below that. Its cards open the same page sections. The prospect
account page uses the same header and tabs, a pipeline rail and growth controls. Qualifying its
reply drafts an unpublished listing; its Listings card opens a connection toward a buyer need, and
its dock lists analyst proposals and connections.

## How to get to it (user POV)

App: Buyer needs at `/desk/sourcing` lists the specialist's own needs with their connections,
records a new need and connects a seller or listed vehicle to it; with no connection, Create
synthetic walkthrough seeds the Pine Brook need and Cedar Valley seller. The Work queue at `/desk`
leads with Active deals, the open connections ordered by those waiting on the rep and then
closeness to a sale, then Sourcing prospects and Buyer accounts. Each connection opens at
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
`npm run test:e2e` drives seller qualification, both connection directions, a recorded buyer need,
and an introduction and closed sale that closes the competing connections.

## Gotchas

A source change never establishes availability, authority or contact permission. Unknown height
is unresolved, never a pass, and price alone never establishes all-in cost. Proceed stays
disabled until every constraint is met by accepted facts. Delivery is always disabled.
Introduction needs a current proceed decision and the seller's listing; a closed sale fulfils the
need and closes every other open connection for that need or vehicle. Both only record what people
did; nothing is sent, reserved or committed.
Pairing outreach enrolls through growth with purpose `sourcing`; growth stops follow-up on a
reply or opt-out, but a pairing rejection does not stop that pairing's queued request yet.
