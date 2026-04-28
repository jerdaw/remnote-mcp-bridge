# Security Audit Notes

Date: 2026-04-27

Scope:

- `robert7/remnote-mcp-bridge` at `8fd10de817825df3365e7d7e24374107201b04b7`
- `robert7/remnote-mcp-server` at `f14757d127ec891169915a3936d7f240b84963f4`
- Local validation on Node `v24.12.0` and npm `11.6.2`

## Summary

The bridge and server are designed as a local automation path from MCP clients to RemNote:

```text
MCP client -> local HTTP MCP server -> local WebSocket server -> RemNote plugin -> RemNote SDK
```

The bridge plugin itself does not contain obvious outbound HTTP calls, shell execution, `eval`,
browser storage/cookie use, or credential handling in source. The main safety issue is capability
scope: once installed, the RemNote plugin requests broad RemNote access and can read, create,
modify, and delete across the knowledge base through supported bridge actions.

## Capability Surface

The plugin manifest requests:

- Scope: `All`
- Level: `ReadCreateModifyDelete`

The bridge accepts these actions from the connected companion process:

- Read-oriented: `get_status`, `search`, `search_by_tag`, `read_note`, `read_table`
- Write-oriented: `create_note`, `append_journal`, `update_note`
- Destructive update mode: `update_note.replaceContent` can remove direct child Rems before
  recreating content, but is disabled by default via `Accept replace operation`.

The server exposes these MCP tools:

- `remnote_status`
- `remnote_search`
- `remnote_search_by_tag`
- `remnote_read_note`
- `remnote_read_table`
- `remnote_create_note`
- `remnote_append_journal`
- `remnote_update_note`
- `remnote_get_playbook`

## Network Model

Default runtime behavior is local-first:

- HTTP MCP server defaults to `127.0.0.1:3001`.
- WebSocket server binds to `127.0.0.1` and ignores attempts to configure a wider WebSocket host.
- Bridge plugin default WebSocket URL is `ws://127.0.0.1:3002`.

The HTTP server can be widened with `--http-host 0.0.0.0` or `REMNOTE_HTTP_HOST=0.0.0.0`.
Treat that as remote-access mode and do not use it without an explicit tunnel/authentication
decision.

The local startup check used high-numbered test ports and confirmed both listeners bound to
`127.0.0.1`:

```text
HTTP: 127.0.0.1:39101
WebSocket: 127.0.0.1:39102
```

The OAuth metadata endpoint responded locally. It returned `Access-Control-Allow-Origin: *`,
which is acceptable only under the local/trusted-client assumption; it becomes more sensitive if
the HTTP server is exposed remotely.

## Verification Results

Bridge:

- `npm ci`: passed, with audit findings
- `npm run typecheck`: passed
- `npm test`: passed, 231 tests
- `npm run lint`: passed
- `npm run format:check`: passed
- `npm run build`: passed, created `PluginZip.zip`

Bridge build warnings:

- Webpack reports bundle-size warnings for `index*.js` and `mcp_bridge*.js`.
- CSS optimizer warns that `:host-context(div)` is not recognized.

Server:

- `npm ci`: passed, with audit findings
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run format:check`: passed
- `npm run build`: passed
- `node dist/index.js --help`: passed
- `node dist/index.js --version`: returned `0.13.0`
- Local startup on `127.0.0.1` test ports: passed
- `npm test`: failed timing/connection-sensitive tests in this environment

Server test failures observed after the 2026-04-27 dependency updates:

```text
test/unit/test-server-helpers.test.ts > waitForHttpServer > should resolve immediately for running server
AssertionError: expected 50 to be less than 50

test/unit/test-server-helpers.test.ts > waitForHttpServer > should use exponential backoff timing
Error: Test timed out in 5000ms.

