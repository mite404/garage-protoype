# PostHog measurement

PostHog is an optional measurement destination, not Signal Desk's operational database or
authorization system. Collection defaults off. No live project, experiment, paid collection or
survey is provisioned by this implementation. Keep the reviewed email/Google Forms survey workflow.

## Current delivery boundary

The independent foundation supplies server capture, account-level flag evaluation, sanitized error
capture and consent-based diagnostics on the static overview. Growth event consumers and persistent
experiment assignment still depend on the frozen U1-U7 implementation from its separate owner.
The experiment below is a contract, not a completed experiment or evidence of uplift.

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
is best effort, not exactly-once delivery. There is no durable telemetry retry queue yet.
Caller-side retry must not replay an operational send or create a new business transition.

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

Persist the first successful assignment under the existing account lock before preparing a reviewed
message. An unavailable or unknown flag leaves normal outreach available outside the experiment;
never invent a fallback arm. Keep that assignment across contacts, retries and later flag changes.
Flag evaluation emits no exposure event. Only the first confirmed delivery is actual exposure;
queued, admitted, dispatched-but-uncertain and failed messages are not exposed accounts.

The primary outcome is an evidence-qualified reply within 14 days of first confirmed delivery,
including the endpoint. Any reply, an open, a click and opportunity creation alone do not qualify.
Report eligible, assigned, delivered/exposed and mature accounts separately for each arm. The
qualified conversion denominator is exposed accounts whose full 14-day window has elapsed; show
pending accounts separately. Report sample sizes and uncertainty rather than declaring a winner
from small counts. Synthetic runs verify plumbing and must never enter real uplift estimates.

These persistence, outcome-window and reporting requirements are not implemented by flag rollout
alone. The current helper deliberately suppresses automatic `$feature_flag_called` capture; only
the explicit committed exposure event should carry `$feature/reviewed-outreach-v1` for measurement.
After the growth integration is verified and launch is approved, select custom exposure event
`growth_exposed`, filter `synthetic=false`, and set the qualified-reply metric's conversion window
to 14 days. PostHog attributes metric events through the account's first exposure; do not configure
assignment or flag evaluation as the exposure criterion. Exclude accounts exposed to multiple arms
and investigate sample-ratio mismatch before interpreting results.

## Repeatable checks

```sh
TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --conditions=react-server --import tsx \
  --test apps/web/src/server/posthog.test.ts apps/web/src/app/landing-telemetry.test.ts
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

References: [Next.js integration](https://posthog.com/docs/libraries/next-js),
[Node SDK](https://posthog.com/docs/libraries/node),
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[custom experiment exposure](https://posthog.com/docs/experiments/exposures).
