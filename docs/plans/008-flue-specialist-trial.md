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
