# Architectural design and HTTP contracts

This is the project's architectural and HTTP reference. The ETH-73 section below describes the
implemented foundation. Other HTTP paths and payload sketches remain proposals until their owning
implementation units validate them.

## Implemented ETH-73 foundation

App source lives in `src/`. All database, auth, and private-record modules import `server-only`.
Node 22 LTS and npm are required. TypeScript tests use native `node:test` through `tsx`.

- `POST /auth/sign-in` accepts an email/password form for an operator-provisioned Supabase identity.
- `POST /auth/sign-out` ends that session. Both mutations require an exact configured Origin.
- `POST /auth/sign-up` always returns `403 REGISTRATION_DISABLED`. Supabase registration must also
  be disabled in the prototype project's Auth settings.
- `GET /api/v1/desk/opportunities/:id` returns a permitted specialist opportunity row in `{data}`.
- `GET /api/v1/buyer/opportunities/:id` returns only `{data: {id, vehicleId}}` to its owning buyer.
- `GET /api/v1/desk/sources/:id/content` downloads authorized source bytes as an attachment.
- `GET /api/v1/public/vehicles/:id` returns the published public projection in `{data}`. Facts
  require both approval and permission to share. ETH-76 adds approved photos and public coverage.
- ETH-77 implements deterministic buyer inquiry routing and human handoffs. ETH-75 implements the
  source, import, review, and retry routes below, with record checks and ETH-74 inference admission.

Protected HTTP reads and all JSON envelopes use `Cache-Control: no-store`. Inaccessible records
return `404 NOT_FOUND`. Wrong-role actions return `403 FORBIDDEN`. Invalid or ended sessions return
`401 UNAUTHENTICATED`. Uninvited and revoked identities return `403 ACCESS_REVOKED`.
Private database or provider errors become sanitized `503 UNAVAILABLE` responses.

`requireActor(client?)` verifies Supabase claims and the Auth user.
`resolveActor(reference, client?)` checks `auth.sessions` and current application access.
`refreshActor`, `requireSpending`, and `requireOpportunity` accept a caller-owned `pg.PoolClient`.
They use that transaction, not another pool connection. `database()` returns the pool for callers
that need to begin a transaction. `Actor.credential` retains either a Supabase session ID or an
application-token ID, never a plaintext secret or password. ETH-78 defines bearer access below.

`canSpend` is not budget admission. ETH-74 rechecks current access inside its reservation
transaction. The runtime role can write inference accounting, but cannot change identity
permissions, model policies, or budget limits.

Private sources are bounded PostgreSQL `bytea` records, not static files or public object URLs.
Public facts occupy an explicit allowlisted projection table. ETH-75 atomically updates that
projection after evidence and publication review change. See [auth setup](auth-setup.md) for
configuration and remaining live checks.

## Implemented ETH-78 local MCP access

`src/mcp.ts` uses official `@modelcontextprotocol/sdk` 1.32.1 over stdio. It calls the same
protected HTTP operations as the dashboard. It has no database, privileged Supabase, or provider
credential.
`SIGNAL_DESK_URL` is an HTTPS origin, without a path, query, fragment or URL credentials.
Loopback HTTP is allowed only for controlled local verification. Redirects are rejected rather than
forwarding the bearer secret to another address. Errors return sanitized JSON in MCP text content
with `isError: true`. Successful text contains the existing `{data}` HTTP envelope.

Every protected desk route used below accepts `Authorization: Bearer <application-token>`.
An explicit invalid Authorization header never falls back to session cookies. Cookie mutations
still require the exact configured Origin. Buyer routes and source-byte downloads remain
session-only. No hosted MCP endpoint exists.

| Tool | Existing or added HTTP operation |
| --- | --- |
| `list_opportunities` | `GET /api/v1/desk/opportunities?cursor=...` |
| `get_workbench` | `GET /api/v1/desk/opportunities/:id/evidence` |
| `get_assistance` | `GET /api/v1/desk/opportunities/:id/assistance` |
| `get_job` | `GET /api/v1/desk/jobs/:id` |
| `create_draft` | `POST /api/v1/desk/opportunities/:id/assistance` with `kind: draft` |
| `queue_import` | `POST /api/v1/desk/vehicles/:id/imports?opportunityId=...` |
| `retry_import` | `POST /api/v1/desk/jobs/:id/retry` |

The opportunity list returns `{items, nextCursor}` with at most 100 membership-filtered records.
The cursor is the previous page's last ID. A full final page may require one empty-page request.
The workbench includes permitted original text, claims with exact locators, review states, photo
coverage, blockers and jobs. Job status reuses that filtered projection, never frozen prompts.
Assistance stays opportunity-scoped. Another buyer's negotiations are not vehicle-wide context.

Drafts use the shared strict `draftCommand` schema in `assistance-schema.ts`. `seller_request` and
`buyer_followup` require `inquiryId` and `revision`. `photo_request` requires `revision`, edited
`recipientLabel` and `body`. The adapter sends the caller's explicit `key` as `Idempotency-Key`.
Keys remain user-scoped for the installation lifetime. Replays preserve the same draft ID;
different input with that key returns `409 IDEMPOTENCY_CONFLICT`. Stale evidence returns `412`.
Queueing uses the server's `EVIDENCE_MODEL`, not a client-selected model. Retries use the existing
job transition and numbered-attempt controls; a queued job cannot be retried into a second attempt.

