---
name: verifying-signal-desk
description: Verifies Signal Desk cards, conversation text and sales workflows before PR handoff.
---

# Verify Signal Desk

Run the mechanical gate, then drive the affected features in [the map](features/README.md).
Storybook proves presentation with synthetic props, not permission checks or live model behavior.

## Gate

Use the pinned Node version from `.node-version`; `.agents/setup` installs it in orbs.
Read `docs/development.md` for isolated test database setup before running:

```sh
npm run build
CI=true npm exec -- lefthook run pre-commit --force
```

Set `TEST_DATABASE_URL` to a disposable test database and `TEST_APP_URL` to the running production
app. With `CI=true`, missing database or HTTP prerequisites fail instead of silently skipping.
Use `--force` for manual verification so an unstaged worktree cannot produce a skipped hook.
The installed pre-commit hook runs `npm run check`. That command owns docs, Oxfmt, Oxlint,
TypeScript across workspaces, native tests and Fallow. CI runs the build and same check on PRs.
No extra formatter or linter is needed. Fallow uses the PR base in CI and `origin/main` locally;
set `FALLOW_AUDIT_BASE` when validating another explicit base. Keep thresholds unchanged.
Verify GitHub required-check enforcement separately; workflow existence does not prove protection.

## Launch and doctor

For browser-only catalog checks, start an isolated supervised Storybook instance from repo root:

```sh
amp orb service start verify-signal-desk --port 6106 --command \
  'npm exec -w @signal-desk/storybook -- storybook dev -p 6106 --host 0.0.0.0 --ci --no-open'
curl --fail --silent http://localhost:6106/index.json
```

The doctor response must contain `agent-catalog-assistance-cards--conflict` and
`conversation-reading--structured-response`, not just an HTTP 200. If the port belongs to another
run, use its service status and owner; never kill an unknown process. For app HTTP regressions,
the native test harness owns its controlled identity-provider and production-app instances.

## Drive and evidence

Load `using-agent-browser`, then run from the repo root:

```sh
node .agents/skills/verifying-signal-desk/scripts/verify-ui.mjs http://localhost:6106
```

The helper opens real catalog components, asserts rendered content and semantic typography, checks
390px overflow, and captures review images under `.amp/in/artifacts/legibility/`.
Inspect those images with `view_media`. Screenshots alone do not verify interactions; record real
pointer and keyboard input when changing controls, focus, hover, or motion.
Literal source excerpts, user messages and drafts retain their text; Markdown emphasis is reserved
for authored response and next-action prose. Verify that unsafe links and HTML remain inert.

## Cleanup

The helper closes only its named browser session, including on failure. Stop only the service
created for this run, then confirm evidence survives:

```sh
amp orb service stop verify-signal-desk
test -f .amp/in/artifacts/legibility/conflict.png
```

Maintain this map with `/maintain-verification-skill` when routes or cards change.
