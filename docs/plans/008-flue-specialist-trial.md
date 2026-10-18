---
linear: ETH-80
github: 8
filed: 2026-10-16
---
# Trial Flue for one streamed specialist conversation

## Status
- **Goal**: Prove streamed assistance and recovery without weakening existing sales controls.
- **Initial priority**: P1
- **Effort**: Large
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `e0408b2d88be32287af367b8f09c71f490fbb8cd`, 2026-10-16

## Why this matters

Specialists need to read useful output before generation finishes. A disconnected dashboard must
not trigger another paid request or duplicate a draft when it reconnects.

## Current state

* The published monorepo has Dispatch components and protected sales operations, but no live
  provider-backed specialist conversation. The model adapter returns a completed text report.
* Streaming requirement R13 and acceptance example AE9 are specified in the product plan.
* Flue documents durable conversations, PostgreSQL storage, and separate submission and observation.
  These capabilities have not been verified in Signal Desk.

## Approach

* Trial Flue on one specialist conversation, reusing Dispatch and existing sales operations.
  Its documented conversation storage and reconnect behavior fit this bounded test.
* Keep PostgreSQL sales records authoritative for access, evidence, approvals, budgets, and drafts.
  Flue stores execution progress, not a second authoritative copy of those business records.
* Use Drizzle for application database access, following the existing Zod contracts in
  `packages/contracts`. Preserve runtime validation and the existing transaction guarantees.
  The prototype Supabase project is `garage-prototype` (`iyjdwksmwccwslcioutd`); developer tooling
  and authentication are described in
  [development checks](../development.md#supabase-developer-access).
* Route every provider request, including recovery and compaction, through shared spending
  admission. Keep uncertain charges reserved until reconciled. Stop the trial if Flue cannot
  preserve this rule.
* Compare the trial against the existing operations, not a second framework implementation.
  Mastra, Temporal, and Pi remain alternatives rather than additional runtime dependencies.

## Scope

* In: One authenticated specialist conversation in `apps/web`, one Node execution owner, and Flue's
  PostgreSQL integration; reuse `packages/catalog`, `packages/ui`, and `packages/contracts`.
* In: Real text streaming, validated cards, reload, reconnect, explicit cancellation, and recovery.
* Out: Buyer-facing live generation and wholesale import-worker replacement; neither is needed
  to prove the specialist conversation.
* Out: Shell tools, sandbox agents, subagent swarms, and a second framework stack; sales operations
  already define the allowed work.
* Out: External messages, payments, and commercial commitments; human review remains mandatory.

## Steps

* Start from the published monorepo commit above or a descendant. Reuse tickets 001, 002, and 005
  for access, spending, and sales-operation contracts; ticket 007 owns broader evaluation.
* Pin the trial version and verify its provider hooks, storage migrations, and single-owner recovery
  behavior before integration. Document conflicts with existing protections rather than bypass them.
* Admit submissions once using stable logical-turn identifiers. Observe persisted progress without
  resubmitting a message. A viewer disconnect detaches observation; cancellation is explicit.
* Check current permissions for submission, observation, cancellation, and tool execution.
  End observation when access is revoked. Prevent further protected work or disclosure.
* Stream authored answer prose as restricted Markdown. Keep user, source, offer, and draft text
  literal. Expose only complete cards whose arguments and current evidence pass server validation.
* Call existing draft operations with stable idempotency keys and current evidence revisions.
  Treat interrupted tools as unknown outcomes until reconciled, not permission to repeat effects.
* Record observed latency, usage, recovery results, and integration limitations. Recommend adoption
  or rejection separately; trial approval does not approve a full runtime migration.

## Test plan

* Hold a controlled provider stream open: text and one valid card appear before completion.
  Split UTF-8, Markdown, event frames, and tool arguments across chunks; no partial card appears.
* Disconnect and reconnect, then reload: restore the same turn without another provider request,
  budget reservation, or draft. Check persisted IDs and provider-call counts, not just the screen.
* Crash after a draft commits but before the tool acknowledgement; recovery leaves one draft.
  Crash during inference; retain the uncertain reservation and block automatic paid retry.
* Revoke access during observation and before a recovered tool call; no further protected content
  or write is allowed. Try another specialist's opportunity and a buyer credential as controls.
* Change evidence during generation; stale cards and drafts fail current-evidence checks.
  Inject source instructions; they grant no tools, disclosure rights, or commercial authority.
* Exercise explicit cancellation and provider failure; partial output remains visibly incomplete.
  Run repository checks and inspect the Dispatch interaction in a browser with a recording.
* Run a permissioned live-provider smoke test after controlled tests. Record time to first visible
  text and completion, usage, and cost; label deterministic fixtures separately.

## Done when

* One specialist can read genuine streamed output and validated cards before completion.
* Recovery and reconnect preserve one logical turn and one draft without unadmitted model calls.
* Authorization, evidence, spending, and human-review gates pass the failure cases above.
* Trial evidence supports an adopt-or-reject recommendation, with no full migration implied.

## Notes

* Risk: HIGH. Framework replay does not make external effects exactly-once.
* ADR-020 records trial approval. The architecture document owns streaming and runtime boundaries.
* Ethan selected OpenRouter's `moonshotai/kimi-k3` for the initial trial on October 16, 2026.
* Supplied configuration uses `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `DATABASE_URL`, and server-only `OPENROUTER_API_KEY`. Align the existing unprefixed Supabase
  configuration and its tests during implementation. Verify database role privileges before use;
  a supplied connection is not evidence that migrations or account provisioning are authorized.
* References: [Flue source](https://github.com/withastro/flue),
  [durability](https://flueframework.com/docs/guide/durability/),
  [database](https://flueframework.com/docs/guide/database/), and
  [client](https://flueframework.com/docs/sdk/flue-client/).

## Implementation evidence

The local implementation uses Flue 2.3.0, its PostgreSQL adapter, and the pinned CLI. The agent is
`apps/web/src/agents/specialist.ts`; the owner runs with `npm run streaming`. Application database
operations use Drizzle ORM and retain Zod validation, transaction connections, PostgreSQL access
locks, and the existing ordered migration history. Framework-owned Flue storage is not an
application ORM model.

Controlled checks use synthetic identities, a disposable local PostgreSQL database, the actual
production Next app, Flue, and Pi's OpenAI-compatible SSE transport. No OpenRouter request or
live Supabase authentication is implied by these results.

| Scenario | Observed controlled result |
| --- | --- |
| Split UTF-8, Markdown, and tool JSON | Text appears early; partial cards stay hidden |
| Validated card during generation | Current review card appears while the provider is held open |
| HTTP detach, reconnect, and SSR reload | Same turn restored; provider request count remains two |
| Provider failure and cancellation | Incomplete text retained; uncertain charges remain reserved |
| SIGKILL after draft commit, before acknowledgement | Same draft ID recovered, not a second draft |
| SIGKILL during inference | Restart marks uncertain outcome; no new provider request |
| Buyer role and removed specialist membership | Observe, cancel, and submit denied |
| Evidence changes before a pending card | Stale tool rejected; no subsequent paid admission |
| Access revoked before recovered draft work | Live observer ends; no draft or provider request |

The two-request synthetic successful turn reports 400 input and 80 output tokens. These fixture
counts exercise accounting, not provider usage or invoices. The model policy in the fixture uses
1 input and 12 output micro-USD per token, so its settled counter is 1,360 micro-USD. Recovery after
a forced crash waits for Flue's default 30-second lease; the controlled streaming suite takes about
57 seconds including that wait. This is not a live model latency benchmark.

The browser walkthrough uses the production app with controlled authentication and provider
responses. It checks visible prose and cards before completion, reload without another model
request, explicit stop, failure labels, and a narrow layout. Review captures and recordings are
local verification artifacts, not checked-in product fixtures.

## Permissioned live verification

Ethan approved remote setup and a US$0.10 smoke test, then clarified that the project OpenRouter
key has a US$25 budget. Migrations 001 through 008 and the pinned Flue tables were applied to
`iyjdwksmwccwslcioutd`. All 27 application tables, seven Flue tables, and the public migration
ledger have RLS enabled. Supabase-managed tables are not included in that application count.
The runtime login cannot bypass RLS, create roles, create databases, or create application tables.

Real OpenRouter Kimi K3 completed the loop from a specialist request to `prepare_draft`,
`show_card`, and a final response. One unsent draft was persisted for the logical turn. The
API observer saw text after 10,662 ms, the validated draft card after 21,616 ms while still
running, and completion after 45,936 ms. The three admitted requests reported 3,752 input
tokens and 381 output tokens, with a provider-reported estimated cost of US$0.005471648.
The conservative integer-rate budget settled at US$0.008324 for that turn. These costs are
usage estimates, not an invoice reconciliation.

The first real model response asked for listing details instead of using the bound draft tool.
Clarifying the tools' reference contracts resolved that observed failure in the successful trial.
No provider fallback or automatic paid retry was enabled. Vehicle records and inquiry text remain
synthetic even when authentication, database access, runtime execution, and inference are real.

A production-browser walkthrough then signed in through real Supabase Auth, submitted another
specialist request, displayed the persisted unsent draft card, and restored it after reload.
The walkthrough exposed two integration gaps: the sign-in control needed explicit submit
semantics, and the hosted operator could not grant runtime usage of Supabase's managed Auth
schema. Migration 008 replaces direct session reads with a private, runtime-only predicate,
preserving immediate session-revocation checks without granting broader Auth access (ADR-023).
Regression checks reproduce both failures. Authenticated browser DOM checks confirm the complete
draft, no remaining stop control, and no horizontal overflow.

Recommendation: retain the bounded Flue integration, not a wholesale runtime migration. Real
tool execution and streamed observation now work, and controlled tests cover the recovery and
uncertain-spend cases. Hosted end-to-end latency remains a limitation: these measurements include
database authorization, projection, and tool work, not just model generation time. No external
message, payment, or commercial commitment was made. The trial shipped to `main` on October 18,
2026. Ethan accepted the recommendation on October 18, 2026 (ADR-025).

## Approved municipality workspace direction

Ethan approved the municipality-page concept after reviewing the running evidence workbench.
[Plan 009](009-municipality-workspace.md) implements and verifies this scope (ADR-024).

- One page represents one municipality or department, with its unit identity visible.
- An active purchase card sits directly below the identity and shows the proposed amount,
  deal stage, and explicit conditions. Escrow and payments remain simulated and labeled.
- An interest list follows, showing favorites and seller-contact metadata, never message contents.
- The organization's own listings follow, including an honest empty state when it has none.
- A persistent, minimizable pop-up chat overlays the page without becoming another content section.
  It uses the real Flue agent and streaming transport, retains conversation history, and keeps
  responses contextual to the selected sale. Evidence administration is not the main chat UI.
- Municipality, interest, and deal data need explicit contracts and authorized database reads;
  the concept image is not evidence that these records or features already exist.

The workspace-link investigation also reproduced a 12.4-second navigation and a database lock
timeout. Evidence reads now take shared vehicle and opportunity locks while writes retain exclusive
locks. The concurrency regression failed before the fix and passed afterward. Browser clicks opened
all three demo records in approximately 3.0, 4.5, and 2.6 seconds. The reported minute-long delay
was not reproduced. The full gate passed 99 tests with zero failures or skipped tests.
