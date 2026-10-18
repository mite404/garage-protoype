---
linear: ETH-82
github: 11
filed: 2026-10-18
---
# Flag seller claims that conflict with manufacturer specs

## Status
- **Goal**: Help the Sales Specialist spot seller claims that disagree with the manufacturer's
  specification for the same build, before a buyer relies on them.
- **Initial priority**: P3
- **Effort**: Medium
- **Risk**: MEDIUM
- **Category**: feature
- **Planned at**: commit `495049d`, 2026-10-18

## Why this matters

A seller may state a fact the vehicle's build can't support, for example a 1,000-gallon tank on a
2014 Pierce Pumper normally built with 500 or 750. Today the specialist only sees the seller's own
documents, so a wrong claim can pass review and reach a buyer. A spec comparison turns that into
a visible question for the specialist.

## Current state

* Extracted seller claims are cited facts that a specialist reviews (ETH-75). Nothing compares
  them with an outside reference.
* Pierce's manuals and truck-specific parts catalogs on pierceparts.com sit behind dealer or
  customer accounts. On October 18, 2026, no public PDFs were found without signing in.
* Our rules require synthetic or permissioned material. No manufacturer documents are in the
  repo.

## Approach

* Store a manufacturer spec sheet as a separate source kind, "manufacturer reference", labeled
  as not being evidence about this vehicle. A specialist approves each reference before use.
* Match each reference to the exact make, model, year and build. Compare reviewed seller claims
  field by field, and show any conflict to the specialist as a question to resolve. A
  modification or a seller mistake are both possible, so the check never decides which is right.
* Rejected: treating the reference as evidence or answering from it. A manual describes the
  model in general, not this truck's condition or modifications.
* Rejected for now: open web search for manuals. Copyright and access terms are unclear, the
  match to the year and build is unreliable, and web text is a prompt-injection channel.
  Revisit only with permission or a data partnership.

## Scope

* In: the reference source kind, the approval step, field-level conflict flags in the
  specialist workspace, and synthetic or permissioned references only.
* Out: buyer-facing answers from references. Buyers see reviewed vehicle evidence only.
* Out: automated scraping of pierceparts.com or other gated portals, which needs permission.

## Steps

* Define the reference source kind and its label in the evidence contracts.
* Add specialist approval for each reference, with its make, model, year and build.
* Compare reviewed claims with the approved reference, and record the conflicts.
* Show the conflicts in the municipality workspace and the evidence view.

## Test plan

* A synthetic reference with a 750-gallon tank and a seller claim of 1,000 gallons produces one
  flagged conflict. A matching claim produces none.
* An unapproved reference never affects any view.
* Reference text containing injected instructions changes no tool call or answer.
* A buyer projection never contains reference content.

## Done when

* A specialist sees a flagged conflict, with both citations, for a mismatched synthetic claim.
* No reference reaches a buyer view or becomes vehicle evidence.

## Notes

* Risk: MEDIUM, because of a wrong year or build match, permission to use spec sheets, and
  prompt injection from reference text.
* Depends on the document worker's live extraction model (comparison in progress).
* Backlog; revisit later.
