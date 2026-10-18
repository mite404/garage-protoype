---
linear: ETH-81
github: 9
filed: 2026-10-17
---
# Municipality-first workspace and live blocker chat

## Status

- **Goal**: Give a specialist one municipality page and a contextual live agent conversation.
- **Initial priority**: P1
- **Effort**: Large
- **Risk**: HIGH
- **Category**: feature
- **Planned at**: commit `f61604a`, 2026-10-17

## Why this matters

- The evidence workbench reads like a scripted demonstration, not a conversation about a sale.
- Specialists need the department's deal, interest activity, and inventory visible while chatting.

## Current state

- ETH-80 provides real Flue execution, OpenRouter streaming, durable turns, and unsent drafts.
- Municipality profiles, ownership, interest metadata, and structured deal terms are missing.
- The approved Painter concept and ADR-024 define the replacement experience.

## Approach

- Persist a municipality profile linked to the existing buyer identity, vehicle ownership,
  interest metadata, and structured deal terms. Read them through Drizzle and Zod contracts.
- Reuse opportunity membership for authorization instead of adding another membership system.
- Replace the primary workbench experience with the approved municipality page and a minimizable
  contextual chat. Keep evidence review available as a secondary tool.
- Retain existing Flue submission, cancellation, recovery, spending, and card validation.
- Supply bounded prior conversation and current permitted deal context to follow-up turns.
  Historical assistant claims never become evidence or new tool authority.

## Scope

- In: Municipality identity, active purchase, conditions, favorites/contact metadata, own listings,
  empty states, responsive chat, database migration, synthetic seed, and browser verification.
- Out: Reading seller messages, real escrow, payments, commercial commitments, external delivery,
  new agent frameworks, and simulated network delays.

## Steps

- Verify and integrate the organization-only scaffold patch without losing ETH-80 work.
- Add persisted records, private RLS-protected schema changes, and validated read contracts.
- Seed an Austin Fire Department example with a contingent acquisition and interest metadata.
- Render the approved municipality layout and preserve authorized evidence links.
- Add accessible minimized/open chat, retained history, live text, stop, and failure states.
- Include current sale context and authorized prior turns in the bounded agent prompt.
- Exercise access denial, reload, follow-up, cancellation, and narrow-screen behavior.

## Test plan

- Test the municipality projection through its authorized public server operation, including an
  unassigned specialist and private message content as negative controls.
- Prove follow-up context stays within the same actor and opportunity and respects spending limits.
- Run repository checks and production builds with no skipped behavioral suites.
- Use the real browser and Flue owner to submit two contextual turns, reload, minimize/reopen,
  and inspect desktop/mobile screenshots and a pointer interaction recording.

## Done when

* The page shows one department, an explicit contingent amount and conditions, interest metadata,
  and owned listings or an honest empty state.
* Chat produces real streamed responses about that sale and retains the conversation after reload.
* No message bodies, unauthorized records, unsupported evidence, or external effects are exposed.
* Checks and browser evidence are recorded with real versus synthetic behavior labeled.

## Notes

- Synthetic municipality and vehicle data are not real municipal activity or escrow.
- Live schema writes need explicit authorization; local migration verification does not deploy them.
- Publication was authorized separately; the work shipped to `main` on October 18, 2026.

## Verification receipt, 2026-10-17

- Integrated the organization-only export after checking all 33 affected paths against its manifest.
- `npm run build` built both Next and Storybook successfully.
- `CI=true TEST_DATABASE_URL=<disposable> TEST_APP_URL=<local-app> npm run check` passed 101 tests
  with zero failures or skips, all five workspace type checks, formatting, lint, and docs checks.
  Fallow exited successfully with warnings, including the existing test-database complexity finding.
- All ten municipality workspace/chat Storybook plays reached `finished` in Chromium. The app
  imports those same catalog components rather than maintaining a second presentation.
- Real browser turns used Flue, OpenRouter Kimi K3, and disposable local PostgreSQL. The agent
  retained the $84,000/pump-test context after reload, and two tool loops persisted unsent seller
  drafts and displayed their server-validated cards. No external message delivery exists.
- An earlier real turn printed tool-like prose without invoking a tool. Logging confirmed the
  provider received both tools; no text was executed as a tool call. The instruction now requires
  tool success before claiming a draft. Later runs invoked the real tool, but model prose still
  suggested approval for sending despite no such capability. Treat prose as a draft, not authority;
  this remains a model-quality limitation, not a verified sending workflow.
- Browser checks verified minimize/reopen, Escape focus return, retained history, and a scrollable
  chat with a visible composer. At a 390px Chromium viewport, document width remained 390px and
  composer bottom was 767px within an 844px viewport. This is not physical-phone verification.
- Review captures and the inspected pointer clip are in `.amp/in/artifacts/municipality/`.
- A read-only hosted catalog query found RLS enabled on all 38 tables across `public`,
  `signal_desk`, and `signal_desk_flue`. This verifies enablement, not per-user isolation by itself;
  server membership and revocation checks are exercised separately by the behavioral tests.
- After explicit approval, migration 009 and the idempotent synthetic municipality seed were applied
  to hosted Supabase. A read-only check confirmed two organizations, two Austin interests, the
  $84,000 contingent amount, and no tables without RLS in the application schemas.
- The approved tool contract exposes only `show_card` and `prepare_draft`. Provider declarations
  are filtered before inference; unexpected calls and runtime task/agent operations are denied.
  A regression test verifies an unapproved `task` call produces no cards, drafts, or follow-up call.
- Flue 2.3.0 has no standalone official web-fetch primitive. No shell or filesystem substitute is
  exposed; web research remains unavailable until a separately bounded tool is selected.
- Refreshed minimized/open chat styling follows the latest Painter reference and was verified in
  Storybook before application use. Current captures are in `.amp/in/artifacts/municipality-final/`.
- A hosted browser turn quoted the recorded pump-report condition and survived reload. At 390px,
  document width stayed 390px and the composer remained within the viewport. Escape restored
  launcher focus. These checks do not establish that all free-form model prose is factual.
- This receipt predates publication. The work later shipped to `main` at `9b71d7a`.
