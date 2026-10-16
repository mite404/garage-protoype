# Development checks

Use the Node version pinned in `.node-version` and `.nvmrc`, and npm.
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
The worker CLI is an explicit entry point. `scripts/test.mjs` clears `coverage/`, then runs the
same recursive native test glob with `NODE_V8_COVERAGE`. Fallow reads that newly generated directory
at unchanged thresholds. Never substitute captured coverage from another checkout.

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