Only an interactive invited specialist can manage tokens at `/desk/tokens`:

- `GET /api/v1/desk/tokens` lists that specialist's secret-free metadata.
- `POST /api/v1/desk/tokens` accepts `{label, scopes?, expiresAt}` and returns metadata plus a
  secret exactly once. `label` is 1 to 100 characters. Expiry must be in the future, at most
  30 days.
- `DELETE /api/v1/desk/tokens/:id` revokes an owned token idempotently. Another owner's token
  is 404.

Management rejects any bearer header, even with a valid cookie. Secrets contain 256 random bits;
only SHA-256 hashes are stored. Metadata has `id`, `label`, `scopes`, `expiresAt`, `revokedAt`, and
`createdAt`. Tokens need `read`, which is the default scope. `write` and `spend` are explicit
opt-ins.
Only a currently spending-enabled specialist can issue a spending token. Scope arrays must be
unique and cannot contain additional names. Missing scope returns `403 SCOPE_DENIED`; absent
spending authority returns `403 SPENDING_DENIED`. Expired or revoked tokens return 401.

Shared operations, not tool visibility, enforce scopes. Token rights intersect with current
identity, role and opportunity membership on every operation. Import queue and retry require write
and spend. Drafts require write. Human evidence/photo approval remains session-only for every token,
including write/spend tokens. No tool changes audiences, approves evidence, sends messages, accepts
offers, counteroffers or promises delivery.

Import jobs persist exactly one credential reference, `session_id` or `app_token_id`. The worker
rechecks that original credential before queued, retried and lease-recovered work and each paid
admission. Another credential cannot rescue a revoked job. Token revocation conflicts with the same
short-lived permission locks as identity revocation. Revocation before admission denies the attempt;
revocation after admission cannot recall an already authorized request. Budget reservations and
uncertain-spend reconciliation retain ETH-74 semantics. See [MCP setup](mcp-setup.md).

## Implemented ETH-74 inference boundary

`src/server/model.ts` exports `runInference(actor, request, provider?)`.
HTTP operations, the worker, and future MCP operations must use this shared operation rather than
call a provider directly.
Only implemented workflow operations can queue processing. Buyer inquiries use deterministic
reviewed-evidence lookup and human routing, not paid model processing.
No live provider adapter, provider purchase, default budget, or enabled model is installed.

The request contains `key`, `opportunityId`, `model`, `input`, `photos`, and `attempt` (default 1).
The key is scoped to the user for the installation's lifetime. Changing its payload returns
`409 IDEMPOTENCY_CONFLICT`. Each numbered attempt is dispatched at most once. Repeating a settled
attempt reuses its persisted report; a retry explicitly requests the next number. Skipping a number
returns `409 ATTEMPT_CONFLICT`. A successful operation cannot be retried for another charge.

Operator-provisioned `inference_models` rows define allowed model IDs, total UTF-8 input bytes,
photo count, per-photo and framing token allowances, output tokens, integer micro-USD token rates,
attempt cap, retry delay, and timeout. One USD is 1,000,000 micro-USD.
`inference_budgets` contains lifetime caps
and concurrency limits for `installation` and each spending user's UUID. Missing rows deny spending.
There is no automatic daily reset or reservation expiry.

Each admission locks session, identity, opportunity, and membership tables against writes for the
short transaction. It checks current access, serializes the user/key, and locks both budget rows
in sorted scope order. It reserves input bytes plus photo and framing allowances at the input rate,
plus maximum output tokens at the output rate. It rechecks access after budget waits and commits
a dispatched attempt before calling the provider. Revocation that wins the table lock denies
admission; revocation after admission cannot undo an already authorized attempt. No database lock
or connection remains held during the provider call. This coarse lock limits admission throughput
and briefly delays unrelated session writes. Hosted Supabase locking privileges remain unverified.

The server-owned provider callback receives `model`, `input`, `photos`, `maxInputTokens`,
`maxOutputTokens`, `attemptId`, and an `AbortSignal`.
It must disable SDK retries and honor both caps.
The conservative input allowance must cover all billable input, including provider framing.
Photos contain inline permitted content, not URLs that bypass input bounds.
Callers own evidence filtering before constructing input. This operation checks opportunity access,
not the truth or audience of each
string. A future provider adapter needs a measured tokenizer, image, framing, and price bound before
live use. These application estimates are not an exact provider-billing guarantee.

Provider reports are validated variants. `completed` includes `output`, `modelVersion`,
`inputTokens`, `outputTokens`, and `reviewOutcome` (`needs_review`, `validated`, or `rejected`).
`failed` includes the same usage fields without output, plus `retryable`.
`not-billed` includes `retryable` and requires positive confirmation that the attempt cannot bill.
A thrown error, timeout, malformed report, or usage beyond reserved bounds is not that confirmation.
Both completed and billed failed attempts settle actual usage against their snapshotted rates.
Review outcomes describe evaluation, not human publication approval.

Failures remain failures. Retryable confirmed failures return `503 PROVIDER_FAILED`; terminal ones
return `422 PROVIDER_FAILED`. Retries require fresh access, fresh budget, a finished prior attempt,
the configured delay after settlement, and the lower of the original and current attempt caps.
Budget exhaustion returns `429 BUDGET_EXHAUSTED`; concurrency and cooldown return
`429 CONCURRENCY_LIMIT` and `429 RETRY_LATER`. Missing configuration returns `503 NOT_CONFIGURED`.

