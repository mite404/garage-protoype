---
title: Garage Signal Desk - Plan
type: feat
date: 2026-10-15
topic: signal-desk
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Garage Signal Desk - Plan

The October 19 [authorized NY growth-loop expansion](2026-10-19-ny-growth-loop.md) supersedes
this plan's conversion-only exclusions for U1-U7. This document retains the historical slice.

## Goal Capsule

- Objective: Help a Garage specialist move an interested buyer toward a human-reviewed offer by
  resolving missing vehicle information and identifying the next action.
- Product authority: Ethan selected conversion over seller acquisition after considering both.
  The prototype also demonstrates design engineering within the same workflow.
- Constraints: A three-day interview slice, limited to fire engines and pumpers. This is an
  independent prototype, not a production integration or a promise of sales results.
- Open blockers: No blocker to a synthetic-data prototype. Real customer data, external messaging,
  and production integration require permission and further discovery.

## Product Contract

### Summary

Signal Desk gives a Garage specialist an evidence review and deal-progress workspace. A connected
buyer-facing vehicle view shows approved facts and real photo coverage. A bounded assistant answers
supported questions and routes offers or unknowns to a person.

### Problem frame and business evidence

Garage's Growth Engineer posting explicitly covers fragmented data, sales tools, lead routing,
outbound workflows, and background agents. Full stack describes technical breadth; growth describes
the business outcome. The two labels are compatible.

Garage's seller page offers both self-service listings and a full-service specialist. Its stated
service includes pricing help, listing creation, buyer vetting, and coordination of payment and
freight.
Its account executive posting describes sourcing, discovery, closing, and new customer acquisition.
An open marketplace can therefore coexist with a staffed sales operation.

Section 8(a) of the public terms, effective June 29, 2025 and checked October 15, 2026, specifies a
platform fee of 10% of the displayed listing price for transactions through the service, unless
Garage and the seller agree otherwise in writing. Section 8(b) allows additional disclosed fees.
The seller page currently advertises no upfront cost. These sources support a transaction-service
model, not a claim that sales primarily sells paid access. They do not establish every commercial
agreement, revenue source, or salesperson's exact responsibility.

Ethan's working hypothesis is that removing obstacles to an existing sale is a stronger interview
story than replenishing listings. Low purchase frequency for an individual department does not
establish low transaction volume for the nationwide marketplace. Garage's actual conversion
bottleneck and internal tooling remain unknown.

### Actors and stakeholder buy-in

- A1. Garage sales specialist: proposed primary operator who reviews evidence and follows up.
- A2. Vehicle seller: supplies missing material and retains authority over commercial decisions.
- A3. Buyer: reviews approved information and asks questions or expresses an offer.
- A4. Sales or growth leader: proposed business sponsor who validates time saved and deal progress.
- A5. CTO or engineering hiring manager: evaluates implementation quality, AI reliability, and fit.

These are prototype roles, not verified internal reporting lines. Win operator buy-in with a useful
workflow, business buy-in with a plausible measurable outcome, and technical buy-in with working
software and honest evaluation. A product or design reviewer is an additional audience for the
customer-facing view, not a separate product owner invented for the demo.

### Key decisions

- **Conversion first.** Governs R1 and R7. Prioritize an active buyer over finding the next seller
  (session-settled: user-directed - chosen over seller acquisition: making the sale comes first).
- **Actual photo coverage, not generated views.** Governs R4
  (session-settled: user-approved - chosen over synthetic walkarounds: reveal missing evidence).
- **Qualified human handoff.** Governs R6 and R7
  (session-settled: user-approved - chosen over autonomous negotiation: preserve seller authority).
- **Design within the slice.** Governs R9. Ethan requested a redesigned experience that demonstrates
  design engineering alongside growth engineering, rather than a separate site-wide redesign.
- **Claims before conclusions.** Governs R2 and R3. Preserve source assertions so corrections and
  conflicts remain explainable. This is a proposed engineering approach, not a verified Garage need.

### Requirements

**Evidence and listing readiness**

- R1. A specialist can open an existing vehicle opportunity and see its buyer questions, unresolved
  blockers, assigned operator, and next action.
- R2. Import permissioned text-based PDFs, seller notes, and photos into a persisted source packet;
  populated specifications retain source references and distinguish seller claims from documents.
