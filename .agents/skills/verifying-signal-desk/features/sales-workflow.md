# Connected sales workflow

## Sub-features

Invited access, source evidence and conflict resolution, durable conversation, streamed specialist
turns with cancel and recovery, import job retry, reviewed buyer answers, offer handoff and stale
unsent draft rejection.

## How to get to it (user POV)

Sign in, open Workspace, then a department for its streamed Sale assistant. Expand Evidence
workbench and open an opportunity for review, photos, jobs and Specialist conversation. Buyers go
from a public record to their vehicle conversations. Without configured auth, sign-in stays
disabled and private records stay hidden.

## Driving it with the native HTTP harness

Run the complete gate with its test database and production HTTP app configured. The access,
assistance, evidence, photos, streaming, municipalities, mcp and evaluation tests create synthetic
records and controlled authentication, exercise real routes, assert rendered content, and verify
persisted state. All tests must pass without skipped suites.

## Gotchas

Controlled test authentication is not live Supabase validation. No browser drive covers the app's
client code yet: streamed chat, job retry and the token page are proven over HTTP only.
Provider-dependent evaluation must report unavailable providers honestly. External messages and
commercial commitments stay off.
