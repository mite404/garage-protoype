---
linear: ETH-76
github: 4
filed: 2026-10-15
---
# Review actual photo coverage and draft evidence requests

## Status
- **Goal**: Expose missing or unreadable vehicle views and prepare targeted seller requests.
- **Initial priority**: P1
- **Effort**: Medium
- **Risk**: MEDIUM
- **Category**: feature
- **Planned at**: commit `43b394f`, 2026-10-15

## Why this matters

A blurry odometer photo does not answer a mileage question. Coverage must represent supplied
evidence rather than imply a complete inspection.

## Current state

The plan defines nine photo categories and specialist correction. There are no photos or vision
implementation. Upload and job contracts come from `docs/plans/003-evidence-review.md`.

## Approach

Use a vision-capable model to suggest a view label and readability for an actual uploaded photo.
Store human corrections separately from machine suggestions. Derive coverage from readable evidence
and draft a request for remaining gaps. Generated walkarounds lose because they invent evidence.

## Scope

* In: R4, R5, R8, R9, and R11; F2; AE3 and repeated-import correction preservation.
* In: Front, rear, both sides, cab, pump panel, odometer, identification plate, and unknown.
* Out: Mechanical inspection, inferred condition, generated vehicle images, and external delivery.

## Steps

* Depend on tickets 001 through 003 for permission, admission, uploads, and jobs.
* Present actual thumbnails with view labels, readability, and editable review controls.
* Keep unknown and unreadable views incomplete after processing and reimport.
* Generate editable unsent drafts with proposed recipient and specific missing evidence.

## Test plan

* Mark an odometer photo unreadable and verify the draft asks for a readable replacement.
* Correct a side-view label and verify coverage changes and survives reprocessing.
* Verify duplicate photos do not fill unrelated coverage categories.
* Verify unapproved photos and private file URLs are absent from buyer output.

## Done when

* The specialist can inspect, relabel, and mark each supplied photo unreadable.
* Coverage and drafts reflect the reviewed state without safety or inspection claims.
* No request can be sent externally from the prototype.

## Notes

Risk: MEDIUM. Use licensed or permissioned photos and record provenance. Include keyboard access,
reduced-motion behavior, and screenshots of incomplete and corrected coverage during verification.