A crash after dispatch, timeout, or lost response retains the reservation and concurrency slot.
Duplicates return `409 SPEND_UNCERTAIN`, never silently refund or redispatch. A late response after
timeout cannot release the reservation. `reconcileInference(attemptId, report, evidence, client)`
requires an idle operator `PoolClient`, a verified receipt reference, and confirmed usage or
non-billing. Runtime connections cannot use this recovery API. Repeating the same settlement is
idempotent; changing it returns `409 SETTLEMENT_CONFLICT`. Operator-confirmed overages can exceed
the reservation and cap, recording the actual charge and blocking later admissions. Never reconcile
an attempt as free merely because a worker lease expired or a provider stopped responding.

Private PostgreSQL records retain attempt ID, number, timestamps, elapsed time to settlement,
snapshotted rates and limits, reported usage, model version, review outcome, and result. Recovered
elapsed time includes the unresolved interval and is not provider latency. Denial records contain
only user ID, time, and sanitized code. Prompts and provider exception details are not logged.
Results are checked against fresh record access before return, including cached results.

## Implemented ETH-75 evidence and review

`db/003-evidence.sql` extends the ordered foundation migrations. Originals (`sources`), extracted
assertions (`claims`), human decisions (`evidence_reviews`), and classification history
(`source_classifications`) are separate append-only records for the runtime role. Original bytes
have a generated SHA256. Locators use one-based pages and UTF-16 start/end offsets with an exact
excerpt. Repeated content with identical owner, media type, kind, audience, permission, provenance,
sharing, and blocker metadata reuses its source. Renaming the same original does not duplicate it.

`src/server/evidence.ts` exports these shared server operations:

- `addSource(actor, opportunityId, input)` stores UTF-8 text or a text-based PDF. Input contains
  `name`, `mediaType`, `content: Buffer`, `kind`, `audience`, `shareable`, `permission`,
  `provenance`, and an optional `blockerId`. Kinds are `document`, `seller_note`, `private_note`,
  `inquiry`, and `seller_response`. Responses require an originating blocker in this opportunity.
  Permission is `synthetic` or `permissioned`; private context cannot grant public excerpts.
- `getWorkbench(actor, opportunityId)` returns `Workbench`: source-filtered originals, claims,
  review history, classification history/current decisions, jobs, blockers, revision, assignee,
  and next action. Fact variants are `unknown`, `unreviewed`, `conflict`, `needs_review`, and
  `reviewed`. None of the first four has a verified value. Restricted or unprocessed factual
  sources conservatively prevent approval, including sources on another vehicle opportunity.
- `reviewEvidence(actor, opportunityId, revision, command)` appends `select`, `correct`, `unknown`,
  or `classify` decisions. Stale revisions return `412 STALE_REVIEW`. Corrections retain the
  original claim, reason, reviewer, and evidence-basis hash. New claims invalidate obsolete
  decisions without deleting them. Unknown reasons stay within their originating opportunity.
- `recordEvidenceBlocker(actor, opportunityId, input)` adds an idempotent existing question using
  `key`, `question`, `field`, `assigneeId`, and `nextAction`. Assignees need current specialist
  membership. This operation creates neither an opportunity nor a draft. Blocker states are
  `needs_review` and `resolved`; a classification-only blocker has a null field.
- `listEvidenceOpportunities(actor)` lists only explicit specialist memberships.

Vehicle revisions, opportunity assignees, evidence blockers, and import-job records are new
foundation records for downstream owners. Human classification corrections outrank later worker
suggestions and update the visible shared next action only for sales-audience sources. Private
classification text never enters shared routing. Classification is not permission to disclose.
Seller-response review resolves only its linked field blocker after human approval and source
sharing permission. The public projection labels seller claims as seller-reported, not verified
documents. No message, commercial assurance, or response draft is created or sent.

`src/server/imports.ts` exports the durable job operations:

- `queueImport(actor, opportunityId, {sourceIds, model, key})` authorizes every source before
  freezing its pages, hash, kind, provenance, and extraction instruction. The maximum packet is
  20 sources. Deduplication includes the opportunity, exact source IDs/hashes, model, and
  `evidence-v2-photos` configuration. Change the version when extraction rules change.
- `claimImport(id?)` claims one queued or expired job with a 60-second lease and increasing fence.
- `processImport(lease, provider?)` rechecks access, calls only `runInference` for provider mode,
  validates exact citations and field units, and fences its atomic commit. A stale worker cannot
  write claims or classifications. Provider callbacks are server-owned, never HTTP payloads.
- `retryImport(actor, jobId)` requires the original requester and current access. Confirmed
  retryable failures advance the separately admitted paid attempt. Recovery of uncertainty keeps
  the same attempt and its reservation until operator reconciliation. Invalid extraction is
  terminal. Job states are `queued`, `processing`, `ready`, and `failed`, with sanitized errors.
- `loadSavedEvidence(actor, opportunityId)` queues only the exact labeled synthetic packet through
  `saved-example-v1`. Hashes, kinds, and pages must match; arbitrary input cannot use saved output.
  This mode never calls a provider or inference admission.

