# Connect Claude Code to Signal Desk

Use a separate prototype installation with invited specialist access. No live inference provider
is installed by this feature. Missing model configuration and budgets deny processing.

1. Install the pinned Node 22 toolchain and run `npm ci` in this repository.
2. Apply migrations through `db/migrations/0005_app-tokens.sql` with the operator migration command
   from [auth setup](auth-setup.md). Never give that connection string to your terminal MCP client.
3. Sign in to the specialist dashboard. Open **Manage local MCP tokens** and create a labeled token.
   Keep read-only access unless you need unsent drafts. Paid processing also needs explicit write
   and spending permission, a configured server model, and operator-provisioned budgets.
4. Store the once-shown token in your local secret manager. Keep it out of Git, chat, screenshots,
   shell history, and project MCP configuration. Hide the secret after saving it.
5. In a Bash terminal, set the app URL and read the token without echo or a history entry:

```sh
export SIGNAL_DESK_URL=https://your-prototype.example
read -rs -p 'Signal Desk application token: ' SIGNAL_DESK_TOKEN
export SIGNAL_DESK_TOKEN
printf '\n'
```

6. From the repository root, register the local process. The absolute loader path works even when
   Claude Code starts the process from another directory. No secret is stored in the registration.

```sh
claude mcp add --transport stdio --scope local signal-desk -- \
  "$(command -v node)" --import "$PWD/node_modules/tsx/dist/loader.mjs" "$PWD/src/mcp.ts"
```

7. Start Claude Code from that same terminal so the MCP process inherits the two environment
   variables. Open `/mcp` to check the connection. Ask it to list your assigned opportunities.
   The connection uses the official SDK over stdio, not a remote MCP endpoint.

For another MCP client, configure the same Node command and absolute arguments locally. Supply only
`SIGNAL_DESK_URL` and `SIGNAL_DESK_TOKEN`. The adapter rejects non-HTTPS remote origins, URL
credentials and redirects. Loopback HTTP is supported only for controlled local verification.

Use `get_workbench` to inspect permitted source excerpts, citations, blockers and job states. Use
`get_assistance` to read questions and unsent drafts. For mutations, supply an explicit stable key
and reuse it only with identical input. Refresh the workbench revision before preparing a draft.
Never change a key merely to bypass a failed request or an uncertain provider attempt.

Revoke a lost token in **Your application tokens**. Its next request fails, including queued or
recovered work that has not passed paid admission. Revocation cannot recall a paid request already
authorized. Issue a replacement rather than restoring a revoked token.

## Reproduce the local MCP check

Use a disposable PostgreSQL database ending in `_test`, with operator credentials only in the test
process. Build before running the test so HTTP requests execute the current production routes.

```sh
npm run build
TEST_DATABASE_URL=postgresql:///signal_test?host=/var/run/postgresql \
  node --conditions=react-server --import tsx --test src/server/mcp.test.ts
```

The test launches an actual SDK stdio client and the production app against controlled local auth.
It uses actual PostgreSQL persistence and shared operations. Provider callbacks stay below shared
admission and budget-denial checks assert zero dispatches. This is not live Supabase or paid-model
verification. Run the full `npm run check` gate with the development guide's test configuration too.

Registration syntax follows the [Claude Code MCP documentation][claude-mcp].

[claude-mcp]: https://code.claude.com/docs/en/mcp
