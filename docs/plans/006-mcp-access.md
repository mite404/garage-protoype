---
linear: ETH-78
github: 6
filed: 2026-10-15
---
# Expose authenticated sales verification through MCP

## Status
- **Goal**: Let specialists use Claude Code without reimplementing the dashboard's sales rules.
- **Initial priority**: P2
- **Effort**: Medium
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

Sales verification should remain usable outside the dashboard without exposing inference keys or
allowing a terminal client to bypass record permissions and human review.

## Current state

Ethan requested MCP access for Claude Code and other architectures. There is no MCP server.
The selected architecture keeps sales operations independent of React and transport objects.

## Approach

Build a small stdio adapter with the official MCP SDK. It calls authenticated application operations
over HTTPS using a revocable scoped application token. Store token hashes server-side and show
issued secrets only once. Direct database access loses because it bypasses shared permissions and
spending admission. Hosted OAuth transport waits until installation-free remote access is needed.

## Scope

* In: Assigned opportunities, permitted evidence, blocker checks, bounded processing, and drafts.
* In: Token issuance, expiry, revocation, scopes, Claude Code setup, and idempotency keys.
* Out: Provider keys on the client, public remote MCP, autonomous approval, and message delivery.

## Steps

* Depend on tickets 001, 002, 003, and 005 for the same protected sales operations.
* Keep read scopes separate from explicit write scopes and spending permission.
* Parse tool inputs at the boundary and return only permitted record projections.
* Document local Claude Code registration without storing tokens in tracked configuration.

## Test plan

* Connect an actual MCP client and read only its assigned opportunity and permitted citations.
* Revoke a token and verify its next request fails, including a previously queued retry.
* Verify read-only tokens cannot create drafts or request paid processing.
* Repeat a draft request with one idempotency key and verify exactly one persisted draft.
* Run the dashboard's denial and budget scenarios through MCP as well.

## Done when

* Claude Code can inspect evidence and prepare a permitted draft through the shared operations.
* Neither tool selection nor forged arguments can widen record access or spend permissions.
* The adapter has no direct database or inference-provider credentials.

## Notes

Risk: HIGH. This is an explicit addition to the original product plan, requested by Ethan.
Do not build a second autonomous agent framework or custom MCP protocol.
