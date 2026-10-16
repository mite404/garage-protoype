# Garage Signal Desk

Independent interview prototype for Garage's Growth Engineer role, with design engineering craft.
This project is not affiliated with or endorsed by Garage.

The proposed slice helps a Garage sales specialist move an existing vehicle opportunity toward a
sale: review source-backed specifications, request missing photos or documents, answer supported
buyer questions, and prepare a qualified human handoff.

The repository includes access controls, atomic inference budgets, durable imports, and evidence
review. The explicitly selected saved example uses synthetic results without a paid call.
Live extraction remains unavailable without a server-owned provider, model policy, and budget.

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

Follow [the auth setup guide](docs/auth-setup.md) to configure the database and provision accounts.

## Verify locally

```sh
npm run build
npm run check
```

The native Node test runner loads TypeScript through `tsx`. Its recursive glob includes
nested tests. Set `TEST_DATABASE_URL` to an operator connection for a disposable PostgreSQL database
whose name ends in `_test` to run integration checks. Tests bootstrap the schema and clean up their
fixtures. A minimal local `auth.sessions` table supports permission checks.
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