`src/worker.ts` exports `runWorker(signal, provider?)`. Its CLI is
`node --conditions=react-server --import tsx src/worker.ts`; use a supervised service with the
runtime database role. There is no installed live provider adapter. A missing adapter fails the
job as unavailable, never as successful processing. Lease expiry never refunds inference spend.

HTTP operations use the same server functions and `{data}` / `{error}` envelopes:

- `GET /api/v1/desk/opportunities/:id/evidence` returns the workbench with a quoted revision ETag.
- `POST /api/v1/desk/vehicles/:id/sources?opportunityId=...` accepts multipart fields matching
  `addSource`, with `text` or `file`. Only the exact linked opportunity may receive the source.
- `POST /api/v1/desk/vehicles/:id/imports?opportunityId=...` accepts `{sourceIds}` and an
  `Idempotency-Key`. Model selection is server-only `EVIDENCE_MODEL`. Missing configuration is
  `503 NOT_CONFIGURED`. Explicit model policy, budgets, and a server-owned adapter are also needed.
- `POST /api/v1/desk/vehicles/:id/reviews?opportunityId=...` accepts a review command and quoted
  current `If-Match`. Select/correct commands include `field`, `claimId`, and `shareable`.
  Corrections add `value`, `unit`, and `reason`. Unknown commands include `field` and `reason`.
  Classification commands include `sourceId`, `classification`, `reason`, and `nextAction`.
- `POST /api/v1/desk/vehicles/:id/saved-example?opportunityId=...` queues the synthetic run.
- `POST /api/v1/desk/jobs/:id/retry` requeues only a permitted failed import.

All mutations require same-origin browser requests and fresh invited specialist access. Import
and retry require spending permission; uploads and human review do not consume inference budget.
Runtime credentials cannot edit identity permissions, immutable source bytes, or frozen job input.
The UI at `/desk/opportunities/:id` is a finite authored review workbench, not a generated component
renderer or a competing chat-card catalog. The finite chat presentation contract below is unchanged.

PDF extraction requires the OS `pdftotext` executable (`poppler-utils`), with a 10-second timeout,
2 MiB extracted-text cap, 10 MiB original-byte cap, and 500-page cap. Missing extraction tooling
returns `503 PDF_UNAVAILABLE`. Unreadable or scanned PDFs fail explicitly; OCR is not implemented.
Hosted PostgreSQL grants/locking and live Supabase verification remain unverified. Provider-specific
tokenizer, framing, pricing bounds, and live extraction quality also remain unverified.

## Implemented ETH-76 photo boundary

Photos extend the existing sources, import jobs, review transaction, and opportunity blockers.
There is no separate upload, worker, or draft store. `db/004-photos.sql` adds append-only machine
suggestions and human reviews. A worker can append a suggestion but cannot replace a human review.

- `addSource` also accepts `kind: "photo"` with `image/png` or `image/jpeg`, up to 5 MiB. Declared
  MIME must match the signature. Original bytes, SHA256, permission, and provenance are preserved.
  Photo bytes never enter text extraction or specification claims. Photos may link `blockerId` to
  the originating opportunity task. Authorized source routes serve these images inline; other
  source types remain attachments.
- View keys are `front`, `rear`, `driver_side`, `passenger_side`, `cab`, `pump_panel`, `odometer`,
  `identification_plate`, and `unknown`. Unknown is a review state, not a ninth required view.
- Existing import jobs freeze MIME with source metadata. Only authorized original data URLs enter
  `runInference.photos`; all photo counts, spending, retries, and concurrency remain under ETH-74.
  Output requires exactly one `{sourceId, view, readable, reason}` suggestion per photo. Non-photo
  classifications remain required. Photos cannot produce specification claims or public approval.
  The app has no installed live vision adapter. Missing configuration remains explicitly
  unavailable; controlled provider tests prove wiring and admission, not live vision quality.
- The existing review route accepts
  `{kind: "reviewPhoto", sourceId, view, readable, approved, reason}` with current quoted
  `If-Match`.
  Notes are required and bounded to 1,000 characters. Public approval requires a readable known view
  and a sales-audience source with explicit sharing permission. Stale reviews return `412`.
- `getWorkbench` adds `photos`, `coverage`, and `photoRequest`. Each photo retains `suggestion` and
  `review` separately; `effective` prefers the latest human decision. Coverage has eight entries
  `{view, state, sourceIds}`. States are `covered`, `missing`, `unreadable`, and `needs_review`.
  Only human-reviewed readable evidence counts as covered. Unknown, unreviewed, and unreadable
  photos remain incomplete. Identical image hashes count once, with the newest human decision
  taking precedence. Private photos never resolve shared coverage or shared blockers.
- Stable opportunity blocker keys are `photo:<view>`. Uploads and reviews refresh those same tasks,
  preserving their IDs and assignees. A human correction or later suggestion updates coverage
  without erasing original evidence or inventing another buyer opportunity.
- `suggestPhotoRequest` is pure content generation, not persistence. Its result includes
  `kind: "photo_evidence_request"`, `status: "unsent_suggestion"`, opportunity/vehicle IDs,
  `basisRevision`, `evidenceSourceIds` (including shared unknown photos), a placeholder
  `recipientLabel`, editable `body`, and `gaps`. Each gap carries view/state/source IDs, stable
  `blockerKey`, and the existing task's `blockerId`, `question`, and `assigneeId`. Those three task
  fields are null before the first photo upload creates tasks. ETH-77 must reauthorize references
  and recheck revision when persisting a final draft. No suggested contact is treated as verified.
