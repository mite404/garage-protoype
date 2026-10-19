---
title: Demand-led sourcing - Plan
type: feat
date: 2026-10-19
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Demand-led sourcing - Plan

Status: Draft implementation plan. The product direction is approved; implementation belongs to the
[account-first workflow thread][implementation]. The eight units below are planned work, not filed
tickets or completed features. Schema changes and the evidence context described below need review.

## Goal Capsule

- Objective: Help specialists turn a confirmed unmet buyer need into a suitable, seller-authorized
  opportunity, or explain why the search should stop, without unnecessary customer work.
- Means: Buyer-demand-led sourcing, supported by fit decision packets and source-change triggers
  (ADR-033, ADR-034, ADR-035).
- Authority: Ethan approved this combination after comparing three alternatives in the
  [planning conversation][conversation]. The original evidence and human-review boundaries remain.
- Execution: Deliver small, runnable units with behavioral tests before dependent work begins.
- Ownership: Existing growth and PostHog owners retain their work. This plan describes the next
  increment, not permission to duplicate or redirect their implementation.
- Delivery: Implementation is assigned to the account-first workflow thread. Shipping this document
  does not authorize shared migrations, paid collection, customer delivery, deployment, or
  commercial commitments.

---

## Product Contract

### Summary

Keep a buyer's requirements even when no vehicle matches. Search permitted existing inventory
first, then use those requirements to guide seller discovery. Review evidence and fit before
reactivating the buyer. Source changes can reopen a useful investigation but cannot authorize mail.

### Problem Frame

Directory growth does not show whether a department has a need that Garage can serve. Faster
answers can waste time on unsuitable vehicles. The current conversion workflow begins with an
opportunity, so it cannot independently represent a buyer waiting for the right inventory.
Garage's actual dominant bottleneck remains unverified; this is an interview hypothesis.

### Key Decisions

- One connected workflow, not three products (session-settled: user-approved, chosen over separate
  discovery, decision-support, and sourcing apps). Governs R1, R3, R5, R7.
- Fit decisions support sourcing, including appropriate rejection rather than advancement at any
  cost (session-settled: user-approved, chosen over answer-speed optimization). Governs R3, R4, R9.
- Source changes supply reasons to reassess, not proof of intent or sending authority
  (session-settled: user-approved, chosen over a standalone timing campaign). Governs R5, R6.

### Requirements

#### Buyer needs and fit

- R1. A specialist can record, confirm, revise, pause, fulfill, or close a buyer need without
  creating a vehicle, opportunity, or authenticated buyer. Preserve its owner and original evidence.
- R2. A need distinguishes hard constraints, preferences, unknowns, purchase readiness, contact
  permission, and a next review date. A new revision invalidates decisions based on an older one.
- R3. Compare the current need with permitted existing inventory before starting new sourcing.
  Each constraint is met, failed, unknown, or conflicting, with its supporting source and units.
- R4. A specialist reviews a fit decision packet and chooses proceed, investigate, or reject this
  candidate. A hard failure blocks a proceed decision; changing the need requires a separate
  revision.
  Unknown required evidence cannot become a positive fit or a mechanical/legal assurance.

#### Sourcing and changed evidence

- R5. An active unmet need can have candidate seller investigations with an owner and next action.
  A directory entry or replacement signal alone cannot create verified inventory or a qualified
  deal.
- R6. Approved, NY-scoped sources produce dated observations and material-change suggestions through
  the separate background analyst. Identical reimports and repeated sweeps do not duplicate work.
- R7. A seller's permissioned reply can establish availability and authority for review, then enter
  the existing evidence workflow. Recontact a buyer only after current fit, permission,
  availability, and suppression checks pass and a specialist approves the exact message.
- R8. All projections and actions enforce current account and opportunity access. Keep buyer
  budgets, identity, private requirements, and competing negotiations out of seller-facing material
  by default.
  Models cannot grant permissions, merge identities, publish claims, or send messages.

#### Learning and proof

