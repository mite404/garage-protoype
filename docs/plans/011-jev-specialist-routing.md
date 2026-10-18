---
linear: ETH-83
github: 15
filed: 2026-10-18
---
# Add Jev routing suggestions for the Sales Specialist

## Status
- **Goal**: Use Jev to turn a specialist's free-text question or an uploaded document into a
  typed routing suggestion that code and the specialist confirm.
- **Initial priority**: P2
- **Effort**: Medium
- **Risk**: MEDIUM
- **Category**: feature
- **Planned at**: commit `b0d4831`, 2026-10-18

## Why this matters

Routing is an exact-phrase matcher today. "What was the pump-test result?" maps to a field, but
"is the pump test done?" falls through to a human. The specialist then routes questions by hand
that ordinary wording should already cover. ADR-007 and the viability decisions scope Jev for
exactly this kind of bounded classification.

## Current state

* `routeQuestion` in `packages/contracts/src/assistance-schema.ts` accepts only whole,
  single-field question forms. Everything else needs human interpretation.
* Specialists can correct routing (`correctInquiry`), so the correction history exists.
* Jev is not implemented. `docs/evaluation.md` records that a Jev versus single-model comparison
  was unavailable.
* `TYPESAFE_API_KEY` is configured as a project secret for `@typesafe-ai/sdk`.

## Approach

* Code stays in charge. Jev returns typed answers with probabilities. Code applies thresholds, and
  low confidence becomes "needs human review". The exact-phrase matcher still runs first.
* Jev suggests only. It never grants access, widens visibility, answers buyers, or replaces the
  specialist's routing correction.
* The first candidate use is routing a specialist's free-text question to one evidence field.
  The implementing thread confirms the use with Ethan in a short design before writing code;
  classifying uploaded seller documents is the alternative.
* Rejected: using Jev on the buyer or seller side. Signal Desk is an internal specialist tool.
* Rejected: an LLM prompt-and-parse step for routing. Jev's typed answers and probabilities give
  thresholds code can test, at lower cost and latency.

## Scope

* In: one Jev integration for the specialist workflow, its spending bound, thresholds, the
  needs-review state, and a labeled evaluation against the current matcher.
* Out: buyer-facing or seller-facing AI.
* Out: replacing extraction or drafting models, which have different jobs (ADR-007).

## Steps

* Post the design: the use, the Jev questions, the thresholds, and how it fits the flow.
* Add the TypeSafe SDK client behind the existing spending admission or an equivalent bound.
* Route through the matcher, then Jev, then thresholds, then a suggestion or human review.
* Show the suggestion and its confidence to the specialist, with correction still available.
* Evaluate on held-out examples against the current matcher.

## Test plan

* A controlled fake drives above-threshold, below-threshold and error responses. Only an
  above-threshold answer becomes a suggestion.
* Exact-phrase questions keep their current routing with no Jev call.
* Revoked access and missing budget stop before any paid call.
* A small labeled real-Jev check reports accuracy, latency and cost against the matcher.

## Done when

* A paraphrased specialist question routes to the right field as a suggestion the specialist
  can accept or correct.
* Low-confidence answers and Jev failures fall back to human review.
* Evaluation numbers against the current matcher are recorded in `docs/evaluation.md`.

## Notes

* Risk: MEDIUM, because a confident wrong suggestion could misroute a question. Mitigated by
  human confirmation and thresholds.
* In progress on branch `feat/jev`.