- Public vehicles contain only explicitly approved, readable, shareable photos and coverage derived
  from that same public subset. `GET /api/v1/public/media/:id` rechecks latest approval on every
  request and serves exact image bytes with `no-store`; withdrawal returns `404`. Private source
  URLs, hashes, review notes, provenance, and machine suggestions never enter the public projection.

Coverage is evidence availability, not mechanical condition, roadworthiness, or a completed
inspection. The authored workbench offers editable unsent previews but cannot save or send them.
ETH-77 owns final persisted drafts and follow-up operations. No generated views are provided.

The [product plan][plan] owns scope and acceptance examples. [ADR.md](ADR.md) owns the formal
decision status. This reference adapts the [architecture candidate][candidate] to the later
[implementation direction](implementation-architecture.md). That direction supplies context and
research evidence, not automatic approval of every candidate detail.

## Decision status

### Agreed constraints

- ADR-001 keeps commercial commitments with humans. No tool accepts an offer, promises delivery,
  submits payment, or sends an external message.
- ADR-002 preserves original assertions and source evidence alongside extracted claims.
- ADR-003 uses supplied photos rather than generated vehicle views.
- The product plan requires persisted review, visible conflicts, cited supported answers, and
  qualified human handoffs. Unknown facts remain unknown.
- Ethan requires authentication before spending his inference tokens and requests MCP access for
  terminal clients. Both clients must obey the same permissions and spending controls.
- Ethan prefers verified Garage stack parity over Better Auth. Public JavaScript and the observed
  OAuth callback establish Supabase Auth for Garage's web login, not every Garage service.
- Ethan selected Yaklabs-style typed inline cards, not its visual design or runtime. Card contracts
  validate presentation only; Signal Desk retains authorization, evidence review, and spending.

### Selected implementation direction, not formal ADR acceptance

These are the current working choices. They do not promote ADR-004 through ADR-011 from Proposed
to Accepted, and they are not claims of working software.

- Use Next.js, React, TypeScript, Tailwind, PostgreSQL, and Supabase Auth for the prototype.
- Start UI components with shadcn and Base UI. Garage's Base UI usage is observable; its components'
  shadcn origin remains unverified.
- Use one application and one durable Node worker. Keep source bytes in private persistent storage.
- Separate vehicles, sources, claims, review decisions, and buyer opportunities into relational
  records. Small structured values may use JSONB.
- Use invited identities and explicit record access. Anonymous visitors can read approved public
  vehicle information but cannot initiate inference.
- Share sales operations between dashboard HTTP handlers and a thin local stdio MCP adapter.
  The adapter calls the application over HTTPS, not the database or inference provider directly.

### Superseded candidate alternatives

Do not implement the candidate's custom passphrase sessions or `POST /session`. Supabase Auth
replaces that authentication proposal. Do not store all evidence and review state in a mutable
vehicle JSONB aggregate. Relational evidence and review records replace that storage proposal.

The candidate allowed anonymous inquiry receipts. The current direction requires invited identity
for model-backed inquiries and buyer ownership for conversation results. The proposed buyer routes
below reflect that change. Knowing a receipt identifier must not grant access to a conversation.

## Ownership and data boundaries

A vehicle owns shared specifications. A source owns its original bytes or seller note, provenance,
content hash, and audience. A claim identifies a source assertion with its exact excerpt and page
or image locator. Chassis manufacturer and body builder remain separate facts, and values retain
units. The prototype assigns its own listing ID in code.

A review decision selects or corrects a claim without deleting its original evidence. A worker
produces extraction suggestions and attempt results, never publication permission or a replacement
for a human correction. New conflicting evidence requires review of affected approvals.

An opportunity owns one buyer's questions, conditions, offer, blockers, assignee, next action, and
unsent drafts. Another buyer must not see those records. Audiences are `private`, `sales`, and
`public`; they supplement ownership and membership, not replace them. Unknown audience is private.

Authorization runs before record retrieval for a client and before evidence enters a model prompt.
Public projections contain only approved, permitted facts and photos. Public citations expose
approved excerpts, not whole private documents. Approval and permission to share are separate.

## Shared operations and proposed modules

An operation completes authorization, validation, persistence, and job scheduling together.
Clients do not coordinate those internal steps or supply a trusted actor. Server authentication
constructs the actor from a verified identity and fresh application permissions.

The candidate's operation boundaries remain useful, with these proposed signatures:

```text
queueImport(actor, vehicleId, sourceIds, idempotencyKey) -> Job
reviewVehicle(actor, vehicleId, revision, review) -> VehicleView
submitInquiry(actor, vehicleId, inquiry, idempotencyKey) -> Receipt
```

Queueing an import does not create a second opportunity. Reviewing a fact does not erase source
assertions. Recording an inquiry or offer does not accept a commercial offer.

Proposed ownership, not existing files:

| Module | Responsibility |
| --- | --- |
| `app/` | Screens and thin HTTP route handlers |
| `contracts/http.ts` | Runtime request and response schemas, with inferred TypeScript types |
| `server/signal.ts` | Authorized sales operations, transactions, and client projections |
| `server/model.ts` | Bounded provider requests and validated model results |
| `server/files.ts` | Private source bytes and authorized file access |
| `worker.ts` | Durable job claims and execution |
| MCP adapter, path undecided | Tool input parsing and authenticated application calls |

