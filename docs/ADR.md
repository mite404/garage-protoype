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
- ADR-013: Reserve shared user and installation budgets per durable numbered attempt because
  concurrent clients, retries, and uncertain provider outcomes must not bypass spending caps.
- ADR-014: Append source claims and human reviews separately with fenced import commits because
  retries must preserve provenance and corrections without publishing obsolete evidence.
- ADR-015: Restrict inline chat output to authored reference-based cards because presentation
  validation must not replace server-owned authorization, evidence checks, or spending admission.
- ADR-016: Use scoped application tokens and a local stdio MCP adapter over shared HTTPS operations
  because terminal access must preserve server authorization, budgets, and human review.
- ADR-017: Use shadcn Base UI components and Storybook for the shared Dispatch design language
  because one browser-reviewable catalog keeps the prototype's states and production UI aligned.
- ADR-018: Adapt the Better-T-Stack Turborepo workspace layout with separate primitives, authored
  catalog, and React-free contracts because web, Storybook, and tools need explicit shared
  boundaries.
- ADR-019: Adapt Yaklabs' semantic prose and card reading hierarchy because explicit emphasis and
  separated actions improve scanning without changing source evidence or agent permissions.
- ADR-020: Trial Flue on [one streamed specialist conversation][flue-trial] before deciding adoption
  because reconnect and crash recovery must preserve sales, evidence, and spending controls.
- ADR-021: Use Drizzle ORM with the existing Zod contracts and ordered SQL migration history because
  typed queries must preserve runtime validation, applied history, and PostgreSQL transaction locks.
- ADR-022: Disable automatic model retries, provider fallback, and compaction in the Flue trial
  because an ambiguous provider outcome must retain its reservation rather than trigger more
  spending.
- ADR-023: Check session revocation through a private, runtime-only PostgreSQL predicate because
  hosted Supabase does not permit operators to grant custom roles usage of its managed Auth schema.
- ADR-024: Make the municipality profile the primary workspace with a persistent pop-up sale
  assistant because specialists need deal conditions and organization activity in context, not an
  evidence workbench presented as chat.
- ADR-025: Keep Flue for the bounded [specialist conversation][flue-trial], not as a full runtime
  migration, because the trial streamed real tool output and recovered turns while preserving
  sales, evidence, and spending controls.
- ADR-026: Run every deployed process in `us-west-2`, with Vercel functions in `pdx1`, beside the
  Supabase database because turns make hundreds of sequential queries and cross-region round trips
  dominate their latency.
- ADR-027: Generate and apply migrations with Drizzle Kit from `db-schema.ts`, keeping functions,
  grants, and row security as custom SQL migrations in the same journal, because one schema
  definition should drive both typed queries and table changes.
- ADR-028: Derive claim offsets on the server from a verbatim excerpt that occurs once on its page,
  and drop unverifiable claims individually, because no evaluated model computed exact offsets
  while nearly all quoted excerpts were verbatim and unique.
- ADR-029: Use Jev only to suggest an evidence field for unmatched specialist questions, behind
  spending admission and specialist acceptance, because routing is a consequential human
  decision and a confident wrong suggestion must not misroute a deal.
- ADR-030: Run the specialist streaming owner as a Cloudflare Worker on the Workers Free plan, with
  one Flue Durable Object per conversation reaching PostgreSQL through uncached Hyperdrive, because
  it removes an always-on host while the same guarantee suite passes on Node and workerd.
- ADR-031: Serve the website as its own OpenNext Worker on Workers Paid, calling the owner Worker
  through a service binding, and run imports as a Queue consumer on the owner, because the Free
  plan's 10 ms CPU limit fails authenticated pages and the two Workers together exceed its 3 MiB.
- ADR-033: Make buyer-demand-led seller sourcing the connected growth workflow because confirmed
  unmet buyer requirements give prospect discovery a purpose beyond increasing lead volume.
- ADR-034: Support sourcing and deal progress with human-reviewed, evidence-backed fit decision
  packets because helping buyers proceed, investigate, or reject unsuitable vehicles matters more
  than producing faster answers or shifting work onto sellers.
- ADR-035: Use source-backed changes as triggers to reassess demand and possible seller availability
  within that workflow because timely evidence can justify a next action without treating a signal
  as verified intent, consent, or authority to send outreach.

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

[flue-trial]: plans/008-flue-specialist-trial.md
