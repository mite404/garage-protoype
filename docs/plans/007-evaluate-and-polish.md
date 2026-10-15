---
linear: ETH-79
github: 7
filed: 2026-10-15
---
# Verify the connected workflow and polish the interview demo

## Status
- **Goal**: Produce an honest, measured, reviewable demonstration of the complete slice.
- **Initial priority**: P2
- **Effort**: Medium
- **Risk**: MEDIUM
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

An attractive demo is insufficient if it guesses answers, loses corrections, leaks information,
or claims efficiency without a baseline.

## Current state

The plan requires approximately 15 to 20 labeled packets or conversations, including held-out
cases, and honest extraction, coverage, latency, and cost reporting. No evaluation exists yet.

## Approach

Create a rerunnable evaluation over synthetic or permissioned material and the real application
operations. Separate saved runs from live provider results. Exercise desktop and narrow layouts,
keyboard flows, and recovery on the actual stack. Fabricated conversion metrics and unit-only
screenshots lose because they do not demonstrate the connected specialist-to-buyer workflow.

## Scope

* In: AE1 through AE8, R9 through R12, privacy, auth denial, spend limits, and MCP parity.
* In: Held-out evaluation, measured results, visual polish, setup, and deployment readiness.
* Out: Production deployment without approval, real customer data, and fabricated sales outcomes.

## Steps

* Depend on tickets 001 through 006 and preserve the product plan's scope boundaries.
* Label contrasting packets and conversations before evaluating live results.
* Report extraction errors, unsupported answers, false coverage, duplicates, latency, and cost.
* Report classification mistakes separately: wrong sales routing, invented intent, and missed
  human-review cases. Include ambiguous inquiries and explicit offers in held-out examples.
* Compare Jev-assisted routing with a single-model baseline only if Jev is actually implemented.
* Rehearse the connected workflow, outages, reloads, retries, and revoked permissions.

## Test plan

* Run all eight acceptance examples on the application and assert observable persisted results.
* Rehearse messy input, source classification, cited buyer Q&A, seller-request draft, reviewed
  seller response, and specialist next action as one connected opportunity.
* Test concurrent admission and worker restart recovery without duplicate tasks or lost reviews.
* Inspect desktop and narrow captures, focus order, error states, and reduced motion.
* Verify a cold setup reproduces the demo without secrets in Git or misleading live-run labels.

## Done when

* A rerunnable report distinguishes observed passes, failures, unavailable trials, and saved runs.
* The specialist-to-buyer workflow works with citations, correction persistence, and human handoff.
* Reviewable screenshots and interaction recordings show the polished affected states.
* Deployment instructions identify authentication, storage, worker, and provider prerequisites.

## Notes

Risk: MEDIUM. No revenue or conversion benefit is proven by the interview demo.
Update `docs/FOR_ETHAN.md` with verified implementation lessons, not projected behavior.
