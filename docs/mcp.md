# MCP Server Guide

Orbis includes a Model Context Protocol (MCP) server that gives AI assistants (Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity, VS Code, or any MCP client) a token-efficient web browser. The server speaks JSON-RPC 2.0 over stdio and exposes 17 tools. Each one loads a page, acts on it, or reads from it, and returns compact text: an action map plus Markdown instead of raw HTML. This page covers client setup, engine selection, every tool's inputs and outputs, and the security implications of handing these tools to a model.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Quick setup](#quick-setup)
- [Client configuration](#client-configuration)
- [Engine selection](#engine-selection)
- [Passing network options](#passing-network-options)
- [Tool reference](#tool-reference)
- [Protocol details](#protocol-details)
- [Testing the server by hand](#testing-the-server-by-hand)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Known issues](#known-issues)

---

## Quick setup

The command every client runs:

```bash
npx -y @memoracompany/memora-orbis --mcp
```

- The npm package is **`@memoracompany/memora-orbis`**. `memora-orbis` is the name of a binary inside that package and of the Python package. **There is no npm package called `memora-orbis`**, so `npx -y memora-orbis --mcp` fails with a 404 from the registry.
- Requires Node.js 20 or later on the machine running the client.
- For faster start-up and pinned versions, install once and point the client at the binary:

```bash
npm install -g @memoracompany/memora-orbis@0.2.0
orbis --mcp        # what the client will run
```

**Recommended environment variable:** set `ORBIS_NO_TELEMETRY=1` in the server's environment. On start-up the CLI calls `https://orbis.memora.company/api/v1/version-check`. If a newer version exists, it prints an "UPDATE AVAILABLE" line to stderr, so it does not interfere with the MCP JSON-RPC stream on stdout. The variable disables the check entirely, which is useful in air-gapped or CI environments.

## Client configuration

All examples use `npx`. To use a global install, replace `"command": "npx", "args": ["-y", "@memoracompany/memora-orbis", "--mcp"]` with `"command": "orbis", "args": ["--mcp"]`.

### Claude Desktop

Config file location:

| OS | Path |
| :--- | :--- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"],
      "env": { "ORBIS_NO_TELEMETRY": "1" }
    }
  }
}
```

Restart Claude Desktop fully (quit from the tray or menu bar, not just close the window). The 15 `memora_*` tools appear in the tools menu.

On Windows, if `npx` is not found, use `"command": "cmd", "args": ["/c", "npx", "-y", "@memoracompany/memora-orbis", "--mcp"]`, or the absolute path to `npx.cmd`.

### Claude Code

```bash
claude mcp add orbis -e ORBIS_NO_TELEMETRY=1 -- npx -y @memoracompany/memora-orbis --mcp
```

Use `--scope project` to write the server into the repository's `.mcp.json` so your team shares it, or `--scope user` to make it available in all your projects. Check it with:

```bash
claude mcp list
```

### Cursor

Settings → MCP → Add new MCP server, or edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"],
      "env": { "ORBIS_NO_TELEMETRY": "1" }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"],
      "env": { "ORBIS_NO_TELEMETRY": "1" }
    }
  }
}
```

### Google Antigravity

Open the MCP server settings (Agent panel → MCP Servers → Manage → View raw config) and add the same `mcpServers.orbis` block as above.

### VS Code (GitHub Copilot agent mode)

Create `.vscode/mcp.json` in the workspace. VS Code uses a `servers` key:

```json
{
  "servers": {
    "orbis": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"],
      "env": { "ORBIS_NO_TELEMETRY": "1" }
    }
  }
}
```

### Any other stdio MCP client

Launch `npx -y @memoracompany/memora-orbis --mcp` (or `orbis --mcp`) as a child process. Write one JSON-RPC message per line to its stdin and read one response per line from its stdout. The [protocol details](#protocol-details) below list what the server implements.

Client config files for Claude Desktop, Cursor and Antigravity are also in [`examples/06-mcp-server`](../examples/06-mcp-server/).

## Engine selection

The MCP server is the only Orbis mode that can drive a real Chrome. Choose with `--engine`:

| `--engine` | Behaviour |
| :--- | :--- |
| `auto` (default) | Uses **system Chrome or Edge** if one is found at a known install path. Otherwise uses the native Orbis engine. |
| `native` | Always the native Orbis engine: a Node.js HTML parser, DOM and V8 sandbox. No rendering, no GPU, low memory. |
| `chrome` | Always system Chrome or Edge through `playwright-core`, headless. Fails at start-up if none is found. |

Paths checked by `auto` and `chrome`, in order:

- Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `C:\Program Files\Microsoft\Edge\Application\msedge.exe`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
- Linux: `/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, `/usr/bin/chromium`
- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

**On a typical developer laptop with Chrome installed, `auto` therefore runs real Chrome, not the native engine.**

Which engine to use:

- **Client-rendered apps** (React, Vue, Angular or Svelte SPAs, including your local dev server at `http://localhost:3000`): use `--engine chrome`. The native engine's page runtime covers the common DOM APIs, but not all the browser APIs these apps need: `WebSocket`, `Worker`, `crypto`, `indexedDB`, `customElements` and `document.cookie` are undefined, there is no real layout, and `MutationObserver` is a no-op stub. Such apps often render an empty shell. See [limitations.md](./limitations.md) for the full table.
- **Server-rendered pages** (documentation, articles, marketing sites, classic multi-page apps, most search results): `--engine native` is lighter and faster, and supports every Orbis locator.

For predictable behaviour, set the engine explicitly:

```json
"args": ["-y", "@memoracompany/memora-orbis", "--mcp", "--engine", "native"]
```

Differences that matter:

| Topic | Native engine | Chrome engine |
| :--- | :--- | :--- |
| JavaScript-heavy apps (React/Vue SPAs, WebGL, canvas) | Runs classic and module scripts in a sandbox that lacks many browser APIs. SPAs often render an empty shell. | Full Chrome behaviour. Waits up to 2.5 s for `#root`/`#app` to mount. |
| Memory and start-up | Low (no browser process). | One headless Chrome process, started on the first tool call. |
| Locators in `memora_act` | All Orbis locators ([locators.md](./locators.md)). | `@N` IDs from the latest snapshot, or **Playwright selector syntax** (CSS, `text=`, `xpath=`, `role=`). Orbis-only prefixes such as `label:` and `placeholder:` do not work. |
| Stealth | Orbis stealth headers and fingerprint script ([stealth.md](./stealth.md)). | Only the user agent override and `--disable-blink-features=AutomationControlled`. The Orbis fingerprint script is not injected. |
| `memora_fork` | In-memory clone of URL, serialized DOM, cookies and storage. | Opens a new tab and re-navigates to the same URL (fresh load). |
| Cookies | Per-page jar, scoped by domain, path, `Secure` and expiry like a browser. | Chrome's real, domain-scoped cookie store. |
| `--proxy-bearer-token` | Supported for http(s) proxies. | Ignored (prints a warning). Use `user:pass@` in the proxy URL instead. |

## Passing network options

All network flags from [cli-reference.md](./cli-reference.md) work in MCP mode. Add them after `--mcp`:

```json
"args": [
  "-y", "@memoracompany/memora-orbis", "--mcp", "--engine", "native",
  "--obey-robots",
  "--http-header", "X-Team: research",
  "--user-agent", "AcmeResearchBot/1.0 (+https://acme.example/bot)",
  "--http-timeout", "15000",
  "--use-env-proxy"
]
```

**Prompt injection firewall (0.2.0+).** Add `"--firewall", "standard"` to make risky tools (JavaScript, cookies, storage, session files, form submits) ask you before they run, keep the agent on sites you allow, and label page text as untrusted for the model. See [prompt-injection-firewall.md](./prompt-injection-firewall.md).

`--port`, `--host`, `--protocol` and `--max-sessions` have no effect in MCP mode, because no network port is opened. See [network-and-proxies.md](./network-and-proxies.md) for proxy behaviour.

---

## Tool reference

The server holds **one active page** for the lifetime of the process. Every tool operates on it. Tool names are `memora_*`. Calls to `orbis_*` names are accepted as aliases (for example `orbis_browse` → `memora_browse`), but `tools/list` advertises only the `memora_*` names. All results are returned as a single `text` content item. Failures return `isError: true` with the text `Error executing <tool>: <message>`.

### Summary

| Tool | Purpose | Changes state |
| :--- | :--- | :--- |
| `memora_browse` | Load a URL, return action map plus Markdown | yes (navigates) |
| `memora_act` | Click or type on one element | yes |
| `memora_fill_form` | Fill several fields, optionally submit | yes |
| `memora_diff` | What changed since the last snapshot | baseline only |
| `memora_inspect` | Current title, URL, action map | baseline only |
| `memora_extract` | CSS-selector extraction to JSON | no |
| `memora_html` | Raw HTML of the page or one element | no |
| `memora_metadata` | Meta tags, OpenGraph, Twitter, JSON-LD | no |
| `memora_console` | Page console logs | optional clear |
| `memora_reload` | Reload the page | yes |
| `memora_eval` | Run arbitrary JavaScript in the page | yes |
| `memora_storage` | Read and write localStorage / sessionStorage | yes |
| `memora_cookies` | List, set and clear cookies | yes |
| `memora_session` | Save or load a session file | yes (filesystem) |
| `memora_fork` | Clone the page and switch to the clone | yes |
| `memora_handoff` | Let a person complete a CAPTCHA or bot check in a visible window (0.1.2+) | yes (switches engine on success) |
| `memora_firewall` | Show the prompt injection firewall's rules and recent activity; cannot change them (0.2.0+) | no |

**Challenge pages (0.1.2+).** When a page is a CAPTCHA interstitial, block page or 429, `memora_browse`, `memora_act`, `memora_fill_form` and `memora_reload` return a `# CHALLENGE DETECTED` block instead of page content, and further requests to that host pause for 60 s. With `--on-challenge stop` the same text comes back as an error. See [challenges.md](./challenges.md).

### `memora_browse`

Loads a URL and returns the distilled page.

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | string | yes | URL to load. `http(s)://` and `data:` URLs work on the native engine. |
| `timeout` | number | no | Navigation timeout in ms. Default `20000`. On the Chrome engine, `--http-timeout` takes precedence when it is set. |
| `focus` | string | no | CSS selector to distil only one subtree (for example `main`, `article`). |
| `exclude` | string[] | no | CSS selectors to drop (for example `["nav", "footer", ".cookie-banner"]`). |

Returns:

```
# Page Loaded: <title> (<ms>ms)
URL: <final url> [HTTP <status>]
Token Estimate: ~<n> tokens | Interactive Elements: <n>

=== INTERACTIVE ACTION MAP (<n> elements) ===
[@1] [link] "..." href="..." (selector: ...)
...

--- Distilled Content ---
<Markdown, truncated at 4,000 characters with "... [content truncated]">
```

The Markdown is **truncated at 4,000 characters**. To read more of a long page, call again with `focus` set to a narrower region, or use `memora_extract` or `memora_html`.

The action map is **never truncated**, and every line carries a CSS selector, often a long `nth-of-type` path. On link-dense pages one `memora_browse` result can therefore be larger than the page's raw HTML. Measured examples: Hacker News front page about 17,800 estimated tokens for the full snapshot versus about 8,700 tokens of raw HTML, and a Wikipedia article about 120,000 versus 104,000. To keep results small:

- Pass `focus` (for example `"main"`, `"article"`, `"#content"`) and `exclude` (for example `["nav", "footer", "aside", ".cookie-banner"]`) on every call to a large page.
- After the first load, use `memora_diff` or a focused `memora_inspect` instead of browsing again.
- Use `memora_extract` with a precise selector when you need specific data, not the whole page.

When `focus` or `exclude` is set, the action IDs in that output are numbered within the filtered view, and `memora_act` and `memora_fill_form` resolve `@N` to the element shown with that number in the filtered output.

The tool descriptions returned by `tools/list` say that the output usually uses far fewer tokens than raw HTML. On the project's four benchmark pages the reduction was 33–40%; on link-dense pages it can be smaller or negative, as shown above.

### `memora_act`

Clicks or types on one element.

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `actionId` | string | yes | `@N` from the latest action map, or a locator ([locators.md](./locators.md); Playwright syntax on the Chrome engine). |
| `type` | `"click"` \| `"type"` | yes | Action to perform. |
| `text` | string | for `type` | Text to set. On a `<select>`, the matching option is chosen. |

Returns `Successfully performed "<type>" on <actionId>.`, then the current URL, title and the **full new action map**.

- On the native engine a click performs the browser's **default action**: links are followed, submit buttons submit their form, checkboxes and radios toggle, `<option>`s are selected. The SDKs' `act()` behaves the same way.
- If the target is not found, the native engine returns `isError` with `Element "<target>" not found` for clicks and `Could not type into element "<target>"` for typing.
- On the Chrome engine, a `@N` that is not in the latest snapshot fails with a hint to call `memora_inspect`. After each action the engine waits 600 ms for transitions.

### `memora_fill_form`

Fills several fields in one call.

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `fields` | object (string → string) | yes | Locator → value. Checkboxes and radios accept `true`/`1`/`yes`/`checked`/`on`. |
| `submitActionId` | string | no | Locator of the button (or `form`) to activate after filling. **If omitted, the form is not submitted.** |

Returns `Form fill completed! Filled <n> field(s)[, submitted form].`, then the URL, title and new action map.

Fields whose locator matches nothing are skipped silently. The skipped list is not included in the MCP response. Compare the count with the number of fields you sent.

### `memora_diff`

No inputs. Returns the diff summary between the previous snapshot and now:

```
=== PAGE STATE DELTA ===
URL navigated: "..." -> "..."
Title changed: "..." -> "..."

Added (2 elements):
  + [@5] [select] "State" (selector: #state)
Removed (0 elements): ...
Mutated (1 elements):
  * [@3] [checkbox] "Remember me" (checked: undefined -> true)
```

The baseline is set by `memora_browse`, `memora_reload`, `memora_inspect`, `memora_diff` itself, and a resolved `memora_handoff`. `memora_act` and `memora_fill_form` do **not** move it, so `memora_diff` after one or more actions shows everything those actions changed. It is also useful after `memora_eval`, `memora_storage` or a wait.

> **Changed in 0.2.0:** in 0.1.x, `memora_act` and `memora_fill_form` reset the baseline, so `memora_diff` right after them usually reported no changes.

### `memora_inspect`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `focus` | string | no | CSS selector to scope the action map. |

Returns the title, URL, interactive count and the action map. No Markdown.

`@N` numbers from a **focused** inspection are counted within the focused subtree, and `memora_act` resolves them to the elements shown in that inspection.

### `memora_extract`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `selector` | string | yes | CSS selector (for example `table tr`, `a.result`, `.price`). |
| `attribute` | string | no | `text` (trimmed text), `html` (innerHTML), or any attribute name (`href`, `src`, `value`, ...). |
| `limit` | number | no | Maximum elements. Default `50`. |

Returns a JSON array. Without `attribute`, each item is `{ "tag", "text", "attributes" }` on the native engine. Missing attributes come back as `null`.

### `memora_html`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `selector` | string | no | CSS selector. When omitted, the whole document is returned. |

Returns raw HTML (`outerHTML`), or `Element "<selector>" not found.`. The whole document starts with `<!DOCTYPE html>`. Whole-document HTML is not truncated and can be very large. Prefer a selector.

### `memora_metadata`

No inputs. Also callable as `memora_structured_data`. Returns JSON:

```json
{
  "url": "...", "title": "...", "description": "...", "canonical": "...",
  "openGraph": { "og:title": "..." },
  "twitter":   { "twitter:card": "..." },
  "meta":      { "robots": "index,follow" },
  "jsonLd":    [ { "@type": "Product" } ]
}
```

### `memora_console`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `clear` | boolean | no | Clear the buffer after reading. Default `false`. |

Returns lines formatted as `[ISO time] [LEVEL] message`, or `No console logs recorded.`. On the native engine the buffer includes script load failures, scripts terminated after 5 s, and uncaught errors (for example `alert is not defined`, because `alert()` is not available on the native engine). The buffer is per document and is replaced on navigation.

### `memora_reload`

No inputs. Reloads the current URL. Returns the duration, HTTP status, title, element count and action map.

### `memora_eval`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `code` | string | yes | JavaScript expression or statements, evaluated in the page. |

Both engines return plain values: a string comes back as-is (`Example Domain`), and any other value as JSON (`{"a": 1}`, `42`, `true`). If the code returns a promise (for example `fetch(...).then(r => r.status)` or an async function), the tool waits for it.

On the native engine, the code itself runs synchronously in the page's sandbox with a **5-second timeout**, and a returned promise is awaited for up to **10 seconds**. After that the tool returns an error, `Timed out waiting for the promise`. An exception, or a rejected promise, comes back as a tool error (`isError: true`) with its message.

On the Chrome engine, the code goes to Playwright's `page.evaluate`.

> **Changed in 0.2.0:** in 0.1.x the native engine did not await promises and wrapped results in `{ "type": "...", "value": ... }` (errors as `{ "error": "..." }`). If you parse `memora_eval` output, read the plain value instead.

See [Security](#security) before enabling this tool for untrusted prompts.

### `memora_storage`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `storage` | `"local"` \| `"session"` | no | Default `local`. |
| `action` | `"get"` \| `"set"` \| `"remove"` \| `"clear"` \| `"list"` | yes | Operation. |
| `key` | string | get/set/remove | Key name. |
| `value` | string | set | Value. |

A common use is pre-authenticating a single-page app: `set` a token key, then `memora_reload`.

### `memora_cookies`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"list"` \| `"set"` \| `"clear"` | yes | Operation. |
| `name` | string | set | Cookie name. |
| `value` | string | set | Cookie value. |

Native engine: cookies are scoped like in a browser (domain, path, `Secure`, expiry), so a cookie from one site is not sent to other sites. `list` shows the cookies for the current site, `set` sets a cookie for the current site, and `clear` removes all cookies.

On the Chrome engine, `set` also scopes the cookie to the current page's hostname, and `clear` works the same way.

### `memora_session`

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"save"` \| `"load"` | yes | Operation. |
| `path` | string | yes | A `.json` file path on the machine running the MCP server, resolved relative to the folder the server was started in (or `ORBIS_SESSION_DIR`, if set). Paths outside that folder, or not ending in `.json`, are refused with a tool error. |

`save` writes cookies, `localStorage` and `sessionStorage` (version-1 JSON, see [sessions-and-auth.md](./sessions-and-auth.md)) and creates parent directories. `load` restores them into the current page and does not navigate. Session files contain authentication cookies in plain text.

### `memora_fork`

No inputs. Clones the current page and **switches the active page to the clone**. There is no tool to switch back. The original page stays in memory until the server exits.

- Native engine: copies the URL, the serialized DOM, cookies and storage. **JavaScript state and event listeners are not copied.** A button wired up by a script will do nothing in the fork until the page is reloaded.
- Chrome engine: opens a new tab and re-navigates to the same URL. This is a fresh load, so unsaved form input and client-side state are lost.

Use it to try a risky path when you can afford to lose the original. To return to the original state, save a session before forking and reload the page afterwards.

### `memora_handoff`

> **Availability:** added in 0.1.2.

| Input | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"start"` \| `"status"` \| `"cancel"` | yes | `start` opens the window, `status` checks progress once (non-blocking), `cancel` closes the window |
| `url` | string | no | Page to open. Default: the page where the last challenge was detected |

Opens the page in a **visible** Chrome/Edge window so the user can complete a CAPTCHA or bot check themselves. The agent should tell the user to do so, then poll `status`. Orbis does not interact with the window. When the state becomes `resolved`, the server's active engine **switches to that window** (the previous engine is closed) and the result includes the new page's action map. Later tool calls run in the visible window.

Outputs: `Handoff started: …`, `Handoff state: waiting | expired | cancelled | unavailable | idle` (with `Reason:` where relevant), or `Handoff resolved: …`.

- Timeout: `--handoff-timeout <sec>` (default 300).
- `unavailable` without a display (Linux servers, containers) or without Chrome/Edge.
- Cookies from the native engine are not carried into the window.

Full behaviour: [challenges.md](./challenges.md#5-human-handoff-mcp).

---

## Protocol details

| Item | Value |
| :--- | :--- |
| Transport | stdio, newline-delimited JSON-RPC 2.0 (one message per line, no `Content-Length` framing) |
| `protocolVersion` returned by `initialize` | The version the client asks for, from `2024-11-05` up to `2025-11-25`; for an unknown version, the newest one supported |
| `serverInfo` | `{ "name": "orbis-browser", "version": "0.2.0", "title": "Orbis by Memora" }` |
| Capabilities | `tools` only (no resources, prompts, sampling or logging) |
| Methods implemented | `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` |
| Unknown method | JSON-RPC error `-32601 Method not found` |
| Unparseable line | JSON-RPC error `-32700` with `id: null` |
| Shutdown | `SIGINT` / `SIGTERM` close the engine and exit. On the Chrome engine this closes Chrome. |

Tool calls run **one at a time, in the order they arrive**. A client that sends a second `tools/call` before the first finishes gets it run after the first one completes, so piping a `memora_browse` and a `memora_act` back-to-back works as expected.

## Testing the server by hand

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memora_browse","arguments":{"url":"https://example.com"}}}' \
| ORBIS_NO_TELEMETRY=1 npx -y @memoracompany/memora-orbis --mcp --engine native
```

Expected: three JSON lines. The second lists 17 tools, and the third contains `# Page Loaded: Example Domain`. The process stays alive until stdin closes or you press Ctrl+C.

A scripted test client is in [`examples/06-mcp-server/test_mcp_client.ts`](../examples/06-mcp-server/). The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) also works:

```bash
npx @modelcontextprotocol/inspector npx -y @memoracompany/memora-orbis --mcp --engine native
```

---

## Security

Giving a model these tools gives it a browser, a JavaScript console and limited filesystem access **on the machine running the server**. Treat every page the model reads as untrusted input that can contain prompt-injection text.

| Risk | Detail | Mitigation |
| :--- | :--- | :--- |
| Arbitrary JavaScript | `memora_eval` runs any code in the page context. A prompt-injected instruction could read tokens from storage and send them to another site with `fetch`. | Disable or require approval for `memora_eval` in your client's tool permissions. Keep "always allow" off for it. |
| Filesystem read and write | `memora_session` reads and writes `.json` files, but only inside the folder the server was started in (or `ORBIS_SESSION_DIR`). `save` can overwrite a session file there. | Start the server in a dedicated folder, or set `ORBIS_SESSION_DIR`. Require approval for `memora_session`. |
| Secrets in context | Values typed with `memora_act` or `memora_fill_form` are hidden in later action maps (`[FILLED]`) and diff summaries, and password values are never included. They are still in the page, so `memora_html` and `memora_eval` can return them. | Do not let the model type real secrets. Pre-authenticate with `memora_session load` or `memora_storage set` from a prepared file instead. |
| Internal network access | The server can fetch `localhost`, intranet hosts and cloud metadata endpoints (`169.254.169.254`). | Run it where it cannot reach sensitive internal services. Do not run it on servers that hold cloud credentials. |
| Robots and terms of service | The server does not check `robots.txt` unless told to. | Add `--obey-robots` and an honest `--user-agent` for crawling-style tasks. |
| Version check | On start-up the CLI contacts `orbis.memora.company` unless `ORBIS_NO_TELEMETRY` is set. | Set `ORBIS_NO_TELEMETRY=1`. |

The 0.2.0 [prompt injection firewall](./prompt-injection-firewall.md) covers several of these risks inside Orbis itself: `--firewall standard` makes `memora_eval`, `memora_cookies`, `memora_storage`, `memora_session` and form submits ask you first, and `--allow-domain` / the built-in sensitive-site list keep the agent away from internal addresses, webmail and banking.

See [security.md](./security.md) for the full hardening guide.

## Troubleshooting

| Symptom | Cause and fix |
| :--- | :--- |
| `npm error 404 Not Found - memora-orbis` | Wrong package name. Use `@memoracompany/memora-orbis`. |
| Server shows as failed or disconnected immediately | Node.js older than 20, or `npx` not on the client's `PATH` (common for GUI apps on macOS and Windows). Use an absolute path to `npx`/`orbis`, or install globally. |
| `--engine chrome needs Google Chrome or Microsoft Edge installed` | `--engine chrome` on a machine without Chrome or Edge at the known paths. Install one, or use `--engine native`. |
| Locators like `label:Email` fail | You are on the Chrome engine (the default when Chrome is installed). Use `@N`, Playwright selectors, or `--engine native`. |
| Pages look empty | The site renders everything client-side and the native engine could not execute it. Check `memora_console`, then try `--engine chrome`. |
| Page content cut off | `memora_browse` truncates Markdown at 4,000 characters. Use `focus`, `memora_extract` or `memora_html`. |
| `# CHALLENGE DETECTED` / `Requests to <host> are paused` (0.1.2+) | The site served a CAPTCHA, bot check, block page or 429. Wait, or use `memora_handoff` so the user can complete it. See [challenges.md](./challenges.md). |
| `memora_handoff` returns `unavailable: no display` | The server runs where no window can be shown (Linux server or container). Run the MCP server on the user's desktop. |

More in [troubleshooting.md](./troubleshooting.md).

## Known issues

> **Known issue (0.1.0):** `--engine auto` silently switches to Chrome when Chrome or Edge is installed, so behaviour differs between machines. Pin `--engine native` or `--engine chrome` in shared configurations.

See also: [cli-reference.md](./cli-reference.md), [locators.md](./locators.md), [concepts.md](./concepts.md), [security.md](./security.md), [use-cases.md](./use-cases.md).
