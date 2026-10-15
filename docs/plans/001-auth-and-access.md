---
linear: ETH-73
github: 1
filed: 2026-10-15
---
# Establish Supabase authentication and record access

## Status
- **Goal**: Protect the specialist workspace and inference entry points.
- **Initial priority**: P0
- **Effort**: Medium
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

An internet visitor must not spend Ethan's inference tokens or read private buyer information.

## Current state

The repository contains planning documents only. Garage's public login bundle confirms Supabase
Auth. Ethan prefers confirmed stack parity over Better Auth for this project.

## Approach

Create one Next.js, React, TypeScript, and Tailwind application with Supabase Auth and PostgreSQL.
Use invited identities, server-validated sessions, and explicit opportunity membership. Separate
identity from permission to spend. Reject public registration and client-selected roles.
Better Auth loses because Garage's observed web login uses Supabase Auth.

## Scope

* In: Application foundation, sign-in, invitation provisioning, membership, and access checks.
* In: Anonymous read-only public projection, specialist and buyer roles, and private file access.
* Out: Live inference, public sign-up, and use of Garage's project or user data.

## Steps

* Follow `docs/implementation-architecture.md` and the product plan's R9 and AE6.
* Pin dependencies, add reproducible setup, and use a separate prototype Supabase project.
* Protect server operations and files, not merely navigation or client components.
* Deny spend after application access is revoked, despite an otherwise unexpired token.

## Test plan

* Verify unauthenticated requests cannot upload, queue jobs, or read specialist records.
* Verify buyer A cannot read buyer B's records by changing an identifier.
* Verify user-editable metadata cannot grant a role and private notes never enter public payloads.
* Exercise sign-in, sign-out, expired sessions, and revoked access on the running application.

## Done when

* Invited users sign in and access only permitted records.
* Public registration and anonymous spending are denied server-side.
* The application runs with documented setup and no credentials committed to Git.

## Notes

Risk: HIGH. First dependency for all feature work. Require prototype project configuration through
private input, never credentials pasted into a ticket. This extends R9 with Ethan's explicit auth
requirement. Do not claim complete Garage infrastructure parity from public browser evidence.
