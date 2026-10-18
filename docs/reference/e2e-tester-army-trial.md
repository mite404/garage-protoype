# e2e.tester.army trial findings

Status: parked on branch `chore/e2e-tester-army`, not merged. Recorded October 18, 2026.
Resume this when Signal Desk needs AI-driven exploratory runs or an agent that drives the real app
through MCP. For exact, repeatable browser checks, plain Playwright is enough.

## What e2e adds over Playwright

e2e 0.21.2 (Apache-2.0, pre-1.0) runs on Playwright. Locator steps behave like Playwright's.
The additions are model-driven:

- `agent.act` runs a plain-language step. It may use up to 25 model calls. A passing step is
  cached and replayed later without model calls.
- `agent.assert` asks a model to judge the page. It calls the model on every run, so its verdict
  can vary between runs.
- Exploratory runs and bug bashes let an agent explore the app and report problems.
- `e2e mcp` lets coding agents drive the app through the same runner.

Keep agent steps out of the merge gate. A model's judgment is not a stable pass condition.

## What is ready to reuse

- `apps/web/src/e2e-stack.ts` starts a fully synthetic stack. It resets a loopback database whose
  name must end in `_test`, seeds the Austin workspace, and serves a controlled identity provider
  and a gated synthetic model. It also starts the streaming owner and `next dev` on
  127.0.0.1:3406. Any browser runner can use it, including plain Playwright.
- `tests/specialist-chat.e2e.ts` covers the core flow. It signs in through the real form, opens the
  municipality page and sends a message. It sees the held partial reply, releases it, and checks
  the conversation again after a reload. It uses exact locators only, so it needs no model.
- Before the e2e packages were installed, the same flow passed by hand in a real browser
  against this stack.

## Setup fixes the trial needed

- `scripts/check-docs.mjs` skips the generated `.agents/skills/e2e/` skill. `e2e init`
  rewrites it, so rewrapping it by hand would not last.
- `e2e`, `@e2e-dev/web` and `ai` are pinned exactly in `package.json` and the lockfile, so
  `npm ci` keeps working. Review the large lockfile diff before merging.
- `.fallowrc.json` declares the config and tests as entry points.
- `apps/web/next.config.ts` allows the 127.0.0.1 dev origin. Without it, `next dev` does not
  hydrate there.

## Open before resuming

- Choose the model for agent steps. Options in the guide are ChatGPT, GitHub Copilot, OpenCode
  Console or SuperGrok subscriptions (`npx e2e login <provider>`), Claude through an
  `ANTHROPIC_API_KEY`, an API key (Vercel AI Gateway, OpenRouter through
  `@openrouter/ai-sdk-provider`, or a direct provider), or a local model through
  `@ai-sdk/openai-compatible`. The recommendation was a separate OpenRouter key, so that test
  spending stays apart from the app's `OPENROUTER_API_KEY`.
- Run `npm ci`, install Chromium, and run `npm run test:e2e` until the drafted test passes.
- Agent steps send the redacted accessibility tree to the model provider, plus screenshots when a
  step asks for them. Use only the synthetic stack. Set `E2E_TELEMETRY_DISABLED=1` to disable
  anonymous telemetry.