- R9. Record need-level outcomes and active effort separately for specialist, buyer, and seller.
  Distinguish suitable advancement, correct rejection, unresolved work, and withdrawn demand.
- R10. Preserve eligibility, assignment, actual action/exposure, and outcome as different events.
  Retain nonresponders and unsuccessful searches in the enrolled denominator, with a fixed window.
  Reuse the PostHog owner’s boundary; synthetic data never supports a sales-lift claim.
- R11. Render current need, candidate fit, trigger evidence, approval, and next action directly on
  authorized account pages. Provide loading, empty, stale, denied, conflict, and failure states.
- R12. Prove one connected synthetic journey and contrasting failures on the real app and worker.
  External delivery stays disabled; controlled providers are labeled and cannot contact customers.

### Scope and assumptions

Initial discovery remains NY-only and limited to fire engines and pumpers. Use existing approved
directory input, manually supplied permissioned documents, and explicitly synthetic procurement
fixtures. No general crawler, new enrichment provider, vector database, or agent framework is
needed.
New automatic source connectors require a separate scope and access decision.

Need confirmation means the specialist records a dated buyer statement and provenance, not that an
LLM inferred demand. A permissioned call note can supply that statement. Contacts remain distinct
from authenticated users. One organization can buy and sell without changing its identity.

For the first slice, monetary constraints are USD with an explicit basis such as purchase price
or total budget. Never compare a listing price to a total-cost ceiling as if freight and repairs
were free. Station clearance is a dimensional limit, not an inferred vehicle-height fact.

No customer interviews, production results, or measurable revenue improvement are claimed. A later
permissioned walkthrough and live pilot are evidence activities, not features generated by code.

### Acceptance examples

- AE1. A confirmed need exists with no candidate vehicle and no opportunity; only its authorized
  specialist can read it. Covers R1, R8, R11.
- AE2. A buyer permits at most 120 inches of height; a reviewed candidate is 121 inches tall.
  The packet rejects fit without requesting its pump report. Exactly 120 meets an inclusive limit.
  Missing or conflicting height stays unresolved. Covers R2, R3, R4.
- AE3. A replacement purchase is mentioned in minutes. The system proposes checking availability,
  not listing the old truck for sale. A corrected withdrawal retracts the suggestion. Covers R5, R6.
- AE4. A seller confirms availability, but the buyer pauses the need before approval. The
  reactivation draft becomes ineligible and no message or opportunity is created. Covers R2, R7, R8.
- AE5. Two buyers could use one truck. Neither receives a reservation or guaranteed availability;
  one completed sale cannot be counted as two fulfilled needs. Covers R5, R7, R9, R10.
- AE6. The same observation, seller reply, or dispatch callback arrives twice. Records and outcome
  counts remain stable, while original evidence remains inspectable. Covers R6, R7, R10, R12.

---

## Planning Contract

### Verified baseline and external dependencies

This checkout starts at [the original main baseline][baseline]. Its municipality access requires
an assigned opportunity; `municipality-schema.ts` requires a nonempty acquisitions list. Existing
interests require a vehicle. None is an independent buyer need or a seller authorization grant.

Reuse these inspected boundaries:

- `apps/web/src/server/access.ts`: fresh credentials and opportunity membership.
- `apps/web/src/server/municipalities.ts`: scoped buyer workspace and owned inventory projection.
- `apps/web/src/server/evidence.ts`: permitted facts, source citations, revisions, stale reviews.
- `apps/web/src/server/assistance.ts`: unsent drafts, exact evidence basis, stale-draft detection.
- `packages/contracts/src/evidence-schema.ts`: typed fields and units, not yet a need/fit schema.
- `apps/web/src/mcp.ts`: shared authorized operations, not an independent permission system.

The [growth owner][growth] reported local U1-U7 work on `feat/ny-growth-loop`: scoped growth
accounts, observations, review/routing, outreach, feedback, an analyst, schedules, account pages,
and outcomes.
Its files include `growth.ts`, `growth-views.ts`, `growth-scheduler.ts`, `outreach.ts`, and
`feedback.ts` under `apps/web/src/server/`, plus `apps/web/src/agents/growth.ts`.
These are prerequisite integration points, not files verified in this checkout. At planning time,
its combined verification and browser fixes were pending. Confirm its latest handoff rather than
treating this status as current. ADR-032 belongs to that owner.

