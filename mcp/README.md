# Darkroom MCP server

A stdio [MCP](https://modelcontextprotocol.io) server that exposes the local
Darkroom API to an MCP client (e.g. Claude). It's a thin wrapper: the Darkroom
backend does the work, this just maps tools → HTTP calls.

## Prerequisite

The Darkroom backend must be running:

```bash
bun run server        # or: bun run dev
```

## Register it

```jsonc
// ~/.claude.json (or your MCP client's config)
{
  "mcpServers": {
    "darkroom": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/darkroom/mcp/server.ts"],
      "env": { "DARKROOM_API": "http://localhost:3535" }
    }
  }
}
```

`DARKROOM_API` defaults to `http://localhost:3535` if omitted.

## Tools

| Tool | Description |
|---|---|
| `list_photos` | List gallery photos (optional `filter`). |
| `get_photo` | One photo + versions + effective prompt. |
| `edit_photo` | Queue an edit; optional `prompt` sets a per-photo override. |
| `generate_image` | Generate new image(s) from a text prompt (`count` 1–50). |
| `generate_missing` | Queue an edit for every photo with no versions. |
| `list_jobs` | Job-queue snapshot. |
| `set_favorite` | Set/clear a photo's favorite version. |
| `set_global_prompt` | Set the global default prompt. |
| `export_favorites` | Copy favorites into `final/`. |
| `status` | Backend + ChatGPT browser health; `launch:true` starts Chrome. |

## Quick check

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | bun run mcp/server.ts
```

You should see the 10 tools listed in the response.