Module names may change without changing the HTTP contract. No repository-class hierarchy, vector
database, Redis queue, separate Express service, or second sales-agent implementation is required.

## Agreed specialist chat presentation boundary

The specialist can request results in natural language. Inline output uses a finite catalog of
developer-authored components with strict required and optional props. The model cannot generate
bespoke HTML, JSX, SVG, executable chart specifications, or standalone visual artifacts as answers.
Visual styling belongs to this project; reuse the contract pattern, not Yaklabs' whole application.

UI-card schema validation rejects malformed or unknown props before rendering. The second malformed
call retires that tool for the rest of the logical turn. Counts survive retries of that turn and
reset for a new turn. Authorization and evidence failures remain separate business outcomes, not
prop errors to fix by retrying until accepted.

Shape-valid props are not proof of factual accuracy. The model requests server-owned result
references; authorized operations resolve facts, citations, units, and any chart datasets. Unknown
or conflicting evidence renders an explicit review state with the missing or disputed material
and the next human action, never a verified fact. Prose answers need evidence checks too.

ETH-77 implements the finite catalog and non-streaming chat routes below. The existing application
and durable worker remain unchanged. No separate daemon or language-model adapter is installed.

## Implemented ETH-77 buyer assistance and chat

`db/005-assistance.sql` adds append-only inquiries, routing decisions, unsent drafts, logical chat
turns, and card-call outcomes. `src/server/assistance.ts` owns the shared operations. They reuse
the evidence transaction, current session and opportunity permissions, and existing blocker records.
There are no external sending, acceptance, counteroffer, payment, or delivery operations.

- `submitInquiry(actor, opportunityId, input, key)` records an inquiry on an existing opportunity.
  Strict inputs are `{kind:"question", text}`, `{kind:"fact", text, field}`, or an explicit
  `{kind:"offer", text, amountMinor, currency:"USD", timingText, conditions, unansweredQuestions}`.
  Amounts are positive integer cents. Original text and terms remain unchanged. Unknown wording
  becomes `human_review`, never an inferred offer. Whole single-field labels and bounded questions
  such as "What is the tank capacity?" use current approved public evidence without inference.
- R12 states are `supported`, `missing_evidence`, `conflict`, `human_review`, and
  `conditional_offer`. Each inquiry retains its initial basis and subsequent specialist corrections.
  `correctInquiry(actor, opportunityId, inquiryId, input)` appends a required field or null, reason,
  next action, and expected routing revision. Stale corrections return `412`. Corrections cannot
  rewrite structured offer terms or convert prose into an offer.
- Stable `inquiry:<id>` blockers retain the question, assigned specialist, and next action.
  Unknown and conflicting answers return explicit review cards. Handoffs retain amount, timing,
  conditions, and unanswered questions with `recorded_not_accepted`, never acceptance.
- `getAssistance(actor, opportunityId)` resolves current evidence on every read. Buyer views exclude
  specialist chat, internal routing history, private next-action text, and unsent drafts. Another
  buyer cannot retrieve the opportunity. Citations expose only the existing approved source label
  and excerpt, not a whole source or a fabricated page locator.
- `createDraft(actor, opportunityId, input, key)` persists `seller_request`, `buyer_followup`, or
  edited `photo_request` content as unsent. All require the current evidence revision. Follow-ups
  require a reviewed, shareable seller response linked to that inquiry's exact blocker. Drafts
  retain their review and evidence basis and display stale after evidence changes. Photo requests
  retain the upstream suggestion's source and task references after reauthorization. Recipient
  labels remain unverified. No delivery action exists.
- `beginChatTurn(actor, opportunityId, message, key)` persists a specialist turn and inquiry
  atomically. Identical retries return the same turn. This bounded language path has no live model
  and routes unsupported wording to human review. It does not claim general language understanding.
- `renderCardCall(actor, opportunityId, turnId, callId, call)` validates presentation only. The
  finite tools are `answer`, `review`, and `handoff` with required `props.inquiryId`, plus `draft`
  with required `props.draftId`. No optional props exist yet. Unknown props, invented values,
  markup, and chart specifications are rejected. Valid references resolve through authorized
  server operations, not through caller-supplied facts.
- Two distinct malformed calls retire that named tool for the logical turn. Persisted call IDs
  make retries idempotent and rejection counts survive process restarts. Other tools and new turns
  remain available. Unavailable or unauthorized result references do not count as malformed props.
  Replaying accepted calls rechecks current evidence rather than returning a stale stored fact.

HTTP routes use the existing `{data}` or `{error}` envelopes and protected `no-store` responses:

- `GET /api/v1/desk/opportunities/:id/assistance` returns specialist assistance.
- `POST` on that path accepts strict `chat`, `inquiry`, `draft`, `correct`, or `card` commands.
  Chat uses `{kind:"chat", message}`. Inquiry and draft use `{kind, input}`. Correction adds
  `inquiryId`. Card uses `{kind:"card", turnId, callId, call}`. Creates require `Idempotency-Key`.
- `GET` and `POST /api/v1/buyer/vehicles/:id/inquiries?opportunityId=...` require an invited buyer
  owning that exact linked opportunity. POST accepts the strict inquiry input and idempotency key.
  Mutations require same-origin requests and bounded bodies. These deterministic operations require
  no spending permission and dispatch no paid attempts.

