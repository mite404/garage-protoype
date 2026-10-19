---
name: verifying-signal-desk
description: Verifies Signal Desk cards, conversation, chat and municipal workspaces, sales
  workflows and MCP tokens before PR handoff.
---

# Verify Signal Desk

Run the mechanical gate, then drive the affected features in [the map](features/README.md).
Storybook proves presentation with synthetic props, not permission checks or live model behavior.

## Gate

Use the pinned Node version from `.node-version`. In orbs, `.agents/setup` installs it and puts it
on `PATH` for login and `.bashrc` shells inside the repo. Confirm before anything else:

```sh
test "$(node --version)" = "v$(cat .node-version)"
```

If that fails in a shell started before setup, prepend
`$HOME/.local/share/signal-desk-node/node_modules/node/bin` to `PATH`. Read
`docs/development.md` for isolated test database setup before running:

```sh
npm run build
CI=true npm exec -- lefthook run pre-commit --force
```

Set `TEST_DATABASE_URL` to a disposable test database and `TEST_APP_URL` to the running production
app. Never point a seeded harness at that database. If the gate reports leftover fixtures, run
`npm run db:test:status`, stop only the workflow you started, then `npm run db:test:reset`.
See [disposable test databases](../../../docs/development.md#disposable-test-databases).
With `CI=true`, missing database or HTTP prerequisites fail instead of silently skipping.
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

The doctor response must list the stories, not just return an HTTP 200; the helper compares
that list with its own and stops on any difference. If the port belongs to another
run, use its service status and owner; never kill an unknown process. For app HTTP regressions,
the native test harness owns its controlled identity-provider and production-app instances.

## Drive and evidence

Load `using-agent-browser`, then run from the repo root:

```sh
node .agents/skills/verifying-signal-desk/scripts/verify-ui.mjs http://localhost:6106
```

The helper refuses an unpinned Node and fails when Storybook has a story its `stories` table does
not check, or the reverse. It opens every story, waits for its play function to finish, fails on
Storybook's error display, asserts visible copy and semantic typography, checks 390px overflow,
and captures one image per story under `.amp/in/artifacts/legibility/`.
Play functions are the interaction tests: they click, type and press keys through Testing Library,
so a new control needs a play function before this helper can prove it. Inspect the images by
reading them. Record real pointer input only for hover or motion that a play function cannot
assert.
Literal source excerpts, user messages and drafts retain their text; Markdown emphasis is reserved
for authored response and next-action prose. Verify that unsafe links and HTML remain inert.

## Cleanup

The helper closes only its named browser session, including on failure. Stop only the service
created for this run, then confirm evidence survives:

```sh
amp orb service stop verify-signal-desk
test -f .amp/in/artifacts/legibility/agent-catalog-assistance-cards.conflict.png
```

Maintain this map with `/maintain-verification-skill` when routes or cards change.