- R3. Conflicting or absent facts remain visible for human review, and reimporting an unchanged
  packet neither duplicates the opportunity nor silently overwrites a reviewed decision.
- R4. Classify actual photos into front, rear, driver side, passenger side, cab, pump panel,
  odometer, identification plate, or unknown, and draft requests for missing or unreadable views.
- R5. The specialist can correct photo labels and mark a view unreadable; coverage describes the
  supplied evidence, never the vehicle's mechanical safety or an inspection result.

**Buyer assistance and deal progress**

- R6. The buyer assistant answers supported factual questions with citations to approved evidence;
  unsupported or conflicting answers become a human-review item rather than a guessed answer.
- R7. Explicit offers produce a handoff containing amount, stated timing, conditions, unanswered
  questions, and an assigned operator; it cannot accept, counteroffer, or promise delivery.
- R8. Follow-up and missing-evidence requests remain reviewable drafts inside the prototype, with
  proposed recipients shown and no external email, SMS, bid, or payment submission.
  When a buyer question needs seller evidence, retain the original question, deal blocker, assigned
  specialist, and seller-directed request together. A permissioned seller response re-enters
  evidence review before drafting a buyer reply; it never becomes an automatically verified answer.

**Actionable data classification**

- R12. Classify permissioned source records and buyer messages into evidence-backed sales actions,
  not just vehicle tags. Distinguish a supported question, missing or conflicting evidence, an
  explicit conditional offer, and material needing human review. Retain the original input and
  classification basis, allow specialist correction, and link the result to the existing
  opportunity, blocker, assignee, and next action. Ambiguous intent remains human review.

**Experience and execution**

- R9. Provide an internal specialist view and a connected buyer-facing vehicle view using Garage's
  observed visual language, independent-prototype labeling, and no private notes in buyer output.
- R10. Background imports expose queued, processing, ready, and failed states with a retry action;
  users can reload the page without losing reviewed records or outstanding work.
- R11. Record model version, processing duration, usage, and review outcomes for evaluation without
  exposing secrets or private buyer information in the demo.