The specialist screen adds bounded chat and human follow-up controls above the existing workbench.
The public vehicle links invited buyers to their own existing conversations at
`/buyer/vehicles/:id` and `/buyer/opportunities/:id`. These links create no leads.
Behavioral tests use real disposable PostgreSQL and production HTTP with controlled synthetic auth.
Hosted auth, live extraction, vision, language-model quality, and live delivery remain unverified.

## Identity and spending boundaries

Supabase Auth supplies identity; application permissions decide record access and spending rights.
Public registration is disabled in the prototype direction. Do not trust client-selected roles,
user-editable metadata, or a client session object as authorization. Use a separate prototype
project, never Garage's project configuration or an existing Garage login.

Before each paid attempt, check current access and reserve a conservative maximum charge against
per-user and installation budgets atomically. Bound model choice, input size, output tokens,
photo count, attempts, and concurrency on the server. Rate limits alone do not cap spending.

Record provider usage and settle reservations per attempt. Preserve uncertain reservations after
an ambiguous failure until reconciled. Retries need permission and budget too. Keep provider keys
and privileged Supabase credentials server-side. Exact budget amounts and revocation mechanics
remain unresolved; provider-side limits are an additional backstop, not an exact billing guarantee.

The MCP direction uses expiring, revocable application tokens with separate read, write, and
spending permissions. Token issuance endpoints and scope names remain proposals. Tokens do not
widen record ownership, publish evidence, or authorize external delivery.

## Proposed HTTP conventions

All application routes below use the `/api/v1` prefix. Supabase authentication routes and callbacks
are separate and are not redefined by this contract.

JSON responses use one success or error envelope. Binary source and image responses are exceptions.
These sketches express shape, not executable schemas:

```text
Success<T> = { data: T }
Failure = { error: { code, message, fieldErrors?, retryable } }
```

- IDs are opaque strings. Timestamps are UTC ISO strings. USD amounts are integer cents.
- Protected reads return `Cache-Control: no-store`. Public caching and invalidation are unresolved.
- Existing-record edits use `If-Match` against a server-issued revision. Stale edits return `412`.
- Create, import, and inquiry requests use `Idempotency-Key`. Reuse with a different payload returns
  `409`. Key scope, retention, upload hashing, and the precise retry response need definition.
- Errors contain sanitized explanations, not source text, private prompts, or provider secrets.
- JSON field names below are proposals. Complete runtime schemas must precede independent clients.

### Proposed data variants

Missing, conflicting, and reviewed facts are distinct states. A reviewed fact records the evidence
basis so the server can detect a later conflicting source rather than silently reuse approval.

```text
Fact = { kind: "unknown" }
     | { kind: "conflict", claimIds: [ClaimId, ClaimId, ...] }
     | { kind: "reviewed", claimId, basis }

Inquiry = { kind: "fact", field }
        | { kind: "question", text }
        | { kind: "offer", amountMinor, currency: "USD", timingText,
            conditions: string[], unansweredQuestions: string[] }

Job = { id, state: "queued" | "processing" | "ready" | "failed",
        attempts, error, provenance }

Receipt = { id, state, outcome }
Outcome = answered with citations | needs_review | handoff_recorded
```

The structured offer form preserves stated terms. It does not establish that arbitrary prose has
been understood. Receipts never contain internal opportunity records or another buyer's messages.
Exact receipt states, nullable values, provenance fields, and complete fact schemas remain open.

### Proposed specialist reads

These routes require specialist identity and record access. Shapes describe the `data` payload.

- `GET /desk/opportunities?cursor=...` returns `{items, nextCursor}`. Each item includes `id`,
  `vehicleId`, `title`, `assigneeId`, `status`, `blockerCount`, and `nextAction`.
- `GET /desk/opportunities/:id` returns `{opportunity, vehicle, blockers, drafts, jobs, etag}`.
- `GET /desk/vehicles/:id` returns `{id, etag, evidenceBasis, sources, claims, facts, photos,
  coverage}`. Sources and claims are permission-filtered even in the desk.
- `GET /desk/sources/:id/content` returns authorized source bytes.
- `GET /desk/jobs/:id` returns `Job` with sanitized failure and provenance information.
- `GET /capabilities` reports available processing capabilities, not provider secrets. Its audience
  and the final shape are unresolved. The candidate sketch was `{extraction: "live" | "disabled",
  seedAvailable: true}`; it must not claim a seed exists before one is supplied.

### Proposed specialist mutations

- `POST /desk/vehicles/:id/sources` accepts multipart files and an optional note. It returns
  `{sources: [{id, name, kind, sha256, audience}]}`. Upload does not imply approval or publication.
- `POST /desk/vehicles/:id/imports` accepts `{sourceIds}` and returns `202` with a `Job` payload.
  Source ownership, spending permission, and admission are checked server-side.
- `POST /desk/jobs/:id/retry` accepts `{}` and returns `Job`. Eligible states, response status,
  revision handling, and key semantics remain to be specified.
- `POST /desk/vehicles/:id/reviews` accepts a review command and returns an updated `VehicleView`.
- `PATCH /desk/opportunities/:id` accepts `{assigneeId?, nextAction?}` and returns the updated
  opportunity. An assignee must be an eligible specialist, not an arbitrary submitted user ID.
