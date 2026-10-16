# Connected sales workflow

## Sub-features

Invited access, source evidence and conflict resolution, durable conversation, reviewed buyer
answers, offer handoff and stale unsent draft rejection.

## How to get to it (user POV)

Sign in, open Workspace, choose the opportunity, then use Specialist conversation and the evidence
review controls. Without configured auth, sign-in stays disabled and private records stay hidden.

## Driving it with the native HTTP harness

Run the complete gate with its test database and production HTTP app configured. The assistance
and evidence tests create synthetic records and controlled authentication, exercise real routes,
assert rendered content, and verify persisted state. All tests must pass without skipped suites.

## Gotchas

Controlled test authentication is not live Supabase validation. Provider-dependent evaluation
must report unavailable providers honestly. External messages and commercial commitments stay off.