The [PostHog owner][analytics] reports a separate local adapter in
`apps/web/src/server/posthog.ts` and an account-level `reviewed-outreach-v1` experiment.
That experiment compares outreach messages; it does not evaluate demand-led sourcing.
Assignment persistence, exact exposure meaning, and integration remain prerequisite contracts.

U1 must consume exact reviewed snapshots or landed commits from both owners and record their
actual verification. Never fetch another branch's files into production code merely because this
plan names them. All new paths below are proposed, and dependency paths must be reconciled after
that handoff.

### Key Technical Decisions

- KTD1. Anchor a need to the existing scoped growth account, with an optional reviewed organization
  link; do not manufacture a vehicle/opportunity or remove the municipality access anchor (R1, R8).
  The growth owner’s account access predicate remains authoritative. Existing org linkage alone
  cannot grant access to private opportunities. Support a zero-opportunity account view separately.
- KTD2. Store versioned need inputs and human decisions; derive current fit from current approved
  evidence (R2-R4). Freeze a packet's need/evidence revisions when approved so later changes make
  it stale. Keep numeric comparisons in ordinary code and ambiguous extraction in the analyst.
- KTD3. Use a small typed constraint set: apparatus type, purchase/total budget, maximum height,
  minimum pump/tank capacity, required documents, and stated availability date (R2-R4).
  Normalize only supported units. Unknown costs or units remain unknown. Do not add a universal
  rules language, probabilistic fit score, or silent preferred-value fallback.
- KTD4. A sourcing case links one need to an existing seller account or a possible seller record
  (R5-R7). Candidate availability starts unconfirmed. Reviewed seller identity and authority precede
  any asset creation; link an existing asset when known, and flag uncertain identity for review.
  Pre-opportunity evidence needs an explicit access and spending boundary: existing sources and
  model admission require an opportunity. U1 must settle a scoped account or sourcing-case context
  before U4 imports seller evidence. Do not create dummy opportunities or weaken existing access.
- KTD5. Extend the existing observation/scheduler/analyst flow, not a second runtime (R6).
  Stable observation identity plus normalized relevant content determines a material change.
  Store the affected need revision, source publication/observation times, and suggestion
  disposition.
  A dismissal stays dismissed for the same change; a new material revision can create new work.
- KTD6. Extend reviewed outreach for pre-opportunity seller inquiries and buyer reactivation (R7).
  Recheck current permission, suppression, need state, packet basis, and seller availability at
  approval and dispatch. Reuse uncertain-send reconciliation rather than guessing a retry is safe.
- KTD7. Persist outcome facts locally before optional telemetry (R9, R10). Reuse the one PostHog
  adapter and its pseudonymous identities; never forward raw event detail, source text, or budgets.
  Provider acceptance, delivered notification, and buyer response remain separate timestamps.
- KTD8. Keep one feature-owned `sourcing.ts` domain module and one React-free `sourcing-schema.ts`
  initially, with app routes calling the domain operations (R1-R11). UI and MCP reads share the same
  authorization. Do not expose sending, qualification, or approval as autonomous chat tools.

### Approved account-first interaction

Use the account page for decisions, the work queue for prioritization, and contextual chat for
investigation and drafting. This is the internal specialist workspace, not a seller-facing portal.
Keep the buyer need, inventory check, trigger evidence, constraint table, owner, next action,
contact readiness, and outreach status visible without a chat query. Render saved source, fit,
draft, reply-review, and decision cards through the same authorized operations in chat and on the
account page. Closing chat must not discard reviewed work. Proposed analyst interpretations remain
separate from reviewed facts, and unconnected Forms must not appear in outbound messages.

### Data and lifecycle sketch

The following is directional structure, not a prescribed migration or public API.

