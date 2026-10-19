# PostHog measurement

PostHog is an optional measurement destination, not Signal Desk's operational database or
authorization system. Collection defaults off. No live project, experiment, paid collection or
survey is provisioned by this implementation. Keep the reviewed email/Google Forms survey workflow.

## Current delivery boundary

The integration supplies server capture, durable account allocation, committed growth observations,
sanitized errors and consent-based diagnostics on the static overview. It uses canonical growth and
pairing code from main, not the old transferred archive. Local synthetic runs verify functioning
assignment and measurement, not live PostHog receipt or genuine uplift.

## Configuration

Use a separate permissioned prototype project and approved secret configuration. Never paste keys
into chat. An ingestion project token is public configuration, not a personal administrative key.
The PostHog wizard was inspected with telemetry disabled; its OAuth/project provisioning flow was
not run. Do not run an unattended wizard against a live project to reproduce this integration.

| Variable | Purpose |
| --- | --- |
| `POSTHOG_ENABLED=true` | Explicitly allow server collection and assignment requests |
| `POSTHOG_PROJECT_TOKEN` | Project ingestion token beginning `phc_` |
| `POSTHOG_HOST` | Exactly `https://us.i.posthog.com` or `https://eu.i.posthog.com` |
| `POSTHOG_ID_SALT` | Server-only random secret of at least 32 characters |
| `NEXT_PUBLIC_POSTHOG_ENABLED=true` | Show overview diagnostic consent controls |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Browser project ingestion token |
| `NEXT_PUBLIC_POSTHOG_HOST` | Matching US or EU ingestion host |
| `NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED=true` | Offer masked recording after explicit consent |

Browser values are compiled into Next.js and require a rebuild. Configure server values on each
runtime that produces observations; do not assume a Next.js environment reaches a separate Worker.
Rotating the salt changes account identities and experiment allocation. Do not rotate it during an
experiment without explicitly ending that experiment. Missing or invalid configuration does nothing.

## Privacy and delivery

Server events accept only UUID scope/account IDs, explicit synthetic status, an original durable
event key/time, an allowlisted kind and optional reviewed variant. HMAC identities include both
owner scope and account. Neither raw IDs nor event keys leave the server. Event detail, contact
information, source prose, document text, chat and arbitrary properties are excluded. Errors export
only fixed request/import/stream categories, not original messages, stack traces or request context.

The edge-compatible server SDK waits for immediate capture and shuts down within bounded time.
Delivery errors return false rather than failing a business operation. Call only after commit.
Reusing the original key and timestamp produces a stable top-level event UUID. Vendor deduplication
is best effort, not exactly-once delivery. `growth_telemetry` snapshots scope and synthetic status
inside each new business transaction. It contains no original event detail, messages or contact
data. The Node worker and Cloudflare sweeper send bounded batches outside business transactions;
failed delivery remains pending. Concurrent sweepers can resend the same UUID. Operational sends
are never replayed by telemetry. Disabled collection does not enqueue new growth observations or
export pending ones. No historical growth events are backfilled from current account ownership.

Browser collection starts only after consent on `/`. Leaving aborts pending startup before SDK
initialization, even when returning to the overview before the SDK download finishes. Stop or
departure invalidates that consent lifetime before opting out, stopping replay and disposing the
SDK. New collection stops immediately; previously accepted batches or requests may still finish
sending or retry during shutdown. Withdrawal does not retract data already transmitted. The UI
states this distinction. Re-consent creates a new consent lifetime, not permission for an old one.
It exports only `overview_opened` and masked replay; it never identifies visitors or joins them to
accounts.
Autocapture, automatic exceptions, surveys, console, performance and network-body/header collection
are disabled. URLs lose queries, fragments and referrers. Recording blocks private subtrees,
documents and media, masks all text/inputs/attributes and rejects replay plugin/custom events.
No workspace, account, chat, seller or buyer page is eligible for replay. The browser still reaches
PostHog directly, so its transport necessarily exposes the connecting IP to the vendor even though
GeoIP enrichment is disabled. Obtain appropriate privacy approval before enabling it.

## Reviewed outreach experiment contract

`reviewed-outreach-v1` compares the existing reviewed approach (`control`) with a reviewed
evidence-first approach (`evidence_first`). It is not the proposed buyer-demand sourcing experiment.
Configure equal allocation in PostHog only after separate approval and review both approaches before
launch. Randomization uses the scoped account pseudonym, never individual contacts.

