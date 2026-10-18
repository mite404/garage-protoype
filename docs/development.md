# Development checks

Use the Node version pinned in `.node-version` and `.nvmrc`, and npm.
`npm run dev` runs the web app and Storybook through Turbo; `npm run dev:web` selects only the app.
`npm run build` builds both surfaces sequentially to bound memory use in small orbs.
Run `npm run storybook` to review Dispatch components and synthetic assistance states at port
6006. Run `npm run build-storybook` to check the independent React-Vite catalog. It writes ignored
`storybook-static/`. The shared palette, display font, focus color, radii, and card review states
live in `packages/ui/src/theme.css`. The seven UI components in `packages/ui/src/components/ui/`
came from the official shadcn `base-nova` registry, configured in `packages/ui/components.json`.
The agent-selectable authored cards and their stories live in `packages/catalog/`; stock primitives
are not agent-selectable. Stories do not load server operations or send messages.

The Dispatch shell, chat and draft editor share Roboto/Space Grotesk typography, neutral surfaces,
outlined controls and orange light-theme or lime dark-theme actions. The app follows the system
color scheme; explicit theme attributes isolate Storybook's light and dark chat specimens.
It does not reuse Garage's logo, department badges, or artwork.
`packages/catalog/src/workspace-shell.tsx` is human-facing chrome, not part of the agent schema.
Storybook separates Primitives, Agent catalog, and Workspace so a visual export is not mistaken for
permission to invoke a component. The agent still requests only reference-based answer, review,
handoff, and draft cards; the server resolves facts and permissions before rendering.

Conversation typography adapts Yaklabs' Quiet prose (ADR-140): 15px/24px body, 16px paragraph gaps,
510px reading measure, bold authored findings, italic caveats, lists and inline code. Only authored
response and next-action text uses the restricted Markdown parser. User messages, original source
excerpts, offer conditions and draft bodies stay literal; HTML never executes and only HTTPS/mailto
links become anchors. No Yaklabs runtime or sharing capability is imported.
The [project verification skill](../.agents/skills/verifying-signal-desk/SKILL.md) owns browser
recipes and the feature map. Use it before handing off UI changes; it complements the gate below.

The monorepo layout was adapted from Better-T-Stack 3.44.1 with Turborepo.
The [archived generator metadata](reference/bts-3.44.1.jsonc) is unchanged historical provenance,
not current project configuration. Do not run the generator's `add`
command against it. To reproduce that original reference in `/tmp` using npm 11.16.0, run:

```sh
npm exec --yes --package npm@11.16.0 -- npm exec --yes --package \
  create-better-t-stack@3.44.1 -- create-better-t-stack signal-desk-bts-reference \
  --frontend next --backend none --runtime none --database none --orm none --api none \
  --auth none --payments none --addons turborepo --examples none --db-setup none \
  --web-deploy none --server-deploy none --package-manager npm --no-git --no-install
```

The reference supplied the `apps/*` and `packages/*` workspaces, Turbo task structure, and shared
TypeScript base. This repo keeps its existing Node 22, TypeScript 5.9, Next 16.4.1, React 19.3.1,
PostgreSQL, and Supabase integration. It does not use the template's varlock override, example
primitives, or extra dependencies. `apps/web` owns the existing Next routes, API, worker, and MCP.
`apps/storybook` hosts stories colocated in `packages/ui` and `packages/catalog`.
`packages/contracts` owns React-free evidence, photo, assistance, and token schemas and the
authoritative field labels. Server operations import these contracts directly; the catalog owns
product rendering, including cards, prose, and workspace chrome, not server schema re-exports.
Pure package tests live beside their implementation. `packages/config` only owns the TS base.
Root `db/` and operator `scripts/` stay together so migration paths and root CLI contracts remain
unchanged. Root `.env.local` is never copied or overwritten. Next loads it alongside app-local env;
the worker, MCP, and operator scripts load it from their own commands. Turbo passes runtime and test
environment variables through rather than excluding secrets via strict env filtering.
Run `npm ci` after checkout; its `prepare` step installs Lefthook's pre-commit
hook. Run `npm run build` before `npm run check`; the HTTP review test launches that production
build against a loopback-only controlled identity provider. Rebuild after application changes.
These commands do not deploy the app or spend inference tokens.

