# MCP tokens

## Sub-features

Specialist token creation and revocation at MCP tokens, read-only and write scopes, expiry, and
the local MCP client with opportunity tools and import jobs.

## How to get to it (user POV)

Sign in as a specialist, open Workspace, then Manage local MCP tokens or the MCP tokens nav link.
Run the client with `SIGNAL_DESK_URL` and `SIGNAL_DESK_TOKEN` set, then `npm run mcp`.

## Driving it with the native HTTP harness

Run the complete gate. `mcp.test.ts` starts a real stdio MCP client against the production build
and proves the tool list, hidden foreign opportunities, refused writes for read-only tokens, one
unsent draft per payload, mid-connection expiry and revocation, and jobs keeping their credential.

## Gotchas

The token page itself is never fetched by a test. Tokens are local credentials; never paste one
into a prompt, log or commit.
