# Growth integration operations

The [authorized NY slice](plans/2026-10-19-ny-growth-loop.md) extends existing account and deal
workflows. This is a prototype. Directory presence is not buying intent or email permission.
External delivery, model spending and Forms access remain disabled without separate authorization.

## Local verification

Use the pinned Node version and a disposable database whose name ends in `_test`.
Never substitute the shared runtime or migration connection for `TEST_DATABASE_URL`.
The test helper applies migrations only to that disposable database.

```sh
npm run build
TEST_DATABASE_URL='<disposable connection>' TSX_TSCONFIG_PATH=apps/web/tsconfig.json \
  node --conditions=react-server --import tsx --test \
  apps/web/src/server/growth.test.ts apps/web/src/server/growth-integrations.test.ts \
  apps/web/src/server/growth-recovery.test.ts
```

Set `GROWTH_BROWSER_EVIDENCE=1` on the same command to drive the production-build app with
`agent-browser`. The harness owns its loopback identity provider, synthetic account and app.
It records profile review, suppressed enrollment, account enrichment, operations, narrow layout
and unavailable-account privacy under `.amp/in/artifacts/growth/`. These are controlled-provider
checks, not live Supabase, Resend, Google Forms or model validation.

The full gate also needs `CI=true`, `TEST_APP_URL` pointing to a locally running production build,
and the disposable `TEST_DATABASE_URL`. Run `npm run check`, `npm run cloudflare:build` and
`npm run test:cloudflare`. The existing verification skill owns catalog and legacy workflow checks.

## Approved recurring work

An authenticated specialist approves directory, Forms, analysis and stalled-deal schedules through
the operations/profile controls. Approval persists the caller's credential, not a service-wide
permission bypass. Each execution rechecks identity, credential and account ownership. Revocation
denies future operations. A sweep leases up to three jobs, records failure codes and latency,
and schedules the next hourly run. Node's worker or Cloudflare's scheduled sweeper invokes it.
No schedule exists until a human approves it.

Directory refresh downloads only the official USFA NY state CSV, with bounded input and a stable
state-qualified FDID. Repeat snapshots retain immutable observations and human corrections.
Uncertain identity matches require review. Contacts require recorded source/permission evidence.
Routing uses approved NY postal territories and changes the actual specialist owner.

## Resend prerequisites

Sending requires separately authorized `GROWTH_DELIVERY_MODE=allowlisted-test`, a server-only
`RESEND_API_KEY`, verified `RESEND_FROM`, configured receiving `RESEND_REPLY_DOMAIN`, and explicit
comma-separated `GROWTH_TEST_ALLOWLIST`. Unknown configuration fails closed. The UI cannot enable
delivery. Human approval queues a frozen two-step sequence; it does not send immediately.

Configure Resend's signed webhook at `/api/v1/webhooks/resend` only after endpoint deployment is
authorized. `RESEND_WEBHOOK_SECRET` is the Svix `whsec_` signing secret. The handler verifies raw
bytes and timestamp, deduplicates receipt IDs, retrieves received bodies through Resend's API,
ignores automatic replies for feedback, and stops queued work on replies or suppression events.
Invitation aliases correlate submissions but never authenticate a respondent or grant app access.

Each message reserves its durable dispatch before the request. A lost receipt remains uncertain,
including after Resend's 24-hour idempotency window. Do not requeue or retry it blindly. The profile
offers human reconciliation with provider receipt evidence, or definitive not-sent evidence that
stops the old message. A new send requires a fresh reviewed enrollment. Confirmed provider
acceptance is not inbox delivery or customer engagement.

Suppression and dispatch admission share a recipient lock. Early failure receipts replay when a
provider mapping becomes known. Late acceptance remains traceable even after a human records
not-sent evidence, but never revives stopped work. A known acceptance cannot be reassigned to
another message. Stale reconciliation fails rather than overwriting a settled attempt.

Sourcing enrollment uses `purpose: "sourcing"` with `pairing:<uuid>:<revision>` as its key.
It requires confirmed identity and reviewed contact permission, but not buyer fit or a buying
signal. Buyer enrollment retains both qualification gates. All purposes retain suppression,
stop conditions and the one-active-sequence rule.

## Google Forms prerequisites

Do not create a shared form as part of local testing. After separate approval, configure an existing
form with the exact versioned labels in `packages/contracts/src/feedback-schema.ts`. Keep interest,
blocker and optional explanation separate. `No blocker` and `Other` are different choices.

`GROWTH_FORMS_CONFIG` is server-only JSON with `formId` and `questions` containing the Forms
question IDs for `reference`, `interest`, `blocker` and `explanation`.
`GOOGLE_FORMS_ACCESS_TOKEN` must have authorized read access to that form. Token renewal is an
operator prerequisite, not an implemented OAuth authorization flow. Expiry fails the job without
advancing its watermark. No Pub/Sub infrastructure is required.

An optional `GROWTH_FORMS_INVITATION_URL` and numeric `GROWTH_FORMS_REFERENCE_ENTRY` add the
prefilled correlation field to prepared emails. Responses are read incrementally with five-minute
overlap, pagination and durable response IDs. Polling stops after 20 pages and retains its cursor
on failure. Email and Forms originals remain traceable; latest explicit answers deduplicate by
correlated recipient and stage. Counts are correlated respondents, not verified identities.

## Background research and reporting

`GROWTH_ANALYSIS_ENABLED=true` and `OPENROUTER_API_KEY` require separate spending authorization.
The separate tool-free growth agent uses the existing approved model, installation/user budgets,
durable inference attempts and revocation checks. It does not need a fake opportunity. Exact
selections and numeric replies bypass the model. Cited prose themes, uncertainty and suggestions
persist on authorized profiles as unapproved inferences. They never change commercial terms.

Operations report displayed-page denominators, backlog, scheduler latency and shared specialist
spending totals. Synthetic bounded exercises do not establish production throughput, customer
validation, revenue uplift or causality. Vendor analytics and experimentation are separately owned;
growth events never require a PostHog dependency or forwarding private event detail.