- `POST /desk/opportunities/:id/resolutions` accepts `{blockerKey, evidenceIds, note}` and returns
  `{opportunity, job}`. A resolution cannot manufacture evidence or bypass disclosure rules.
- `PUT /desk/opportunities/:id/drafts/:draftId` accepts `{recipientLabel, body}` and returns the
  edited draft. Every draft remains unsent. Draft creation is needed by the MCP direction, but its
  HTTP endpoint and payload are not yet specified by the candidate.

Proposed review commands use a `kind` discriminator:

```text
selectClaim  { field, claimId, basis }
correctClaim { field, value, citation, reason, basis }
markUnknown  { field, reason, basis }
reviewPhoto  { sourceId, view, readable }
setAudience  { targetId, audience }
```

Correction must retain supporting evidence. `setAudience` cannot grant access merely because the
caller is a specialist. Who may authorize widening visibility and which source rights permit it
remain an explicit policy decision. Full command schemas, photo categories, and value types must
be defined before implementing this route.

### Proposed public reads and authenticated buyer operations

- `GET /public/vehicles/:id` returns `{id, title, facts, photos, coverage, prototypeLabel}` from
  the approved public projection. It initiates no paid processing.
- `GET /public/citations/:id` returns `{sourceLabel, locator, excerpt, mediaUrl?}` only for a
  permitted published citation. It is not a source-document download endpoint.
- `GET /public/media/:id` returns explicitly approved image bytes only.
- `POST /buyer/vehicles/:id/inquiries` accepts `Inquiry` from an invited buyer and returns `202`
  with `{receiptId, state}`. Paid work also requires spending permission and budget admission.
- `GET /buyer/receipts/:id` returns `{state, outcome}` only to the owning buyer. This replaces the
  candidate's anonymous `GET /public/receipts/:token` design.

These buyer paths replace the candidate's `POST /public/vehicles/:id/inquiries` and token-bearing
receipt response. They are proposals, not an additional anonymous route kept for compatibility.

### Proposed status codes

| Code | Meaning |
| --- | --- |
| `401` | Authentication required or credential invalid |
| `403` | Authenticated actor lacks permission |
| `404` | Record absent; inaccessible-record concealment policy remains open |
| `409` | Invalid transition or idempotency payload mismatch |
| `412` | Stale revision |
| `413` | Upload or request too large |
| `415` | Unsupported media type |
| `422` | Invalid input |
| `429` | Rate or concurrency limit |
| `503` | Processing capability unavailable |

Budget exhaustion uses `429 BUDGET_EXHAUSTED`, as defined in the implemented ETH-74 section.
Do not silently treat a denied paid request as a successful saved-run response.

## Durable work and evidence consistency

Persist queued, processing, ready, and failed states. Imports deduplicate by vehicle, source
content, and extraction configuration. Stable blocker keys prevent repeated tasks. Database
effects must remain idempotent even when a provider call may have happened before a crash.

The candidate proposes leased claims with fencing tokens so an expired worker cannot commit over
a newer attempt. It proposes three transient retries with backoff. Neither the retry count, lease
duration, nor backoff schedule is settled. Every attempt must still obey spending admission.

Uploads require bounded staging, hashing, durable file references, and orphan recovery. Public
reads must see consistent approval and evidence state. Exact transaction boundaries, approval
fingerprints, file-store implementation, and concurrent review rules remain to be designed.

## Model behavior and evaluation

Use real configured extraction and vision for arbitrary uploads. OpenAI is a candidate provider,
not an agreed provider purchase or model selection. Jev-assisted routing remains optional and
requires a measured baseline before claiming an efficiency benefit.

Without credentials, arbitrary uploads cannot become extracted evidence. Exact field lookups may
use approved facts without inference. Unsupported questions can create human-review items, and
structured offers can produce handoffs without claiming model interpretation. A labeled saved run
never substitutes silently for a different upload. These fallback responses need final schemas.

Acceptance is grounded in the product plan's AE1 through AE6, plus cross-buyer access denial,
revoked access, concurrent budget admission, and equivalent dashboard and MCP permissions. Record
actual model version, duration, usage, and review outcomes. Do not claim live quality or cost until
a representative trial has run.

## Unresolved before implementation

- Complete runtime schemas, field enums, nullability, units, citation locators, and error codes.
- Supabase project setup, sign-in method, session validation and revocation, invitations, and
  permission to publish evidence. Authentication alone is not spending authorization.
- File and model providers, private hosting, MIME and byte limits, models, and budget amounts.
- ETag format, revision scope for job actions, idempotency scope and retention, and pagination.
- Lease and retry policy, uncertain-spend reconciliation, and storage recovery behavior.
- Hosted installation-free MCP access and OAuth, if that access becomes necessary.
- Hosted MCP OAuth is deferred. A local adapter does not imply an unauthenticated remote endpoint.

Resolve these in their owning implementation ticket and update this reference with the chosen
contract. Record newly agreed architectural intent in ADR.md. Do not infer approval from a proposed
endpoint appearing here or from a ticket being filed.

[plan]: plans/2026-10-15-1440-feat-signal-desk-plan.md
[candidate]: https://ampcode.com/threads/T-01a1410b-5ea4-721e-971e-f61c38283d0a