test/unit/websocket-server.test.ts > WebSocketServer - Single Client Model > should allow new connection after first client disconnects
AssertionError: expected false to be true
```

The earlier focused rerun of `test/unit/test-server-helpers.test.ts` failed the backoff test
consistently. These failures are timing/connection-test failures, not observed runtime startup
failures.

## Dependency Audit Findings

Bridge `npm audit` reported 11 findings:

- 7 moderate
- 4 high
- Mostly dev/build-chain packages, including `webpack-dev-server`, `webpack-cli`,
  `@pmmmwh/react-refresh-webpack-plugin`, `lodash`, `picomatch`, `json5`, `underscore`, `ajv`,
  `follow-redirects`, `sockjs`, and `uuid`.

Server `npm audit` reported 6 findings:

- 1 low
- 1 moderate
- 4 high
- Includes runtime-relevant packages in the MCP server dependency graph: `hono`,
  `@hono/node-server`, `express-rate-limit`, `path-to-regexp`, `ajv`, and `qs`.

Do not expose the HTTP server remotely until the server dependency findings are reviewed and
patched or explicitly accepted.

## Initial Safety Recommendations

Use this sequence for first live testing:

1. Use a separate RemNote knowledge base or disposable RemNote content.
2. Install/load the bridge only from the local fork or reviewed plugin zip.
3. Keep the server bound to `127.0.0.1`; do not use `--http-host 0.0.0.0`.
4. In plugin settings, set a disposable default parent Rem ID.
5. Start with `Accept write operations` disabled if the UI setting is available before testing.
6. Keep `Accept replace operation` disabled.
7. Run `remnote_status` before any write-capable prompt.
8. Test reads first: status, search, search by tag, read note, read table.
9. Test writes only against disposable content: create one note, append one journal entry, update
   only the created note.
10. Do not configure remote/cloud MCP clients until local-only behavior is understood.

## Codex Read-Only Configuration

For Codex CLI testing, expose only read-oriented MCP tools first. This keeps write-capable tools
out of the model-visible tool list even if the bridge/server are running.

Do not leave this in a normal default Codex configuration unless RemNote access should be available
to ordinary Codex sessions. Prefer command-level config overrides so RemNote tools are available
only for the current invocation.

This fork includes `./codex-remnote-readonly.sh`, which wraps Codex with those one-shot overrides:

```bash
./codex-remnote-readonly.sh exec --sandbox read-only --cd /home/jer/repos/remnote-mcp-server \
  "Use remnote-mcptest to call remnote_status exactly once."
```

The script keeps `codex mcp list` empty and does not persist RemNote MCP credentials.

Opt-in test configuration:

```toml
[mcp_servers.remnote-mcptest]
url = "http://127.0.0.1:3001/mcp"
enabled_tools = ["remnote_status", "remnote_search", "remnote_search_by_tag", "remnote_read_note", "remnote_read_table", "remnote_get_playbook"]
default_tools_approval_mode = "approve"
```

With the hardened bridge build loaded in a local-only `MCPTest` knowledge base and the MCP server
running on `127.0.0.1`, Codex CLI verification produced:

- `remnote_status`: connected, server/plugin `0.13.0`, `acceptWriteOperations=false`,
  `acceptReplaceOperation=false`
- `remnote_search`: succeeded
- `remnote_read_note`: succeeded for a searched Rem ID
- `remnote_get_playbook`: succeeded
- `remnote_search_by_tag`: succeeded for a nonexistent test tag with zero results
- `remnote_create_note`, `remnote_update_note`, and `remnote_append_journal`: unavailable to Codex
  because they were not included in `enabled_tools`

## Open Issues Before Trusting With Real Notes

- The broad RemNote permission grant is inherent to the current plugin design.
- On this hardening branch, write operations default to disabled. Re-check this before rebasing
  onto upstream, because upstream previously defaulted writes to enabled.
- The server's local OAuth provider auto-approves clients; this is reasonable locally but not a
  sufficient remote security boundary.
- Dependency audit findings need remediation, especially in the server dependency graph.
- The server timing/connection test failures should be fixed or explained upstream before relying
  on the server test suite as a clean regression gate.
