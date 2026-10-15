# Signal Desk implementation architecture

This is the implementation direction for the [product plan][plan], updated after Ethan requested
authentication for inference spending and terminal access through MCP on October 15, 2026.
It describes intended behavior, not shipped functionality.

## Stack parity without guessing

Garage's [design-engineer posting][design] names React, Next.js, TypeScript, and Tailwind.
Its [software-engineer posting][engineering] also names Node.js and PostgreSQL.
Use that stack for this prototype. Those postings do not name an authentication provider.

Use Supabase Auth for parity, following Ethan's preference to match Garage when its provider is
verifiable. On October 15, 2026, the [public application bundle][bundle] contained the login action
`c.A.auth.signInWithOAuth({provider:e,options:{redirectTo:...}})` and Supabase's auth client.
The browser also displayed a Google authorization URL with a callback at the same Supabase
project's `/auth/v1/callback` endpoint. This establishes Supabase Auth in the observed web login,
not the identity system for every Garage service. Ethan completed a separate login in the orb's
shared browser. The agent entered no credentials and submitted no login form.

The earlier static download used an obsolete bundle filename. Fetching the current bundle
succeeded. Supabase image URLs alone were insufficient evidence; the login action and OAuth
callback supplied the missing confirmation. Supabase client version 2.83.0 was present in this
observed bundle; choose our dependency version separately after checking current documentation.

The observed dashboard uses customized Tailwind components. Its shared bundle contains Base UI
error messages and Headless UI code, with button styles named `transition-hoseflow` and stone
color variants. The inspected DOM's `data-slot` markers belong to icons. Current shadcn
documentation also offers Base UI components. Neither Base UI's presence nor Radix's absence
distinguishes shadcn from custom components. The inspected code establishes the libraries and
customization, not whether the components originated in shadcn. Use shadcn with Base UI as our
starting point and match the supplied screenshots without claiming verified shadcn parity.

## One application and one worker

Next.js serves the specialist workspace, buyer view, and authenticated HTTP operations. PostgreSQL
stores identities, vehicle evidence, opportunities, jobs, review decisions, and usage reservations.
Private persistent file storage holds uploaded documents and photos outside the public directory.
One Node worker claims persisted jobs and performs bounded extraction and photo classification.

Use relational records for entities with separate ownership or lifecycle. Small structured values,
such as an offer's conditions or a provider's validated extraction result, can use JSONB. Do not put
the whole workspace in one mutable JSON document.

The initial alternative was a compact vehicle aggregate plus separate opportunity and job records.
That reduces joins, but makes permission changes, claim identity, and concurrent review coarser.
Choose explicit evidence and review records so worker retries cannot replace human decisions.

## Authentication precedes inference

Supabase Auth owns sign-in, sessions, and password handling. Public registration is disabled.
Provision invited demo identities through an operator-controlled command, not a public bootstrap
endpoint. Do not publish shared credentials or put a bypass in the browser bundle. Use a separate
prototype Supabase project, never Garage's project or public client configuration.

Validate identity server-side with current Supabase guidance. Do not authorize from user-editable
metadata or trust a client session object. Check fresh application permissions for spending actions,
because an unexpired access token can outlive logout or a role change. Keep privileged database
tables outside the exposed API, or enforce explicit row-level policies when exposure is required.

Server operations derive identity from a verified session or a revocable, scoped application token.
Never trust a role, user ID, or opportunity ID merely because a client submits it. Specialists need
explicit opportunity access. Buyers can access only their own conversation and public vehicle facts.
An account by itself does not grant inference spending rights.

An anonymous visitor can read an approved vehicle record. Uploads, model-backed questions, and
processing jobs require an invited identity with the relevant permission. A read-only saved demo
can explain the workflow without making model calls.

Protect every spending entry point, including MCP and retries, with the same server-side rules:

- Check identity, record access, capability, and request size before queueing work.
- Atomically reserve a conservative maximum charge against per-user and installation budgets.
- Bound model, output tokens, input size, photo count, attempts, and concurrent jobs in server
  config.
