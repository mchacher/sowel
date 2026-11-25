# Roadmap, MCP server: architecture sketch

**Status**: Idea, 2026-11-25.

- `src/mcp/`: the server on the official SDK (`@modelcontextprotocol/sdk`), Streamable HTTP
  transport mounted on Fastify at `/mcp`. Each tool is a thin wrapper over the managers the REST
  routes already call; no business logic of its own.
- **Auth**: the existing API tokens (`swl_` prefix, SHA-256 hash, table `api_tokens`) gain a `scopes`
  column (migration) and an expiry. A scope check runs before every tool; the token's user role caps
  the scopes.
- **Pending confirmation**: an order to an equipment with spec 146 confirmation is stored as a pending
  request, pushed to the user, and executed only after a confirm in the UI. Times out after a few
  minutes.
- **Audit**: one log line per call (token, tool, target), readable in Settings.
- **UI**: Settings > AI access: on/off, create a token with its scopes and expiry, revoke, last calls.
- The AI recipes tools plug into the same server when that item ships.
