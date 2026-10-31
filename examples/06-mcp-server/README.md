# Example 06: Orbis as an MCP Server

Run Orbis as a [Model Context Protocol](https://modelcontextprotocol.io) server so AI assistants such as Claude Desktop, Claude Code, Cursor, Windsurf and Antigravity can browse the web and your local apps. This folder contains ready-to-copy client configurations and a small client that speaks raw JSON-RPC, so you can see exactly what happens on the wire.

## Client configuration

All clients use the same command: `npx -y @memoracompany/memora-orbis --mcp`. (`npx memora-orbis` does not work: that npm package does not exist.)

| Client | Where | File in this folder |
| :--- | :--- | :--- |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json` | [`claude_desktop_config.json`](./claude_desktop_config.json) |
| Cursor | `~/.cursor/mcp.json` or the project's `.cursor/mcp.json` | [`cursor_mcp.json`](./cursor_mcp.json) |
| Antigravity / Windsurf / other JSON configs | The client's MCP config file | [`antigravity_mcp.json`](./antigravity_mcp.json) |
| Claude Code | Command line | `claude mcp add orbis -e ORBIS_NO_TELEMETRY=1 -- npx -y @memoracompany/memora-orbis --mcp` |

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"],
      "env": {
        "ORBIS_NO_TELEMETRY": "1"
      }
    }
  }
}
```

`ORBIS_NO_TELEMETRY=1` turns off the start-up version check. Keep it in MCP configs: the update notice is printed to stdout, which is the MCP message channel.

Useful extra arguments (add them to `args`):

| Argument | Effect |
| :--- | :--- |
| `--engine native` | Always use the built-in engine (fast, no Chrome needed) |
| `--engine chrome` | Use the installed Chrome or Edge; better for JavaScript-heavy apps and local SPA dev servers. Fails at start-up if neither is installed |
| (default `--engine auto`) | Chrome or Edge if found in a standard location, otherwise the built-in engine |
| `--obey-robots` | Respect robots.txt |
| `--use-env-proxy` | Route through `HTTP_PROXY` / `HTTPS_PROXY` |

## The 15 tools

| Tool | Purpose |
| :--- | :--- |
| `memora_browse` | Load a URL; returns the action map plus Markdown (capped at 4,000 characters). Accepts `focus` and `exclude` selectors |
| `memora_act` | Click (follows links and submits forms) or type into an element |
| `memora_fill_form` | Fill several fields and optionally submit in one call |
| `memora_diff` | What changed since the last snapshot |
| `memora_inspect` | Current action map, optionally scoped with `focus` |
| `memora_extract` | Text or attributes of elements matching a CSS selector |
| `memora_metadata` | Title, description, canonical URL, OpenGraph, Twitter card, JSON-LD |
| `memora_html` | Raw HTML of the page or one element |
| `memora_eval` | Run JavaScript in the page |
| `memora_storage` | Read and write `localStorage` / `sessionStorage` |
| `memora_cookies` | List or set cookies |
| `memora_console` | Page console messages and script errors |
| `memora_reload` | Reload the page |
| `memora_session` | Save or load cookies and storage to a JSON file |
| `memora_fork` | Switch to a copy of the current page |

Each tool also answers to an `orbis_` prefix (for example `orbis_browse`). Inputs, outputs and caveats for each: [MCP server](../../docs/mcp.md).

## Run the test client

```bash
npm install
npm start
```

The client serves a small search page locally, starts `orbis --mcp --engine native`, and calls `initialize`, `tools/list`, `memora_browse`, `memora_fill_form` and `memora_extract`. Expected output (abridged):

```text
Server: Orbis by Memora 0.1.2 (protocol 2024-11-05)
Tools (15): memora_browse, memora_act, memora_diff, memora_fill_form, memora_session, ...

# Page Loaded: Docs search (32.6ms)
URL: http://127.0.0.1:18095 [HTTP 200]
Token Estimate: ~74 tokens | Interactive Elements: 2

=== INTERACTIVE ACTION MAP (2 elements) ===
[@1] [input] "Search docs" placeholder="Search docs" (selector: input[name="q"])
[@2] [button] "Search" type="submit" (selector: ...)
...
Form fill completed! Filled 1 field(s), submitted form.
Current URL: http://127.0.0.1:18095/search?q=mcp
Page Title: "Results for mcp"
...
[
  "Results for \"mcp\""
]
```

## Things to know

- Messages are newline-delimited JSON-RPC 2.0 on stdin/stdout. The server handles requests concurrently, so a client must wait for one tool call to finish before sending the next.
- `memora_eval` runs arbitrary JavaScript, and `memora_session` reads and writes files on your machine. Only connect Orbis to assistants you trust, and review tool calls that touch files.
- Typed values, including passwords, appear in later action maps and diffs, which the assistant reads. Prefer `memora_session` with a saved login over typing credentials.
- Large pages produce large action maps. Ask the assistant to pass `focus` (for example `main`) and `exclude` (for example `["nav", "footer"]`).
