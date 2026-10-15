---
linear: ETH-75
github: 3
filed: 2026-10-15
---
# Import source packets and resolve evidence conflicts

## Status
- **Goal**: Complete the persisted import-to-review workflow for one vehicle opportunity.
- **Initial priority**: P1
- **Effort**: Large
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

A specialist needs to see where vehicle facts came from and resolve contradictions before buyers
rely on an answer. A generated summary must not hide conflicting claims.

## Current state

No application or extraction exists. The architecture separates shared vehicle evidence from
private buyer opportunities and chooses one application with one durable worker.

## Approach

Persist original source assertions, then let specialists publish reviewed selections separately.
Use actual extraction for arbitrary uploaded text-based PDFs and notes. Queue work durably and
deduplicate unchanged sources by content hash. One mutable generated vehicle summary loses because
retries could erase corrections or provenance.

## Scope

* In: R1, R2, R3, R9, R10, and R11; F1; AE1, AE2, AE5, and AE6.
* In: R12 source classification and F5 seller-response review; AE7 and AE8.
* In: Initial specification fields, source inspection, conflict resolution, and approved excerpts.
* Out: Scanned-PDF OCR, marketplace crawling, vector search, and commercial assurances.

## Steps

* Depend on auth and inference admission in tickets 001 and 002.
* Persist sources, claims, reviewed decisions, opportunities, tasks, and leased jobs separately.
* Build the evidence workbench with buyer question, assignee, blocker, and next action in view.
* Implement R12 source classification: separate supported claims, conflicts, missing evidence,
  and private context; preserve input, classification basis, and specialist corrections.
* Link classification to the existing opportunity and next action, not just vehicle tags.
* Reuse import and review for permissioned seller responses linked to the originating buyer blocker.
* Show queued, processing, ready, and failed jobs with safe retry and restart recovery.
* Keep a synthetic saved run explicitly labeled and distinct from arbitrary upload processing.

## Test plan

* Import 750-gallon brochure and 500-gallon seller claims; preserve both until review.
* Report service records as seller-reported when no document is attached.
* Reimport identical files after correction and verify no duplicate opportunity or lost decision.
* Restart a worker during processing; reject a stale worker's result and recover the job.
* Verify private pricing notes and source instructions cannot change publication permissions.
* Run AE8: separate specifications, private notes, and ambiguous inquiries without inventing intent.
* Import an AE7 seller response; retain its blocker link and require review before buyer disclosure.

## Done when

* A specialist uploads, inspects, resolves, and approves source-backed facts on the running app.
* Reload and retries preserve reviewed decisions, pending work, and original assertions.
* New conflicting evidence cannot silently remain approved from an obsolete review.
* Source classifications retain evidence and corrections and drive a visible specialist next action.

## Notes

Risk: HIGH. UI uses the supplied Garage screenshots as visual references, not reusable inventory
assets. Verify desktop and narrow layouts. Live provider quality remains unverified until measured.
