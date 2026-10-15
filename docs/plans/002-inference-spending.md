---
linear: ETH-74
github: 2
filed: 2026-10-15
---
# Bound inference spending across all clients

## Status
- **Goal**: Prevent dashboard, MCP, and worker retries from bypassing spending controls.
- **Initial priority**: P0
- **Effort**: Medium
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

Authentication alone does not stop an invited account or repeated job from exhausting API tokens.

## Current state

There is no model client, job queue, or accounting. No inference credentials are configured in the
orb. Authentication is specified in `docs/plans/001-auth-and-access.md`.

## Approach

Put one inference-admission operation before every provider call. Atomically reserve a conservative
maximum charge against user and installation budgets, then settle against usage per attempt.
Keep uncertain reservations after lost responses. Rate limits alone lose because they bound request
frequency, not total spending. Configure provider-side spending controls as a separate backstop.

## Scope

* In: Shared admission, server-configured models and limits, reservations, and usage accounting.
* In: Bounded input, output tokens, photo count, attempts, and concurrent work.
* Out: Billing customers, new provider purchases, and claims of exact cost after ambiguous failures.

## Steps

* Depend on `docs/plans/001-auth-and-access.md`; satisfy R10 and R11's job and usage requirements.
* Persist admission decisions and attempt accounting in PostgreSQL transactions.
* Require fresh permissions for retries and prevent duplicate requests from duplicating effects.
* Record model version, duration, token usage, and review outcome without private prompts in logs.

## Test plan

* Race two jobs against a budget that admits only one; assert only one provider call is admitted.
* Verify denied, revoked, oversized, and exhausted-budget requests never reach a provider.
* Crash after dispatch and verify the reservation is not silently refunded.
* Verify retries consume bounded attempt allowances and retain actual usage separately.

## Done when

* Every inference path enforces the same identity, permission, and budget checks.
* Concurrent requests cannot oversubscribe the configured budget reservation.
* Provider outages remain visible failures, never fabricated saved-run responses.

## Notes

Risk: HIGH. Depends on authentication and gates live import, vision, and buyer assistance.
This adds Ethan's token-protection requirement to the original evaluation contract.
Choose providers only after private configuration and a representative live trial.