- Buyer need: scoped account, original statement, confirmed revision, structured constraints,
  readiness, permission reference, state, owner, review date.
- Sourcing case: need, seller account, optional vehicle, current investigation state, owner/action.
- Fit packet: need revision, permitted vehicle/evidence revision, per-constraint findings, unknowns,
  cited facts, recorded human disposition, approval basis.
- Source-change suggestion: stable source/version, observed change, affected need/case, citations,
  uncertainty, review disposition, durable deduplication key.
- Action/outcome event: durable key, account/need/case references, actor, occurred time, synthetic
  marker, approved action reference, outcome evidence, bounded effort records.

Need lifecycle: draft -> active -> paused, fulfilled, or closed. Reopening paused/closed demand
requires explicit reconfirmation. Revisions never rewrite original statements or old decisions.
Case lifecycle: investigate -> awaiting seller -> evidence review -> ready for buyer review ->
handed off, rejected, or unavailable. A source change queues reassessment rather than advancing it.

The sequence is need -> permitted inventory check -> seller investigation -> reviewed evidence ->
fit packet -> reviewed buyer follow-up -> buyer-confirmed opportunity. Stop or pause at any step
when evidence, authorization, permission, or need state no longer supports progression.

### Measurement contract

Primary outcome: distinct enrolled unmet needs reaching a buyer-confirmed, seller-authorized
qualified opportunity within a predeclared window divided by all eligible enrolled unmet needs.
A qualified opportunity requires current fit against hard constraints, reviewed availability and
seller authority, buyer-confirmed interest, and an owned next step. It is not a completed sale.

Freeze the protocol version, eligibility, window, and assignment before actions. Keep each buyer
account in one arm across contacts and needs. Use a separate sourcing study identifier, not
`reviewed-outreach-v1`; leave it disabled until an approved pilot. A synthetic fixture can use a
30-day window solely to exercise boundary behavior, not as a validated sales-cycle assumption.

Compare demand-led sourcing with ordinary reviewed prospecting under an equal operator capacity
budget. Reuse assignment infrastructure, record actual actions separately, and count missing
exposure/nonresponse in the assigned cohort. Report account and need counts together. Late outcomes,
withdrawn needs, invalidated matches, and incomplete windows remain visible rather than
disappearing.

Track active human minutes by actor separately from calendar delay; unavailable effort is missing,
not zero. Report corrections, false-fit decisions, unnecessary seller requests, suppression,
backlog, latency, and admitted model cost. Correct rejection is useful but cannot inflate
advancement.

One seller/vehicle can serve buyers in both arms. Record shared inventory and cross-arm contact
contamination; account randomization alone does not establish marketplace-wide incremental sales.
Do not rank winners or make causal claims from synthetic or underpowered results. A future live
protocol must address inventory competition and sample size with the business owner first.

---

## Implementation Units

### U1. Reconcile the verified growth and analytics prerequisites

- Planned ticket: 013, sourcing integration baseline (not filed). Requirements: R8, R10, R12.
- Goal: Establish one tested integration baseline without reimplementing either owner's work.
- Files: growth/analytics prerequisite files above; `docs/contracts.md`; this plan's dependency
  notes.
- Approach: Record exact source commits or snapshot manifests, inspect combined migrations and
  authorization, and settle committed-event mapping plus sent/delivered semantics with both owners.
- Tests: Existing `growth.test.ts`, `posthog.test.ts`, `access.test.ts`, and worker tests after
  transfer. Confirm disabled telemetry/delivery, private-detail omission, and nonduplicated events.
- Verification: Combined baseline gates and actual file/API map. Stop on unresolved ownership or
  failed required checks. Do not mark an owner's incomplete work finished to unblock this unit.

### U2. Capture buyer needs without inventing deals

- Planned ticket: 014, buyer needs (not filed). Depends on U1. Requirements: R1, R2, R8, R11.
- Files: new `packages/contracts/src/sourcing-schema.ts`, new `apps/web/src/server/sourcing.ts`,
  `db-schema.ts`, generated/custom migrations, account page and growth HTTP boundary.
