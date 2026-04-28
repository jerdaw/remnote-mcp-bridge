#!/usr/bin/env bash
set -euo pipefail

# Run Codex with the RemNote MCP server enabled only for this invocation.
# This avoids registering RemNote tools in the user's normal global Codex config.

exec codex \
  -c 'mcp_servers.remnote-mcptest.url="http://127.0.0.1:3001/mcp"' \
  -c 'mcp_servers.remnote-mcptest.enabled_tools=["remnote_status","remnote_search","remnote_search_by_tag","remnote_read_note","remnote_read_table","remnote_get_playbook"]' \
  -c 'mcp_servers.remnote-mcptest.default_tools_approval_mode="approve"' \
  "$@"