Fresh orbs run `.agents/setup` to install the pinned Node toolchain, locked dependencies, and hook.
The setup is safe to repeat. Fallow is a pinned development dependency, not a global installation.
Existing ticket orbs receive these files with their dependency snapshot and run `.agents/setup`.
Future orbs inherit this automatically only after the setup reaches the project's default branch.
No Claude, Codex, or Cursor MCP configuration is needed for Amp's CLI checks.

Orb setup and CI install `poppler-utils` for ETH-75's bounded text-PDF extraction. Other development
and deployment environments need `pdftotext` on PATH. This is not OCR support for scanned documents.

## Supabase developer access

The prototype project is `garage-prototype`, reference `iyjdwksmwccwslcioutd`.
`npm ci` installs the pinned Supabase CLI, including in fresh orbs through `.agents/setup`.
Run `npm exec -- supabase --version` to check it and `npm exec -- supabase --help` for commands.
CLI installation does not authenticate, link the checkout, or apply database migrations.

The root `.mcp.json` configures the hosted Supabase MCP server for clients that support that file.
Amp uses the equivalent project-scoped remote definition in its MCP settings, not `.mcp.json`.
Both connections restrict access to this project and use read-only database, documentation,
debugging, and development tools. Each person authenticates through their client's OAuth flow;
the shared configuration does not share their credentials. In Amp, connect Supabase in the
[MCP server settings](https://ampcode.com/settings/mcp-servers), then reload MCP tools in the
thread.
Other clients may require importing the URL from `.mcp.json` into their own settings.

CLI authentication is separate from MCP OAuth. For unattended CLI access, configure a project-scoped
`SUPABASE_ACCESS_TOKEN` through private agent secrets, never in tracked files or chat.
Do not grant write permissions merely to inspect the database. Installing these tools does not
authorize remote migrations, identity provisioning, or spending.

For ETH-80, use Drizzle for application database access and retain the existing Zod contracts in
`packages/contracts` for runtime validation. Drizzle's inferred row types do not replace Zod parsing
of untrusted input or stored JSON. Application reads and writes now use Drizzle's typed query
builders in `apps/web/src/server/db-schema.ts`. `pg` remains the driver and transaction connection;
PostgreSQL locks, session commands, DDL, and Flue's framework-owned storage still use SQL.
Preserve transaction, authorization, evidence, spending, and idempotency guarantees.

Migrations are Drizzle Kit's: `db/migrations/` with its journal and snapshots, configured by
`drizzle.config.ts`. To change a table, edit `db-schema.ts`, run `npm run db:generate`, review the
generated SQL, and add an applied-state probe for it in `test-database.ts`. Functions, grants,
row security, and data changes the schema cannot express go in `npm run db:generate -- --custom
--name <name>` migrations. `npm run db:check` validates the snapshot history. An operator applies
both kinds with `npm run db:migrate`. Never edit an applied migration, hand-edit `meta/`, or use
`drizzle-kit push` against the prototype. The first ten migrations are the earlier ordered SQL
files, unchanged; the runner adopts them on databases that recorded them under the old runner.

## Specialist streaming trial

Flue runtime, PostgreSQL adapter, and CLI are pinned to 2.3.0. The Node config was folded in from
`flue init --target node` without overwriting the existing Next application. Inspect the installed
version's documentation with `npm exec -- flue docs read guide/tools`.
`apps/web/src/agents/specialist.ts` defines the durable `SpecialistStream` agent. Its tools resolve
current evidence cards or prepare unsent drafts through existing sales operations. Flue requires
Valibot for tool schemas; Zod remains the authoritative application input and stored-JSON contract.

After an operator has approved and applied `npm run db:migrate`, run `npm run streaming` alongside
the Next app. Exactly one Node owner holds a PostgreSQL advisory lease.

Next.js keeps Supabase's transaction pooler, `aws-1-us-west-2.pooler.supabase.com:6543`, for its
short request queries. The streaming owner and the import worker are long-lived and hold session
state, so they use the session pooler: the same host on port 5432. Both refuse a port 6543
`DATABASE_URL` at startup. Do not use the direct `db.<ref>.supabase.co` host, which is IPv6-only
without Supabase's IPv4 add-on. Everything deployed runs in `us-west-2` (Oregon), next to the
database: the owner and the worker in AWS `us-west-2`, and Vercel functions in `pdx1` if Next.js is
deployed there. Each turn makes hundreds of sequential queries, and about 25 ms per query from
another region dominates turn latency.
The web process submits logical turns or observes their saved progress; viewer disconnects never
cancel execution. Cancellation is explicit. Flue tables live in the private `signal_desk_flue`
schema and are installed only by the operator migration command, not at application startup.

The only registered provider is the admitted OpenRouter `moonshotai/kimi-k3` adapter. Configure
server-only `OPENROUTER_API_KEY`; missing credentials stop before budget reservation. Operators
must separately provision the enabled model policy, installation and user budgets, membership,
and spending permission. No defaults grant spending. The existing integer micro-USD rate policy
must conservatively bound the provider's current pricing. Retries, fallback providers, and
compaction are disabled; every subsequent tool-loop request still needs spending admission.
Uncertain outcomes retain reservations until operator reconciliation.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are accepted aliases for
the existing unprefixed names. The unprefixed values take precedence. `NEXT_PUBLIC_` is a Next.js
browser-exposure convention, not an App Router requirement. Never apply it to database passwords,
secret/service-role keys, or the OpenRouter key.

Submit and observe this agent through the authenticated opportunity conversation, not a standalone
`flue run` that lacks the application-owned turn, credential, and budget context. The controlled
`streaming.test.ts` runs real Flue/PostgreSQL, the production Next HTTP app, and Pi's actual SSE
transport against a synthetic local provider. It does not spend tokens or verify live Supabase
authentication. See the [trial result](plans/008-flue-specialist-trial.md#implementation-evidence)
for the remaining permissioned live-provider check.

### Cloudflare streaming Worker

`apps/web/cloudflare/` runs the same turns on Cloudflare instead of `npm run streaming` (ADR-030).
Run only one owner against a database. Next.js wakes the Worker when `STREAM_WORKER_URL` and
`STREAM_WORKER_TOKEN` are set; without them it only records turns, as before. The Worker drives
each turn from a `TurnDriver` Durable Object, runs Flue's agent as one Durable Object per
conversation, and reaches PostgreSQL through Hyperdrive on the session pooler (port 5432). A
one-minute cron sweep, run inside a Durable Object, recovers turns whose wake was lost.

| Command | Does |
| --- | --- |
| `npm run cloudflare:build` | Builds the deployable Worker into `apps/web/cloudflare/dist/` |
| `npm run cloudflare:dev -w @signal-desk/web` | Runs the Worker in local workerd |
| `npm run cloudflare:deploy -w @signal-desk/web` | Builds and deploys with Wrangler |
| `npm run test:cloudflare` | Runs `streaming.test.ts` against local workerd |

`npm run test:cloudflare` needs `TEST_DATABASE_URL`, the production Next build, and a role that
can create the `signal_desk_worker_test` login role, because Hyperdrive's local proxy drops
startup options. It refuses to run while `apps/web/cloudflare/.dev.vars` exists, since Wrangler
would let that file override the test seams. The local provider and crash points are compiled in
only with `SIGNAL_DESK_TEST_SEAMS=1`; deployable builds contain neither. Worker logs from each run
are kept in `apps/web/cloudflare/.wrangler/test-worker.log`. Run Wrangler and Vite through the
package scripts or from `apps/web/cloudflare/` directly: `npx` in a workspace runs from the
package root and picks up the wrong configuration.

To deploy, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set and run from
`apps/web/cloudflare/`:

1. Create the Hyperdrive config with caching disabled, since a cached read could keep showing a
   revoked observer a conversation for up to a minute:
   `wrangler hyperdrive create signal-desk-streaming --connection-string="$URL" --caching-disabled`.
   Use a login role that defaults to `signal_desk_runtime` and the session pooler on port 5432.
2. Put the returned id in `wrangler.jsonc`.
3. Write `STREAM_WORKER_TOKEN` and `OPENROUTER_API_KEY` to a mode-600 JSON file outside the
   repository and deploy with `npm run cloudflare:build` then
   `wrangler deploy --secrets-file <file>`. Delete the file afterwards.
4. Set `STREAM_WORKER_URL` and `STREAM_WORKER_TOKEN` on the Next.js deployment, then stop the
   Node owner.

The API token needs Account: Workers Scripts Edit and Hyperdrive Edit. The account must have a
`workers.dev` subdomain, which only the account owner can create in the dashboard. Never set
`SIGNAL_DESK_TEST_*` variables on a deployed Worker.

### Turn latency evaluation

`npm run eval:latency` measures real specialist turns with paid OpenRouter Kimi K3 requests.
It recreates a disposable local `*_test` database named by `EVAL_DATABASE_URL`, applies the
ordered migrations, the demo seed and the synthetic municipality seed, then starts the real owner.
Each scenario is submitted and observed through `submitStream` and `readStreams` at the stream
route's 350 ms interval. It refuses non-loopback databases and never reads `DATABASE_URL`.
Pass `--db-rtt-ms 25` to add a hosted-pooler round trip to every local database reply.
Results record time to first text, first card and completion, then each request's TTFT,
duration, tokens, reasoning tokens and OpenRouter-reported cost. They also count database
queries by caller and phase.

`npm run eval:latency:control` replays the captured request bodies directly against OpenRouter,
without Flue, the database or admission, so model time can be separated from Signal Desk work.
It also compares routing and Yaklabs-style reasoning variants. Both commands stop before a shared
ledger under `.amp/in/latency/` exceeds `LATENCY_EVAL_CAP_USD`, US$1 by default. Artifacts are
written to the ignored `.amp/in/artifacts/latency/` directory. Running either command spends money.

## One gate, separate responsibilities

| Command | Checks |
| --- | --- |
| `npm run check:docs` | Markdown physical lines at most 100 columns |
| `npm run format:check` | Code and configuration formatting with Oxfmt |
| `npm run lint` | Local correctness and framework rules with Oxlint |
| `npm run typecheck` | TypeScript contracts |
| `npm test` | Native Node behavioral tests through tsx, with fresh V8 coverage |
| `npm run fallow` | Changed-code dead code, complexity, duplication, and structural findings |

`npm run check` runs these in order and stops on failure. Lefthook and GitHub Actions use that same
command. CI additionally builds the application and supplies a disposable PostgreSQL 16 database
through `DATABASE_URL` and `TEST_DATABASE_URL`. It starts that build and sets `TEST_APP_URL` before
running the gate. Database and HTTP tests fail in CI if their configuration is absent; a skipped
suite is not a verified slice. Local tests may skip those groups when services are not configured.

The foundational application and its test setup belong to ETH-73. The complete vertical-slice
evaluation belongs to ETH-79. Installing these checks is not evidence that AE1 through AE8 pass.
Live Supabase sign-in, extraction, and vision require separate private prototype configuration;
tests using controlled external boundaries must be labeled accordingly. Never use Garage's data
or credentials as fixtures. Provider-dependent evaluation reports unavailable trials explicitly.

## Formatting and analysis

Run `npm run format` to format code and configuration. Markdown is excluded from Oxfmt to preserve
existing document structure; wrap prose manually and run `npm run check:docs`. Neither command
silently fixes or stages files during a commit. Generated output and lockfiles are not hand-edited.

Fallow uses its standard error severities for structural problems and standard complexity and
duplication thresholds. Cleanup and design-system warnings stay advisory. No blanket suppression
or debt baseline is installed. Next.js route entry points are detected by Fallow's framework plugin.
`fallow-plugin-node-test.json` declares the same native test roots as `npm test`. Fallow's default
test-reachability estimate is not measured execution coverage or proof of live authentication.
The worker and MCP CLIs have explicit `npm run worker` and `npm run mcp` entry points.
`scripts/test.mjs` clears `coverage/`, then runs the recursive `apps/web/src/` application,
`packages/*/src/` shared-package, and root tooling tests with `NODE_V8_COVERAGE`.
It then normalizes file
source-map URLs and cache keys so escaped dynamic-route names match V8's literal script URLs.
Execution ranges and hit counts remain unchanged. Fallow reads that newly generated directory at
unchanged thresholds. Never substitute captured coverage from another checkout.

The evidence HTTP regression launches the actual production app with synthetic credentials against
a local test-only identity provider. It checks rendered conflict/unknown states, public approval,
original preservation, and stale-review rejection. Its server process flushes source-mapped V8 data
on shutdown. This measures server rendering, not browser event-handler execution.
Browser interaction checks remain separate. Unmatched functions retain estimates.
Custom architecture zones and policy rule packs are not configured yet.

Locally Fallow compares with the remote default branch unless `FALLOW_AUDIT_BASE` is set. In CI,
pull requests compare with their base commit and main pushes compare with the previous main commit.
Full history is fetched so attribution works. To select an explicit comparison:

```sh
npm run fallow -- --base origin/main
```

Fallow validates code structure, not source truth, record permissions, or UI-card evidence. Those
need behavioral tests through the shared operations. Add actual acceptance checks as each feature
lands; do not replace missing features with mocked end-to-end success.

## Implementation ownership

Each ticket has its own Medium thread on a small orb, using poteto-mode. Dependencies transfer as
exact file snapshots, not merely commit IDs unavailable in another orb. The authoritative remote
is `https://github.com/mite404/garage-protoype`, despite the older Amp project display name.

- [ETH-73: authentication and foundation][eth73].
- [ETH-74: inference budgets][eth74], after ETH-73.
- [ETH-75: evidence and classification][eth75], after ETH-73 and ETH-74.
- [ETH-76: photo coverage][eth76], after ETH-75.
- [ETH-77: specialist chat and buyer handoff][eth77], after ETH-76.
- [ETH-78: MCP][eth78], after the shared sales operations.
- [ETH-79: evaluation][eth79], against the integrated implementation.

The coordinator owns quality tooling and integration. Feature owners run their checks and supply
actual validation evidence. No feature thread independently creates another app or agent runtime.

[eth73]: https://ampcode.com/threads/T-01a1414d-da5e-75f4-a631-6b434db04ce5
[eth74]: https://ampcode.com/threads/T-01a1414e-c064-74d3-aa14-fc99e321073d
[eth75]: https://ampcode.com/threads/T-01a1414e-ccb8-71ad-8f9a-d7df1cc47c6d
[eth76]: https://ampcode.com/threads/T-01a1414e-d647-76e9-9fcd-d2d7b1c68db1
[eth77]: https://ampcode.com/threads/T-01a1414e-e1be-7775-b807-eb96c5c6c7f7
[eth78]: https://ampcode.com/threads/T-01a1414e-ea76-728f-8e61-bb104c368252
[eth79]: https://ampcode.com/threads/T-01a1414e-f414-728e-a8ae-1ec5156ca408