- Approach: Use KTD1-KTD3; put the need form and revision history on the scoped account profile.
- Tests: New `apps/web/src/server/sourcing.test.ts`, new
  `packages/contracts/src/sourcing-schema.test.ts`, and existing account HTTP/browser tests.
  Confirm a need without any vehicle, cross-owner denial, revocation, duplicate submission,
  pause/reopen, conflicting revision rejection, and unsupported budget/unit rejection.
- Verification: Disposable database migration plus real zero-opportunity profile and form flow.

### U3. Compare inventory and review fit decision packets

- Planned ticket: 015, fit decision packets (not filed). Depends on U2.
  Requirements: R2-R4, R8, R11.
- Files: sourcing schema/domain, evidence field contract and extraction allowlist where required,
  existing evidence review, new `packages/catalog/src/fit-decision-packet.tsx` and its story.
- Approach: KTD2-KTD3. Add cited height/availability evidence only through normal review. Reuse
  permitted published inventory and authorized private facts; never bypass access to find a match.
- Tests: Extend sourcing/evidence tests and new packet stories. Exercise AE2, purchase versus total
  budget, inches versus feet, missing freight cost, contradictory facts, inaccessible inventory,
  stale packet, hard-fail proceed rejection, and an explicit requirement revision.
- Verification: Reviewed packet in fit, hard-failure, unknown, conflicting, and stale UI states.

### U4. Source and qualify sellers against an unmet need

- Planned ticket: 016, demand-led seller sourcing (not filed). Depends on U3.
  Requirements: R5, R7, R8, R11.
- Files: sourcing domain/schema, growth review/routing, outreach, feedback, evidence import,
  account page, and growth HTTP commands.
- Approach: KTD4/KTD6. Create an owned investigation only after an inventory check. Link the
  existing seller account; draft a minimal inquiry without private buyer details. Review replies
  for availability, authority, identity, and facts before linking/creating the candidate asset.
- Tests: Extend sourcing/growth tests. Cover replacement-without-retirement, seller denial,
  ambiguous identity, existing vehicle deduplication, one account buying and selling, two buyers
  interested in one truck, and revoked permission before drafting or review.
- Verification: A synthetic reply reaches the existing evidence review without becoming an
  automatically approved fact or creating a second seller/vehicle.

### U5. Reassess cases when relevant sources change

- Planned ticket: 017, source-change triggers (not filed). Depends on U4.
  Requirements: R5, R6, R8, R11.
- Files: growth observation import, `growth-scheduler.ts`, `agents/growth.ts`, sourcing domain,
  account insight projection, existing Node and Cloudflare sweep entry points.
- Approach: KTD5. Start with approved existing inputs; process normalized changes through bounded
  jobs. Recheck authority before model calls and before committing suggestions. Keep failures,
  dismissed suggestions, withdrawn facts, and stale needs visible.
- Tests: Extend sourcing/growth scheduler tests and Cloudflare coverage. Reimport unchanged text,
  reorder source fields, replay a job, crash after result commit, deliver an older source version,
  revoke access, exhaust budget, withdraw availability, and revise a dismissed signal.
- Verification: Scheduled work runs without an open browser and produces one reviewable action
  per relevant change, with no automatic outreach or duplicate spending.

### U6. Reactivate buyers and hand off qualified opportunities

- Planned ticket: 018, reviewed buyer reactivation (not filed). Depends on U4, U5.
  Requirements: R4, R7, R8, R11.
- Files: sourcing domain/schema, outreach, assistance, growth qualification, account page, MCP
  read projections, and shared draft UI.
- Approach: KTD6/KTD8. Show what materially changed and obtain approval for the exact current
  packet/message. A confirmed reply can hand off to the existing opportunity without fake logins.
- Tests: Extend sourcing/outreach/assistance/MCP tests. Cover AE4/AE6, stale approval, seller sale
  before dispatch, suppression after approval, uncertain send, duplicate reply, existing opportunity
  reuse, denied reads, and private buyer data omitted from seller views.
