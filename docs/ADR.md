# Architecture decision record

Each entry states intent and rationale in one sentence; accepted means a design decision, not
implemented functionality, and proposed entries remain open for review.

## Accepted

- ADR-001: Keep commercial commitments with humans because model output must not bind a buyer,
  seller, or Garage to an offer or delivery promise.
- ADR-002: Preserve source evidence alongside extracted claims because reviewed answers must remain
  traceable and conflicts must not disappear into a generated summary.
- ADR-003: Use actual photo coverage rather than generated vehicle views because invented details
  could misrepresent the asset being sold.
- ADR-012: Verify invited Supabase sessions against current private application permissions and
  session records because token metadata can outlive role changes, revocation, and sign-out.

## Proposed

- ADR-004: Separate vehicles from buyer opportunities because shared specifications must not mix
  with private negotiations or buyer-specific blockers.
- ADR-005: Enforce visibility through server-side ownership and audience rules because model-based
  classification cannot safely authorize disclosure.
- ADR-006: Filter evidence before model calls because internal notes and other buyers' information
  should never enter a buyer-facing model's context.
- ADR-007: Use Jev, an LLM or vision model, and a specialist only where needed because bounded
  classification, extraction, and consequential judgment require different capabilities.
- ADR-008: Persist blockers and authorized resolutions because work must resume without losing
  corrections, duplicating tasks, or bypassing evidence and permission checks.
- ADR-009: Use one Next.js application, PostgreSQL, private file storage, and one durable worker
  because the slice needs persistent asynchronous processing without distributed service overhead.
- ADR-010: Retrieve evidence by vehicle and opportunity rather than vector search because the
  bounded source packet already has known record ownership.
- ADR-011: Keep external delivery simulated and labeled because the interview demo must not contact
  real customers or create commercial obligations.