On an eligible, never-enrolled buyer prospect, a specialist selects **Prepare assigned approach**.
Eligibility is recorded separately even if vendor allocation is unavailable. The first successful
assignment is persisted under the account lock in `outreach_experiments`, including scope, synthetic
status and frozen draft. `control` asks for a short conversation before citing the reviewed need;
`evidence_first` cites that same need before the request. Both include STOP. The specialist reviews
the frozen text and explicitly approves queueing; assignment never sends a message. Changed text,
changed cited need or changed synthetic status requires review outside this trial, not silent
cross-arm editing. Prior outreach, sourcing requests and survey invitations are excluded.

An unavailable or unknown flag leaves normal outreach available outside the experiment, with no
invented fallback arm. Account allocation survives contact, routing and later flag changes.
Historical trial reports stay in the original allocation scope. A newly routed owner sees the
persisted approach only through current account authorization. Flag evaluation is not exposure.
Only a verified `email.delivered` receipt is exposure. The window starts at the first observed
delivery confirmation, not the send API's acceptance or the time the worker drains it. Receipts
that arrive before acceptance mapping remain projectable after settlement or reconciliation.
Queued, admitted, dispatched-but-uncertain and failed messages are not exposed accounts.

The primary outcome is a reply human-qualified within 14 days of first observed delivery,
including the endpoint. It uses the committed qualification timestamp, not an inferred reply date;
review delays can therefore bias the measure. Any reply, an open, a click and opportunity creation
alone do not qualify. `qualifyProspect` requires reviewed identity, fit, cited need, reply
provenance and a published vehicle. Qualification creates a new opportunity or matches an existing
one, with the evidence blocker committed transactionally. Only a new opportunity counts as created.
Report eligible, assigned, delivered/exposed and mature accounts separately for each arm. The
qualified conversion denominator is exposed accounts whose full 14-day window has elapsed; show
pending accounts separately. Report sample sizes and uncertainty rather than declaring a winner
from small counts. Synthetic runs verify plumbing and must never enter real uplift estimates.

The specialist's Growth operations page shows eligible/unassigned counts separately from each arm's
assigned, exposed, pending, mature and qualified counts, plus a 95% Wilson interval. Synthetic and
real cohorts never share a denominator. Reports are scoped to the current specialist's historical
allocation scope; they do not establish a winner or automatically change rollout.

The helper deliberately suppresses automatic `$feature_flag_called` capture; only
the explicit committed exposure event should carry `$feature/reviewed-outreach-v1` for measurement.
After the growth integration is verified and launch is approved, select custom exposure event
`growth_exposed`, filter `synthetic=false`, select `growth_qualified_reply` as the metric and set
its window to 14 days. PostHog attributes metric events through the account's first exposure.
Do not configure assignment or flag evaluation as the exposure criterion. Exclude accounts exposed
to multiple arms and investigate sample-ratio mismatch before interpreting results.

## Repeatable checks

```sh
TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --conditions=react-server --import tsx \
  --test apps/web/src/server/posthog.test.ts apps/web/src/app/landing-telemetry.test.ts
TEST_DATABASE_URL=<disposable-test-url> TSX_TSCONFIG_PATH=apps/web/tsconfig.json \
  node --conditions=react-server --import tsx --test apps/web/src/server/outreach-experiment.test.ts
npm run verify:posthog-privacy -w @signal-desk/web
npm run verify:posthog-consent -w @signal-desk/web
```

The native test uses the real server SDK and a loopback collector. It checks disabled configuration,
pseudonymization, actual ingestion UUID stability across retries, distinct event/scope separation,
flag-read versus exposure and failed delivery. The browser check uses the real bundled SDK against a
controlled collector, decodes compressed replay and
searches captured initial snapshots and mutations for representative private inputs and tokens.
It also checks that navigation to a private route produces no further capture. The consent check
mounts the real component and SDK, holds the lazy module download, and verifies both departure and
departure-and-return cannot initialize a stale instance. It also exercises a failed capture before
withdrawal, queued delivery during disposal, private navigation and re-consent. None of these checks
demonstrate live PostHog receipt, an active experiment or genuine commercial uplift.

The database experiment check uses actual growth review, assignment, enrollment, controlled send,
signed webhook and qualification operations. It checks early delivery mapping, duplicate receipts,
frozen assignment, private-data omission, pending versus mature denominators, the inclusive
endpoint, synthetic separation and outage recovery. It also checks contradictory late acceptance,
existing-deal matching and routing before allocation. Browser states are repeatable by setting
`POSTHOG_BROWSER_EVIDENCE=1` for that test against the production build. The controlled app has no
ingestion token, so rendering never exports live observations. Apply migrations only through the
normal separately authorized migration workflow. Generating 0028/0029 locally does not deploy them.

References: [Next.js integration](https://posthog.com/docs/libraries/next-js),
[Node SDK](https://posthog.com/docs/libraries/node),
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[custom experiment exposure](https://posthog.com/docs/experiments/exposures).
