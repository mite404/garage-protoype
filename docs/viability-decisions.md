# Seven decisions that make Signal Desk viable

This records the proposed design for the three-day slice, not implemented behavior.
The [product plan](plans/2026-10-15-1440-feat-signal-desk-plan.md) owns scope and acceptance
examples;
the [architecture decision record](ADR.md) distinguishes accepted decisions from proposals.

## 1. Define the exact moment we improve

Start with an interested buyer waiting on vehicle information. Help the Garage specialist identify
the blocker, resolve it, and prepare a supported answer or qualified offer handoff.

The demo ends before a binding agreement or payment. Missing evidence is our working hypothesis,
not a verified explanation for Garage's lost deals.

Question for Garage: What was a recent interested buyer waiting for, and who had to chase it?

## 2. Separate a vehicle from a deal

One vehicle can have several interested buyers, so shared vehicle facts and private negotiations
must not occupy the same record.

- Vehicle: specifications and approved photos shared across opportunities.
- Evidence: source documents, extracted claims, photo labels, and review decisions.
- Opportunity: one buyer's interest in one vehicle.
- Conversation: that buyer's questions, answers, and stated conditions.
- Task: an unresolved blocker, its owner, and the next action.

A financing delay belongs to a buyer's opportunity, not the vehicle. Another buyer must not see
that delay or the first buyer's offer.

## 3. Separate evidence quality from permission to share

Track what supports a claim separately from who may see it. A reviewed fact is not automatically
public, and a public seller statement is not automatically verified.

Use explicit permissions enforced by server code, not a model's judgment, to control disclosure.
The proposed audience meanings are:

- Private: accessible only to the information owner through ordinary application access.
- Shared with sales: accessible to the owner and authorized specialists on that opportunity.
- Public: explicitly approved for everyone viewing the listing.

Unknown visibility defaults to private. Sharing with sales does not authorize sharing with the
seller, another buyer, or the public. Owner identity and opportunity membership matter alongside
the audience label; a label alone is not an access-control system.

Jev may flag potentially sensitive material for review, but cannot grant access or widen visibility.
Filter permitted evidence before constructing a model request. The buyer-facing model never receives
internal notes or another buyer's information. Model-provider data handling needs its own policy.

Before implementation, confirm who can authorize a visibility change and which specialist roles
receive access; do not infer permission from a model score or a fact's approval state.

## 4. Give models narrow jobs and humans the consequential decisions

Use three kinds of judgment within permissions and workflow transitions enforced by code:

- Jev: bounded text classification, intent detection, and routing suggestions.
- LLM or vision model: document extraction, photo interpretation, and drafting supported answers.
- Human specialist: resolve conflicts, seek missing evidence, and review consequential handoffs.

These are available tools, not a mandatory three-stage chain for every step. A direct lookup or
numeric comparison needs neither model. Jev cannot inspect raw photos or generate a buyer reply.

At any step, missing evidence, conflicting facts, or a required approval can pause the affected work
and create a specialist task with the reason, relevant permitted evidence, and the action needed.
After an authorized resolution is recorded, rerun the blocked step against the updated evidence
without duplicating prior tasks or discarding reviewed corrections.

An API outage is a retryable technical failure, not a sales decision. Unsupported claims remain
unsupported until evidence changes, and a specialist cannot bypass permission rules by unblocking
a task. Offers, negotiation, and delivery commitments remain human decisions.

## 5. Use one application, one worker, and durable storage

Propose a Next.js application for both views and server endpoints, PostgreSQL for structured records
and job status, private file storage for evidence, and one worker for imports and photo processing.

Persist processing status so a browser refresh or worker restart does not erase work. Retries must
not create duplicate opportunities or follow-up tasks. Choose hosting that supports the worker;
a detached promise in a short-lived server request is not durable execution.

Retrieve approved evidence directly for the selected vehicle and opportunity. A vector database,
separate Express or Python services, and a multi-agent framework are unnecessary for this slice.

Before implementation, choose providers, versions, file limits, retry limits, and recovery rules.
Provider access and a representative extraction trial must precede promises about cost or speed.

## 6. Decide which parts are real in the demo

Make uploads, persistence, model calls, citations, corrections, photo coverage, task creation, and
human handoff real. Label seeded incoming conversations and simulated external delivery clearly.

Use synthetic documents and licensed or owner-provided photos. Do not scrape Garage's inventory or
republish its assets without permission. No real emails, bids, payments, or commercial commitments
leave the prototype.

Protect the internal view if deployed publicly, enforce permissions on server requests and file
access, and keep private information out of buyer responses, logs, and client payloads. Switching
between demo roles in the interface does not substitute for authentication or authorization.

Before implementation, choose the demo identities, access method, source packet, and hosting target.

## 7. Measure the workflow rather than inventing sales results

Check whether the specialist can find a blocker, inspect its evidence, correct it, and produce a
useful response or handoff. Include cases that can expose plausible mistakes:

- A missing answer creates a visible task instead of a fabricated answer.
- A citation supports the actual claim, not merely a related vehicle specification.
- An unreadable odometer photo remains incomplete coverage.
- A conditional offer retains its amount, timing, and contingencies.
- Repeated imports and retries do not duplicate records or erase corrections.
- Private notes and another buyer's information never enter buyer-visible output.

Use held-out examples and report errors, processing time, and model cost. Compare Jev-assisted
routing with a single-model baseline before claiming an efficiency gain. Keep a labeled saved run
for provider outages, without presenting it as live processing.

Sales conversion and time-to-close improvements need real usage and a baseline. The interview demo
can demonstrate correct behavior and measured workflow steps, not increased revenue.
