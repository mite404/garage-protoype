# Configure invited access

## Create an isolated prototype

1. Create a new Supabase project you control. Do not use Garage's project or data.
2. In Authentication settings, disable **Allow new users to sign up** and anonymous sign-ins.
3. Keep email/password sign-in enabled. This unit needs no OAuth provider or email delivery.
4. Set `APP_ORIGIN` to the exact origin where the application is opened, including scheme and port.
5. Copy the prototype project URL and publishable key into `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` in `.env.local` or your host's private environment configuration.
6. Store the secret API key as `SUPABASE_SECRET_KEY` only for operator provisioning. Do not put any
   credential in a `NEXT_PUBLIC_` variable. The browser uses forms, not a Supabase client.

Public registration also returns `403 REGISTRATION_DISABLED` at the application endpoint. The
Supabase dashboard setting is required to deny direct calls to its Auth API. A Supabase identity
without an active application invitation still cannot access private records or spend.

## Apply the private schema

`MIGRATION_DATABASE_URL` is an operator connection to this prototype's PostgreSQL instance.
Use the Supabase database for live sign-in so `auth.sessions` is the real session table.
Do not point a live app at the test session stand-in.

```sh
npm run db:migrate
```

Drizzle Kit applies `db/migrations/` in journal order inside one transaction, serialized by an
advisory lock, and records each file in `drizzle.__drizzle_migrations`. A database migrated before
Drizzle Kit keeps `public.signal_desk_migrations`; the first run adopts the files listed there
instead of reapplying them.
It creates private tables in `signal_desk`, enables row-level security, and grants read access to
the server-only `signal_desk_runtime` role. Keep `signal_desk` out of the exposed Data API schemas.
Do not grant that role to `anon`, `authenticated`, or another browser-facing database role.

The migration also grants selected `auth.sessions` columns and a session-read policy to the runtime
role. It requires an operator permitted to grant access to that Supabase-managed table. This grant
has been tested against local PostgreSQL, not a configured hosted Supabase project. If the hosted
operator cannot apply it, resolve that grant before enabling live access. Do not remove the session
check or use a superuser runtime connection as a workaround.

Create a dedicated login with a privately entered password and grant it `signal_desk_runtime`.
Set `DATABASE_URL` to that login's connection string. The runtime role has no schema creation,
identity provisioning, or mutation rights. Future tickets must grant only the writes they need.
Use TLS with certificate verification for remote PostgreSQL. Do not disable certificate checks.

## Provision individual identities

Set `INVITE_EMAIL`, `INVITE_PASSWORD`, and `INVITE_ROLE` privately. The password must contain at
least 16 characters. The role is `buyer` or `specialist`.

```sh
npm run identity:provision
```

The operator command creates a confirmed Supabase identity and an application invitation with
spending disabled. Use only operator-verified, permissioned identities. This is operator
provisioning, not proof that an email challenge has been completed. Deliver the individual password
privately and remove it from the environment afterward. No shared credentials belong in Git.
The command never sends email. If a database write fails after Auth creates the identity, access
remains denied. Recover by inserting its returned Auth user ID into `signal_desk.identities` through
the operator database connection. Do not create another identity or grant access through metadata.

Insert a specialist's explicit `opportunity_members` row before assigning private access. Buyers
need matching `opportunities.buyer_id` ownership. Specialists do not inherit every record merely
because their role is `specialist`.

Revoke application access by setting `identities.revoked_at` to the current timestamp. Revoke
spending alone by setting `identities.can_spend` to `false`. Both checks reload on every operation,
including when a caller supplies an existing transaction client. Supabase sign-out removes the
session; a still-unexpired access token cannot pass the subsequent database session check.

## Seed the optional read-only example

Run `db/demo.sql` with the operator connection only in a disposable or explicitly approved prototype
database. It inserts a synthetic vehicle and one deliberately approved, shareable year fact.
The public vehicle URL is `/vehicles/demo-pumper`. The seed creates no identity, buyer conversation,
photo evidence, or inference job. Without the seed, that record remains unavailable.

## Verify live authentication separately

Live sign-in is unverified until the prototype credentials and grants are configured. Then check
individual sign-in, sign-out, refresh, expired sessions, revoked application access, membership
removal, and changed spending permission against the running application. Browser mutations require
an exact matching Origin. Server responses use `Cache-Control: no-store`.

Local integration tests exercise the access model and actual SQL. They do not claim that hosted
Supabase Auth, email ownership, or session refresh has been tested.