- Verification: Real synthetic click/reload/reply flow with controlled mail; all stopping conditions
  leave a visible reason and no external effect.

### U7. Measure need outcomes and the work required

- Planned ticket: 019, sourcing outcomes (not filed). Depends on U6 and analytics handoff.
  Requirements: R9, R10.
- Files: sourcing events/projections, growth operations, PostHog adapter/test after owner handoff,
  study protocol configuration, and authorized reporting UI.
- Approach: KTD7 and the measurement contract. Extend the existing ledger and adapter, not a
  parallel analytics stack. Keep durable denominators independent of the current UI page.
- Tests: Add sourcing outcome cases to existing growth/PostHog tests. Exercise multiple contacts,
  two needs for one account, two buyers/one vehicle, failed send, absent exposure, duplicate
  callback, late event, exact window boundary, withdrawn need, missing effort, and analytics outage.
- Verification: Hand-calculated synthetic cohort totals match local reports and scrubbed exported
  events, with ordinary-outreach and sourcing experiments never mixed.

### U8. Prove the complete workflow and its limits

- Planned ticket: 020, verify demand-led sourcing (not filed). Depends on U2-U7.
  Requirements: R1-R12.
- Files: sourcing HTTP/browser tests, `fixtures/` synthetic cases, catalog stories,
  `docs/evaluation.md`, `docs/contracts.md`, and development verification documentation.
- Approach: Test-first regressions per unit, then a connected replay on the integrated runtime.
  Include one successful path plus a hard mismatch, unknown evidence, seller refusal, source
  withdrawal, unauthorized actor, and duplicate replay. Compare manual/assisted task handling.
- Tests: Extend existing Node test discovery rather than adding a framework. Exercise both the
  real account UI and shared authorized operations; run the project verification skill.
- Verification: Preserve executed results, inspected desktop/narrow screenshots, interaction clip,
  raw simulated effort observations, and explicit limitations. No revenue or production-scale
  claim.

---

## Verification Contract

Use disposable `*_test` databases and controlled identity/mail/model providers. Do not use hosted
production credentials or charge providers to complete a fixture. Follow `docs/development.md`.

- Run `npm run db:check` and exercise forward migrations from the reconciled baseline.
- Run `npm run build` before the full gate, with the required disposable database and HTTP setup.
- Run `npm run check` with zero skipped required suites, not only typechecking.
- Run `npm run test:cloudflare`, `npm run cloudflare:build`, and `npm run website:build` for changed
  worker paths and the final integrated head.
- Use `.agents/skills/verifying-signal-desk/SKILL.md` for real browser interaction and evidence.
  Inspect every affected non-default state and record keyboard/pointer behavior.
- Validate metric totals against literal fixture expectations and record actual source versions.
  Simulated outcome comparisons verify counting and workflow, not causal business value.

## Definition of Done

All units' acceptance checks pass against the same integrated code. A specialist can retain an unmet
need, investigate a possible seller, review fit, and prepare a safe buyer handoff. Changed sources
and revoked permissions invalidate stale actions. Replay neither duplicates work nor leaks records.
The report distinguishes qualified opportunities, correct rejections, no progress, missing data,
and actual observed effort. Abandoned experimental code and duplicated ownership paths are removed.

No prerequisite is described as delivered until its exact handoff is verified. No live pilot,
customer message, shared migration, push, or deployment is implied by completing this plan.

[conversation]: https://ampcode.com/threads/T-01a1526c-4ec1-72dd-a421-067824f378d7
[baseline]:
  https://github.com/mite404/garage-protoype/commit/e4dc0d78c4dca6fefba4afc032443cf3b35289ad
[growth]: https://ampcode.com/threads/T-01a15255-f788-734b-b7c3-d318118d72e4
[analytics]: https://ampcode.com/threads/T-01a1527a-689d-76f9-8a49-a4cd08733d08
[implementation]: https://ampcode.com/threads/T-01a15294-c894-742b-802b-40ed16c9efb9
