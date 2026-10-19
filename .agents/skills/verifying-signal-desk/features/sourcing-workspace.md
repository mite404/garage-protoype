# Sourcing department workspace

## Sub-features

Seller-candidate department page for one buyer need: next action, why the department is here (buyer
need, inventory search, cited source change as a research trigger), fit table with explicit
unknowns, outreach status with an editable information request, original replies with
selected-field acceptance, and the pairing decision. The same cards render narrow for chat.

## How to get to it (user POV)

Storybook only: Sourcing / Department workspace. No app route or persistence exists yet; server
wiring waits for the growth owner's frozen snapshot and an approved pairing migration.

## Driving it with agent-browser

Run the skill's helper. Research saves a draft only after the body keeps its STOP line.
Reply rejects pairing accepts only the 121 in height, checks the fit row fails while sale timing
stays proposed, then records a rejection. Conflict and stale shows two accepted heights that
disagree as unresolved and a decision made against an older need revision as stale. The pairing
rules live in `packages/contracts/src/sourcing-schema.test.ts`.

## Gotchas

A source change never establishes availability, authority or contact permission. Unknown height
is unresolved, never a pass, and price alone never establishes all-in cost. Proceed stays
disabled until every constraint is met by accepted facts. Delivery is always disabled.
