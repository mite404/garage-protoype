# Architectural design and HTTP contracts

This is the project's architectural and HTTP reference, not a description of implemented APIs.
The repository currently contains planning documents only. HTTP paths, payload sketches, and module
names below are proposed until implementation validates them.

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

Budget exhaustion needs its own stable error code and HTTP mapping before client implementation.
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
- MCP tool names, application-token lifecycle, scopes, draft-creation endpoint, and client setup.
- Hosted MCP OAuth is deferred. A local adapter does not imply an unauthenticated remote endpoint.

Resolve these in their owning implementation ticket and update this reference with the chosen
contract. Record newly agreed architectural intent in ADR.md. Do not infer approval from a proposed
endpoint appearing here or from a ticket being filed.

[plan]: plans/2026-10-15-1440-feat-signal-desk-plan.md
[candidate]: https://ampcode.com/threads/T-01a1410b-5ea4-721e-971e-f61c38283d0a
