## Ethan's agent instructions

These are common instructions for Ethan's agents across all scenarios.

## Project context

- Signal Desk is an independent interview prototype that helps Garage specialists resolve blockers
  to an existing vehicle sale; seller acquisition is secondary.
- Before implementing, read the [product plan][plan] for scope and acceptance criteria and the
  [viability decisions](docs/viability-decisions.md) for workflow, AI, privacy, and human review.
- Before architectural changes, read [ADR.md](docs/ADR.md); proposed entries are not approved
  commitments, and newly agreed decisions get one sentence stating intent and why.
- Keep detailed rules in their owning documents and link to them rather than duplicating them here.
- Use synthetic or permissioned material, label simulated behavior, and keep external messages,
  payments, and commercial commitments disabled in the prototype.
- Demonstrate growth and design engineering through one connected specialist-to-buyer workflow,
  not a marketplace clone; the three-day target limits breadth, not correctness.

[plan]: docs/plans/2026-10-15-1440-feat-signal-desk-plan.md

## What you need from me

- End every turn where you're blocked on me, or where the next step needs me, with a short
  **What I need from you** section. Use a numbered list with one concrete action per item: exactly
  what to do, where (which site, app, file, or person), and what to send back. For example:
  "Log into CommBank NetBank and export Jan to Jun 2026 as CSV, then drop it in `inbox/`", not
  "I need the bank data".
- If there are several actions, put the quickest or most blocking one first, and say what you'll
  get on with in the meantime.
- If you don't need anything from me, say "Nothing needed from you right now" so I don't have
  to ask.
- Never bury a request for me in the middle of a long update.

## General Guidelines

- Never use the em dash "--". Use plain dash "-" instead.
- Never manually modify changelog.md files or any files that are marked as auto-generated.
- When writing or editing Markdown files, keep every physical line at or under 100 columns, wrapping
  longer lines at word boundaries.
  `npm run check:docs` enforces this without rewriting prose, code fences, tables, or headings.
- Before committing, run `npm run check`. Lefthook runs the same gate automatically.
  Fallow checks changed-code structure; types and behavioral tests remain separate checks.
  See [development checks](docs/development.md) for setup, CI, and test prerequisites.
- Before PR handoff, use the [verification skill](.agents/skills/verifying-signal-desk/SKILL.md).
  Merge only after the build and full gate pass for the exact head commit, without skipped suites.
- When making technical decisions, do not give much weight to development cost.
  Instead prefer quality, simplicity, robustness, scalability, and long-term maintainability.
  "Development cost" here means a human-scale effort estimate.
  Do not let reasoning like "a human would spend two days on this, so patch it" justify a flimsier
  choice, because an agent writes and revises code far faster than that estimate assumes.
  Effort is cheap; correctness and longevity are not.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned
  with how the end user uses the product.
  This makes sure you find the real problem so your fix will actually solve it.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel
  perfection.
  Fix small visual issues encountered in the affected workflow, even if unrelated to the current
  change; flag broader work instead of silently expanding the slice.
- Apply the same high standard to engineering excellence: lint, test failures, and test flakiness.
  Fix small issues encountered in the affected workflow, even if unrelated to the current change;
  report broader failures and their impact rather than hiding them or silently expanding scope.
- Always opt for writing files in the same way: imports, variable declarations, prep data to work
  with, helper fns / pure fns, the main orchestration at the bottom.
  Work leafs to root and follow the functional programming principles from Grokking Simplicity:
  data, calculations, actions.
- Public/exported functions and interface members get JSDoc (`/** */`) so editor
  tool tips carry the contract.
  Include `@throws` wherever the function throws, and `@param`/`@returns` only where they say
  something the type does not.
  Do not JSDoc private helpers or pure data-shape types - leave those as `//` comments; restating a
  type in JSDoc just invites drift.
- Annotate Data Flow where appropriate - add a quick comment on each line showing
  what type goes in and what comes out.

```typescript
async () => {
    const raw = await getVoicesFromFirebase();   // → Record<string, unknown>[]
    return raw.map(item => Voice.fromJSON(item)); // → Voice[]
}
```

---

## Commits

Messages follow [the seven rules](https://cbea.ms/git-commit/), with one deliberate deviation
noted below.

**Scope.** Atomic. Each commit tells one part of the story of building a feature or fixing a bug.
One commit with hundreds or thousands of changed lines is hard for anyone to track. If the subject
line will not fit in 50 characters, that is usually the commit doing two things - split it.

**Subject line**

- Conventional Commits prefix: `feat:` `fix:` `refactor:` `test:` `docs:` `style:` `chore:`.
- Imperative mood. The subject must complete the sentence "If applied, this commit will \_\_\_".
  Write `scope order lookups by customer`, not `scoped`, `scopes`, or `order lookup scoping`.
- 50 characters including the prefix. Never past 72.
- No trailing period.
- Lowercase after the prefix. This is the deviation from rule 3 (capitalize the subject); the
  prefix already marks where the subject starts, and this repo's history is lowercase.

**Body**

- Blank line after the subject, always. Git tooling treats the first line as the subject and
  misbehaves without the separator.
- Wrap at 72 columns. This is not the 100-column markdown rule above: a commit message is not a
  markdown file, and 72 leaves room for the four-space indent `git log` adds.
- One `-` bullet per change. Reach for a prose paragraph only when a decision needs a
  because-clause that no bullet can hold.
- Say what and why. Never how - the diff already shows how.
- Skip the body entirely when the subject fully covers the change.

---

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