- R13. Stream specialist assistant responses during generation from the first live-model
  implementation. Show incremental prose and validated cards without waiting for the full response
  or refreshing the page. Follow the
  [streaming boundaries](../implementation-architecture.md#streaming-response-boundaries).

### Key flows

- F1. Specialist imports a packet, reviews extracted facts, resolves a conflict, and approves the
  buyer-visible record. Covers R2, R3, R9, and R10.
- F2. Photo review finds a missing or unreadable view. The specialist corrects labels if needed and
  reviews a targeted request to the seller. Covers R4, R5, and R8.
- F3. Buyer asks a factual question. The assistant answers with approved evidence or creates a
  review item. Covers R1, R6, and R9.
- F4. Buyer expresses a conditional offer. The specialist receives the structured handoff and a
  draft follow-up without a commercial commitment. Covers R1, R7, and R8.
- F5. Classify a messy source packet and buyer inquiry, identify the evidence blocking the deal,
  and route an unsent request to the seller through the specialist. Import a permissioned seller
  response, review it, and prepare a cited buyer follow-up. Covers R2, R3, R6, R8, and R12.

```diagram
┌───────────────────┐     ┌───────────────────┐     ┌────────────────────┐
│ Seller material   │────▶│ Specialist review │────▶│ Buyer vehicle view │
│ Photos and text   │     │ Facts and gaps    │     │ Approved evidence  │
└───────────────────┘     └───────────────────┘     └─────────┬──────────┘
                                   ▲                         │
                                   │                         ▼
                         ┌───────────────────┐     ┌────────────────────┐
                         │ Qualified handoff │◀────│ Question or offer  │
                         │ Human next action │     │ No auto-negotiation│
                         └───────────────────┘     └────────────────────┘
```

The internal view should make blockers and next actions easy to find. The buyer view should make
vehicle evidence easy to inspect. Exact layout and interaction design remain open for visual
exploration; this plan does not prescribe a dashboard template.

### Acceptance examples

- AE1. A brochure says 750 gallons and seller notes say 500 gallons. Both sources remain visible,
  and the assistant cannot select a value until review resolves it. Covers R3 and R6.
- AE2. The seller says service records are available, but none are attached. The interface says
  seller-reported availability, not document verified. Covers R2 and R6.
- AE3. Exterior photos exist, but the odometer photo is unreadable. The request asks for a readable
  odometer photo rather than declaring coverage complete. Covers R4 and R5.
- AE4. A buyer offers $165,000 subject to reviewing a pump-test report and needs delivery before
  December. The handoff retains all three conditions without accepting the offer. Covers R7.
- AE5. A repeated import does not create a second opportunity or reset the specialist's correction.
  A failed import shows its error and can be retried. Covers R3 and R10.
- AE6. An internal pricing note and a source document containing instructions to ignore safeguards
  do not leak into buyer answers or authorize actions. Covers R6, R8, and R9.
- AE7. A buyer asks for a pump-test result, but a seller note only says a report is available.
  Classification creates a missing-evidence blocker and an assigned seller-request draft, not a
  passing-test claim or a qualified offer. Importing a permissioned report preserves the question
  and blocker; only reviewed, shareable findings support the buyer follow-up. Covers R6, R8, R12.
- AE8. A permissioned packet contains a specification, an internal note, and an ambiguous inquiry.
  Classification preserves their sources and separates evidence, private context, and human-review
  work. A specialist can correct the routing without changing original text. An explicit offer
  follows AE4 instead; neither case invents contacts or creates duplicate opportunities. Covers R12.
- AE9. Hold a controlled provider stream open after emitting text and a complete valid card. Both
  appear in the specialist dashboard before generation finishes. Split Markdown and tool arguments
  across chunks; incomplete or invalid cards never appear. Interrupt the stream and verify partial
  output remains labeled interrupted, not completed. Reconnecting does not start another paid
  request. Controlled streams test behavior, not live provider performance. Covers R6, R11, and R13.

### Model responsibilities and technical basis

Garage's public engineering postings name React, TypeScript, Node.js, Next.js, Express, PostgreSQL,
Python, and Tailwind across roles. This supports a proposed Next.js, React, TypeScript, Tailwind,
and PostgreSQL implementation, not an assertion about its exact production architecture.

Use a generative extraction model for arbitrary values and a vision-capable model for photos.
Use ordinary code for units, numeric comparisons, record identity checks, and action permissions.
Jev is a candidate for text classification and routing, not a requirement to use AI for every field.
Its current documented question types are Choice, Score, and Noul, and its input is text. It cannot
directly inspect photos or generate buyer replies. A probability is not proof of a vehicle fact.

For the specification table, assign the prototype listing ID in code. Extract exact year, mileage,
weight, capacities, and manufacturer names with evidence. Distinguish chassis manufacturer from body
builder. Classify categorical fields only where supported. Never infer condition or issue-free
operation from photographs. A pump-test document's existence does not establish a passing result.

Start with one application and one background worker. Separate Express and Python services, a vector
database, and a multi-agent framework are not justified by the proposed slice. Model and hosting
providers, dependency versions, and durable job execution are deferred implementation choices.

The observed site uses Inter, white surfaces, warm gray borders, orange primary actions, and modest
corner rounding. Use these as visual references while creating original components and layouts.

### Three-day delivery proposal

1. Day 1: Persist one vehicle source packet and render source-backed specifications. Complete the
   import-to-review path and source classification before adding secondary screens.
2. Day 2: Add photo coverage, correction, seller-request drafts tied to buyer blockers, and the
   buyer-facing record.
3. Day 3: Add cited Q&A, inquiry classification, and qualified handoff. Exercise the seller-response
   loop, then evaluate, polish, prepare deployment, and rehearse. Actual deployment needs approval.

Implementation ownership stays in the existing feature tickets rather than a separate AI project:

- [003: Evidence review](003-evidence-review.md) owns source classification and reviewed responses.
- [005: Buyer assistance](005-buyer-handoff.md) owns Q&A, routing, seller handoff drafts, and R13's
  streaming implementation.
- [007: Evaluation](007-evaluate-and-polish.md) verifies classification, the handoff loop, and AE9's
  streaming and interruption behavior.

Classification is required; Jev is not. Reuse the planned extraction and answer pipeline plus
ordinary code for explicit structured inputs. Resolve labels and persisted result schemas against
the [HTTP contract reference](../contracts.md) before implementation; do not create a second agent.

Keep initial extraction to year, manufacturer, model, mileage, pump capacity, tank capacity, fuel,
and transmission. Additional table fields may remain explicitly unknown. Use one complete primary
demo and a small set of contrasting cases, not an entire marketplace clone.

### Success criteria

Demonstrate that a specialist can identify a blocker, inspect its source, request the missing
evidence, and receive a useful buyer handoff. The prototype cannot prove increased sales revenue.

Evaluate on approximately 15 to 20 labeled packets or conversations, including held-out examples.
Report extraction mistakes, unsupported answers, false photo-coverage claims, duplicate behavior,
latency, and actual model cost. Compare the Jev-assisted path with a single-model baseline before
claiming an efficiency benefit. Preserve a clearly labeled saved run for an API outage.

Business metrics for a later pilot include time to resolve buyer questions, unanswered-question
rate, specialist time per opportunity, qualified inquiry-to-offer conversion, and eventual closes.
These require real usage and a baseline; they are not fabricated demo metrics.

### Scope boundaries

Exclude automated negotiation, real payments, external messages, legal or mechanical assurances,
generated vehicle views, general crawling, CRM integrations, and a site-wide redesign.

Data classification uses synthetic or permissioned exports, including lawfully obtained scraped
records if supplied with permission. Building a scraper, acquiring contact lists, discovering new
prospects, and sending outreach remain out of scope. This slice advances an existing inquiry; it
does not claim to demonstrate pipeline acquisition merely because it classifies records.

Use synthetic or permissioned source packets and licensed photos. Garage's terms prohibit automated
scraping and restrict copying and derivative uses. The prototype must not ingest Garage's live
inventory or republish its photos without permission. Public research does not grant asset rights.

<!-- ce-section: work-relationships -->
### How this work fits together

This plan owns conversion assistance for an existing opportunity. The original Signal Desk proposal
also included replacement-signal discovery; that remains context, not an active requirement.

- Seller discovery can reuse source extraction later but does not block this slice.
- Buyer prospecting can supply new opportunities later; this slice begins with an existing inquiry.
- External sequencing depends on permissions, contact policy, and delivery integrations.
- A broader marketplace redesign can proceed independently; the selected slice shows design craft
  through evidence review, photo coverage, and buyer interaction.

This covers the growth role's messy-data processing, internal tooling, AI signals, lead routing,
deal support, and background processing. It does not demonstrate full outbound acquisition or
industry-wide prospect discovery. Do not claim that it fulfills every responsibility in the JD.

### Outstanding questions

- Deferred to Planning: Choose providers and model versions after verifying access and testing a
  representative packet. No provider purchase is authorized by this plan.
- Deferred to Planning: Choose a deployable worker and persistence setup that satisfies R10.
- Deferred to Planning: Explore both interfaces without broadening R9 into a site clone.
- Deferred to Planning: Ask Garage which stage currently loses the most deals and who owns it. This
  informs a pilot but does not block the explicitly hypothetical interview demo.

### Sources

Public materials checked October 15, 2026. Job advertisements indicate skills and responsibilities,
not a complete map of Garage's internal systems.

- [Growth Engineer role][growth]
- [Account Executive role][sales]
- [Seller service][sell]
- [Terms of service, especially sections 8 and 10][terms]
- [Software Engineer role][engineering]
- [Design Engineer role][design]
- [Jev question types][jev-types]
- [Jev models and input limits][jev-models]

[growth]: https://www.ycombinator.com/companies/garage-2/jobs/e2vOJM9-software-engineer-growth
[sales]: https://www.ycombinator.com/companies/garage-2/jobs/LOjl7pS-account-executive
[sell]: https://www.shopgarage.com/sell
[terms]: https://www.shopgarage.com/policies/terms-of-service
[engineering]: https://www.ycombinator.com/companies/garage-2/jobs/8YNROco-software-engineer
[design]: https://www.ycombinator.com/companies/garage-2/jobs/hzVJNXq-founding-design-engineer
[jev-types]: https://docs.typesafe.ai/primitives
[jev-models]: https://docs.typesafe.ai/models
