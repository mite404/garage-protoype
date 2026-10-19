# Garage Signal Desk

Independent interview prototype for Garage's Growth Engineer role, with design engineering craft.
This project is not affiliated with or endorsed by Garage.

The proposed slice helps a Garage sales specialist move an existing vehicle opportunity toward a
sale: review source-backed specifications, request missing photos or documents, answer supported
buyer questions, and prepare a qualified human handoff.

The repository includes access controls, atomic inference budgets, durable imports, and evidence
review. The explicitly selected saved example uses synthetic results without a paid call.
Live extraction remains unavailable without a server-owned provider, model policy, and budget.

## Current code organization

This is one Next.js App Router application with separate Node worker processes, not a separate
API service. Supabase Auth verifies identities. Drizzle provides typed application queries over
PostgreSQL, with `pg` retaining connection and transaction ownership. Ordered SQL migrations remain
the database history. The bounded Flue specialist-streaming trial uses the same sales operations.

```text
apps/web/src/
  app/              App Router pages, route-local components, and HTTP adapters
  server/           Authentication, permissions, sales operations, and Drizzle schema
  agents/           Flue specialist agent using the existing operations
  worker.ts         Import and photo-processing process entry point
  streaming-worker.ts  Durable specialist-conversation process entry point
  mcp.ts            Stdio MCP adapter calling the application's authenticated HTTP API
apps/storybook/     Independent browser catalog, not a second product application
packages/ui/        Shared Base UI primitives and theme
packages/catalog/   Product cards, prose, workspace chrome, and colocated stories/tests
packages/contracts/ React-free Zod contracts shared by browser and server, with their tests
packages/config/    Shared TypeScript configuration
db/                 Ordered SQL migrations and synthetic demo seed
scripts/            Operator commands and repository checks
```

Web and Storybook consume the shared presentation packages. Catalog consumes UI and contracts;
server operations consume contracts directly, never the presentation catalog. Authentication and
database code stay application-owned because there is no independently released consumer.
Worker processes share that application code and database lifecycle. MCP calls HTTP, not the DB.

The workspace layout was adapted from Better T Stack 3.44.1. Its unchanged generator metadata is
[archived as provenance](docs/reference/bts-3.44.1.jsonc), not current generator configuration.
The later 3.47.0 Supabase/Drizzle/Better Auth reference separates `db` and `auth` packages; this app
retains Supabase Auth and its existing application boundaries rather than matching that template.
See [development checks](docs/development.md) for the reference command and runtime setup.

## Run the prototype

Use Node 22 LTS and npm. Dependency versions are exact and the lockfile is committed.

```sh
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Without credentials, the application still renders its public entry page, configuration notice,
and protected-workspace denial. It does not simulate authentication. Live sign-in requires a
separate prototype Supabase project. Never use Garage's project, credentials, or customer data.
The root `.env.local` is read by the web app's Next config and by root operator scripts; the
worker and MCP commands also load it. An app-specific `apps/web/.env.local` is loaded by Next.
Neither env file is copied into Storybook or tracked in Git.

`npm run dev:web` runs only the Next app. `npm run storybook` runs the independent React-Vite
catalog at port 6006. `npm run build-storybook` writes `storybook-static/`.

Follow [the auth setup guide](docs/auth-setup.md) to configure the database and provision accounts.

## Verify locally

```sh
npm run build
npm run check
```

The native Node test runner loads TypeScript through `tsx`. Its recursive globs include application
and shared-package tests. Set `TEST_DATABASE_URL` to an operator connection for a disposable
PostgreSQL database whose name ends in `_test` to run integration checks.
Tests bootstrap the schema and clean up their fixtures; see
[disposable test databases](docs/development.md#disposable-test-databases).
A minimal local `auth.sessions` table supports permission checks.
The HTTP review regression launches the production build with a loopback-only controlled identity
provider, not live Supabase. `CI=true` requires the database configuration.
Tests regenerate V8 coverage for Fallow automatically.

Set `TEST_APP_URL` to a running local app to exercise HTTP access and processing denials. HTTP tests
skip locally when the app is absent and fail in CI without its URL. Database tests skip outside CI
when their URL is absent. Neither skip verifies live Supabase sign-in, sign-out, or token refresh.

## Project brief

Read the [Signal Desk plan](docs/plans/2026-10-15-1440-feat-signal-desk-plan.md) for scope,
stakeholders, research sources, acceptance examples, and the proposed three-day delivery sequence.

See the [seven viability decisions](docs/viability-decisions.md) for the design questions and
defaults, and the [architecture decision record](docs/ADR.md) for one-sentence decisions.

Use [Architectural design and HTTP contracts](docs/contracts.md) as the architectural and API
reference. Its ETH-73 section distinguishes implemented routes from remaining proposals.

Use synthetic or permissioned demo material. Do not scrape Garage or republish its listing assets
without permission. Keep credentials out of Git.

See [development checks and ticket ownership](docs/development.md) for Lefthook, Fallow, CI, and
implementation dependencies.

See [ETH-79 evaluation results](docs/evaluation.md) for the frozen conversation corpus, real-stack
acceptance checks, rerun commands, measured accounting, and explicitly unavailable live trials.
