---
linear: ETH-77
github: 5
filed: 2026-10-15
---
# Connect approved evidence to buyer assistance and handoff

## Status
- **Goal**: Answer supported buyer questions and retain conditional offers for human review.
- **Initial priority**: P1
- **Effort**: Large
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

The review workspace earns its place when an interested buyer gets a supported answer and a
specialist receives the next action without an unauthorized commercial commitment.

## Current state

The product plan specifies cited answers and qualified handoffs. No buyer interface exists.
Evidence publication and photo review are specified in tickets 003 and 004.

## Approach

Build a connected vehicle view from a server-filtered public projection. Require invited identity
and inference permission for model-backed questions. Give the model only permitted approved
evidence, and validate citations before showing an answer. Unsupported questions become specialist
tasks. Capture offers as structured human handoffs rather than autonomous negotiation.

## Scope

* In: R1, R6, R7, R8, R9, and R11; F3 and F4; AE1, AE4, and AE6.
* In: R12 inquiry classification and F5 seller handoff; AE7 and AE8.
* In: Cited answers, unresolved tasks, offer amount, timing, conditions, and unsent follow-up.
* Out: Counteroffers, accepted offers, delivery promises, payments, and external messages.

## Steps

* Depend on tickets 001 through 004 and reuse their access and spending operations.
* Implement anonymous approved-record viewing and invited buyer conversations.
* Validate supported answers against actual approved claims and citations.
* Implement R12 inquiry routing: supported question, missing or conflicting evidence, explicit
  conditional offer, or human review. Preserve the message and basis; allow specialist correction.
* For seller-dependent questions, retain the question, blocker, assignee, and seller-request draft.
* After ticket 003 reviews a permissioned seller response, prepare a cited buyer follow-up without
  automatically resolving unsupported conditions or sending a message.
* Persist assigned handoffs and reviewable follow-ups without duplicating repeated submissions.

## Test plan

* Ask tank capacity before and after conflict resolution; answer only the reviewed supported value.
* Submit $165,000 subject to pump-test review and delivery before December; retain all conditions.
* Ask an unsupported question and verify a visible assigned review task replaces a guessed answer.
* Attempt source prompt injection and cross-buyer access; verify no private content reaches output.
* Run AE7 end to end: question, seller-request draft, reviewed response, and cited buyer follow-up.
* Contrast an ambiguous inquiry with an explicit offer; only the offer creates an offer handoff.

## Done when

* A buyer question produces a supported cited answer or an explicit human-review task.
* A specialist sees an accurate conditional handoff and unsent follow-up.
* Seller handoff retains the buyer's blocker and proposed recipient; all delivery remains simulated.
* Public reads never spend inference tokens or expose private negotiations.

## Notes

Risk: HIGH. An offer acknowledgement is receipt, not acceptance. Use the supplied specification
table and messaging screenshots for visual language without copying unrelated marketplace features.