- Reject work when a reservation cannot be made. Rate limits alone do not cap total spend.
- Settle reservations against provider-reported usage and retain attempt-level accounting.
- Retain uncertain reservations after a crash until reconciled. Do not assume a lost response was
  free or refund a call that may still be running.

Provider keys stay server-side. Configure provider-account spending controls as an additional
backstop. Application estimates cannot guarantee an exact provider bill after ambiguous failures.

## Evidence and buyer information stay separate

Vehicle records hold shared specifications. Sources hold original assertions with provenance,
page references, and explicit audiences. Review decisions select claims for publication without
deleting contradictory source assertions. Opportunity records hold one buyer's questions, offers,
blockers, assignee, and draft follow-ups.

Only an authorized specialist can approve publication. Extraction and vision output remain
unapproved suggestions. A buyer-facing citation exposes an approved excerpt, not an entire private
PDF. Filter permitted evidence before constructing model input as well as before returning output.

Use content hashes for repeated source imports and unique keys for derived tasks. A worker owns its
attempt result, not the review decision. Worker claims expire and recover after restarts, and an
expired worker cannot commit over a newer attempt. Reviewed corrections survive repeated imports.

Unknown and conflicting facts remain unanswered until supported evidence permits an answer.
Photo coverage describes supplied views and readability, never mechanical condition or safety.
Offers preserve amount, timing, conditions, and unanswered questions without accepting anything.
External messages, payments, and commercial commitments remain disabled.

## MCP exposes operations, not a second sales agent

Start with a small local stdio MCP adapter for Claude Code and compatible clients. The adapter
connects to the application over HTTPS with a revocable application token. It does not receive a
provider key or connect directly to PostgreSQL. The application remains the authority even when
Claude Code runs on a different machine.

The first tools list assigned opportunities, read permitted evidence, check unresolved blockers,
request bounded processing, and create reviewable drafts. A client must explicitly opt into write
tools. Draft creation does not publish evidence or deliver messages. Repeated calls use the same
operation-level idempotency rules as dashboard requests.

Both HTTP handlers and MCP calls invoke the same sales operations. Keep those operations independent
of React and MCP transport objects. Use the official MCP SDK rather than a custom protocol.

A hosted MCP endpoint with browser OAuth consent is a later transport, not a prerequisite for
terminal access. Revisit it when clients need connection without installing the stdio adapter.
Choose an MCP-compatible OAuth authorization design then. Do not add a public unauthenticated MCP
endpoint or treat possession of an MCP session identifier as authorization.

## Delivery order and verification

Create feature tickets in Ethan's [garage-prototype Linear project][linear], in this order:

1. Application foundation, Supabase Auth, invited identities, and record permissions.
2. Shared inference admission, budget reservations, bounded retries, and usage accounting.
3. Durable source import, extraction, and source-backed review with conflict resolution.
4. Photo coverage, human corrections, and editable missing-evidence drafts.
5. Connected buyer record, cited assistance, and qualified offer handoff.
6. Authenticated MCP adapter over the same operations, with Claude Code setup instructions.
7. Held-out evaluation, privacy and recovery checks, UI polish, and deployment readiness.

The first two tickets gate live model calls. Import and review establish the contract before the
buyer and MCP clients use it. Test the same permission, spending, and idempotency scenarios through
both clients. Exercise the plan's AE1 through AE6 on the running application.

No model credentials are currently configured in this orb. A representative live extraction and
vision trial must precede claims about accuracy, latency, or cost. A saved run is explicitly labeled
and never substitutes for processing an arbitrary upload.

The first UI direction is a focused evidence workbench with buyer context beside it. Keep orange
actions, warm borders, readable source rows, keyboard access, and reduced-motion support. Do not add
decorative dashboard charts or navigation to workflows the slice does not implement.

[plan]: plans/2026-10-15-1440-feat-signal-desk-plan.md
[design]: https://www.ycombinator.com/companies/garage-2/jobs/hzVJNXq-founding-design-engineer
[engineering]: https://www.ycombinator.com/companies/garage-2/jobs/8YNROco-software-engineer
[linear]: https://linear.app/mite404-workspace/project/garage-prototype-baf1d9b8985d
[bundle]: https://www.shopgarage.com/_next/static/chunks/pages/_app-2bf824e172349a0a.js
