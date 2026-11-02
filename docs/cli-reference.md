# CLI Reference

This page documents every command, flag, environment variable and exit code of the `orbis` command-line tool. The behaviour described here comes from the source, not from marketing copy. Where a flag is accepted but does nothing useful, or has a known bug, that is called out explicitly.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Installing and invoking the CLI](#installing-and-invoking-the-cli)
- [Command overview](#command-overview)
- [Root command: `orbis`](#root-command-orbis)
- [`orbis serve`](#orbis-serve)
- [`orbis fetch`](#orbis-fetch)
- [Flag reference](#flag-reference)
- [Flag precedence and mode selection](#flag-precedence-and-mode-selection)
- [Startup banners and endpoints](#startup-banners-and-endpoints)
- [Environment variables](#environment-variables)
- [Exit codes and signals](#exit-codes-and-signals)
- [Version check (network call on startup)](#version-check-network-call-on-startup)
- [Recipes](#recipes)
- [Known issues](#known-issues)

---

## Installing and invoking the CLI

The npm package `@memoracompany/memora-orbis` installs three binary names that all run the same program:

| Binary | Status |
| :--- | :--- |
| `orbis` | Primary name. Use this. |
| `memora-orbis` | Alias. Works only after the package is installed (it is a binary name, **not** an npm package name). |
| `memora-browser` | Deprecated alias. Prints a deprecation warning to stderr and will be removed in v2.0. |

```bash
# One-off, no global install (npx picks the "orbis" binary)
npx -y @memoracompany/memora-orbis --version

# Global install
npm install -g @memoracompany/memora-orbis
orbis --version

# Local project install
npm install @memoracompany/memora-orbis
npx orbis --version
```

> Do not run `npx memora-orbis`. There is no npm package called `memora-orbis`, so npx fails with a 404. `memora-orbis` is the name of the **Python** package on PyPI.

Requirements: Node.js 20 or 22 (the versions the project's CI tests against).

---

## Command overview

```text
orbis [options]                 Start the CDP (default) or WebDriver server, or run --eval / --mcp
orbis serve [options]           Start the CDP or WebDriver server (same as the root command, minus --eval/--mcp)
orbis fetch [options] <url>     Load one URL and print it as Markdown, HTML, action map or structured data
orbis firewall scan <url>       (0.2.0+) Check a page for prompt-injection text
orbis firewall verify <file>    (0.2.0+) Check that a firewall activity log was not edited
orbis firewall policy [options] (0.2.0+) Print the firewall settings that your flags produce
```

Global options available everywhere: `--help` prints help; `-V, --version` (root only) prints the installed version, for example `0.2.0`.

---

## Root command: `orbis`

Running `orbis` with no command does one of four things, depending on the flags:

| Flags | Mode | What happens |
| :--- | :--- | :--- |
| `--mcp` | MCP server | Speaks JSON-RPC (Model Context Protocol) on stdin/stdout. No port is opened. See [mcp.md](./mcp.md). |
| `--protocol webdriver` | WebDriver server | Starts a W3C WebDriver HTTP server for Selenium. See [selenium-webdriver.md](./selenium-webdriver.md). |
| `--eval <url>` | One-shot | Loads the URL, prints the action map and the first 1,000 characters of Markdown, then exits. |
| _(none of the above)_ | CDP server | Starts the Chrome DevTools Protocol server plus the REST agent endpoints. See [playwright-puppeteer.md](./playwright-puppeteer.md) and [http-api.md](./http-api.md). |

```bash
# CDP server on localhost:9222 (the default)
orbis

# CDP server on another port
orbis --port 9333

# WebDriver server for Selenium
orbis --protocol webdriver --port 9515

# One-shot distillation of a page
orbis --eval https://example.com

# MCP server for Claude Desktop / Cursor / other MCP clients
orbis --mcp
```

Accepted options: all [server options](#server-options), all [network options](#network-options), plus `--eval <url>` and `--mcp`.

---

## `orbis serve`

`orbis serve` starts the same server as the root command. It exists so scripts can be explicit. It accepts the [server options](#server-options) and [network options](#network-options), but **not** `--eval` or `--mcp` (passing them is an "unknown option" error).

Options placed after `serve` belong to `serve` (the CLI enables positional options), so `orbis serve --port 9333` behaves as expected.

```bash
orbis serve                                  # CDP on :9222
orbis serve --port 9333                      # CDP on :9333
orbis serve --protocol webdriver --port 9515 # Selenium on :9515
orbis serve --protocol webdriver --max-sessions 4
```

---

## `orbis fetch`

`orbis fetch <url>` loads a single page (running its scripts, like a navigation does) and writes one representation of it to stdout, then exits. It never opens a port and never performs the [version check](#version-check-network-call-on-startup).

```text
orbis fetch [options] <url>
```

### Fetch-specific options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `-d, --dump <format>` | string | `markdown` | Output format (see table below). Case-insensitive. Unknown values silently fall back to Markdown. |
| `--dump-selector <selector>` | CSS selector | _(none)_ | Replace the output with the **first** element matching this CSS selector. For `html` the element's `outerHTML` is printed; for every other format its trimmed `textContent` is printed (not Markdown). If nothing matches, prints `[Selector "<selector>" not found]` and still exits 0. Only plain CSS is accepted here, not [Orbis locators](./locators.md). |
| `--dump-max-bytes <n>` | integer | _(no limit)_ | Truncate the output to `n` characters (JavaScript string length, so not strictly bytes for non-ASCII text) and append `... [truncated by --dump-max-bytes]`. Applied after `--dump-selector`. |
| `--wait-ms <ms>` | integer | _(none)_ | Extra wait after the page load. The load itself already waits up to 5 s for the page's fetch/XHR/short timers to settle. |
| `--no-stealth` | flag | stealth on | Disables the JavaScript fingerprint script. See [stealth.md](./stealth.md). |
| `-h, --help` | flag | | Help for `fetch`. Note: inside `fetch`, `-h` means help. On the root command and `serve`, `-h` means `--host`. |

All [network options](#network-options) are also accepted.

### Dump formats

| `--dump` value | Alias | Output |
| :--- | :--- | :--- |
| `markdown` | `md` | Token-efficient Markdown of the visible content. |
| `html` | | The serialized DOM **after** scripts ran (not the raw HTTP response body), starting with `<!DOCTYPE html>`. |
| `structured_data` | `metadata` | Pretty-printed JSON: `url`, `title`, `description`, `canonical`, `openGraph`, `twitter`, `meta`, `jsonLd`. |
| `action_map` | `semantic_tree` | A header with title, URL, token estimate and action count, followed by the numbered action map. Both names produce identical output. The token estimate is `ceil(characters / 4)` over title, action map and Markdown, not a tokenizer count, and on link-dense pages it can exceed the raw HTML (each line carries a full CSS selector). See [best-practices.md](./best-practices.md) for keeping prompts small. |

> **Changed in 0.2.0:** in 0.1.x, `--dump html` output was wrapped in `<#document>` ... `</#document>` tags. It is now plain HTML that starts with `<!DOCTYPE html>`, so remove any code that strips the wrapper.

### Fetch examples

```bash
# Markdown (default)
orbis fetch https://example.com

# Numbered action map, ready to paste into an LLM prompt
orbis fetch https://example.com --dump action_map

# SEO / social metadata as JSON
orbis fetch https://example.com --dump structured_data > meta.json

# Only the article body, as text, max 4,000 characters
orbis fetch https://blog.example.com/post --dump-selector "article" --dump-max-bytes 4000

# Outer HTML of one element
orbis fetch https://example.com --dump html --dump-selector "main"

# Respect robots.txt, identify as your own bot, custom header
orbis fetch https://example.com --obey-robots --robots-agent AcmeResearchBot \
  --user-agent "AcmeResearchBot/1.0 (+https://acme.example/bot)" \
  --http-header "From: bots@acme.example"

# Staging server with a self-signed certificate
orbis fetch https://staging.internal --insecure-disable-tls-host-verification

# Through a corporate proxy taken from the environment
HTTPS_PROXY=http://proxy.corp:3128 orbis fetch https://example.com --use-env-proxy
```

Exit status: 0 on success, 1 if the request itself fails (DNS, TLS, timeout, robots.txt block, invalid flag), with `Fetch error: <reason>` on stderr.

> **Changed in 0.2.0:** `orbis fetch` exits 1 when the page answers with HTTP 4xx or 5xx. The page is still printed to stdout, and a line `HTTP <status> from <url>` goes to stderr. Earlier versions exited 0.

From 0.1.2, Orbis also prints a `# CHALLENGE DETECTED` block to stderr when the page is a CAPTCHA/bot challenge, block page or 429 (exit stays 0), and exit 1 for it with `--on-challenge stop` or while the host is in cooldown. See [challenges.md](./challenges.md).

---

## Flag reference

### Server options

Accepted by the root command and `serve`.

| Option | Type | Default | Applies to | Description |
| :--- | :--- | :--- | :--- | :--- |
| `-p, --port <number>` | integer | `9222` | CDP, WebDriver | TCP port. The same default is used for both protocols, so pass `--port 9515` (or any free port) explicitly for WebDriver if you also run a CDP server. |
| `-h, --host <string>` | string | `localhost` | CDP, WebDriver | Host name used in printed URLs and for binding. See the bind warning below. |
| `--protocol <protocol>` | `cdp` \| `webdriver` | `cdp` | server | Which automation protocol to serve. Any other value exits with `Unknown --protocol`. |
| `--engine <engine>` | `auto` \| `native` \| `chrome` | `auto` | **`--mcp` only** | Backend for the MCP server. `native`: the built-in Orbis engine. `chrome`: a headless system Chrome/Edge driven through Playwright. `auto`: Chrome/Edge if one is found at a known install path, otherwise native. Ignored in CDP, WebDriver, `--eval` and `fetch` modes, which always use the native engine. |
| `--max-sessions <number>` | integer | `16` | **WebDriver only** | Maximum concurrent WebDriver sessions. When reached, `POST /session` fails with `session not created`. Ignored by the CDP server. |
| `--session-idle-timeout <sec>` | integer ≥ 0 | `300` | **WebDriver only** | Added in 0.2.0. Close a WebDriver session after this many seconds without a command. `0` turns the idle timeout off. |
| `--no-stealth` | flag | stealth on | CDP, WebDriver, `--eval` | Disable the JavaScript fingerprint script. Ignored in `--mcp` mode (the MCP native engine always enables stealth). Does not change HTTP headers. See [stealth.md](./stealth.md). |
| `--eval <url>` | URL | | root only | One-shot mode (see above). |
| `--mcp` | flag | | root only | MCP stdio mode (see above). |
| `--handoff-timeout <sec>` | integer ≥ 10 | `300` | root only, with `--mcp` | Added in 0.1.2. Seconds a person gets to complete a check in the `memora_handoff` window. Invalid values exit 1. See [challenges.md](./challenges.md#5-human-handoff-mcp). |
| `--firewall <level>` | `off` \| `standard` \| `strict` | `off` | root, `serve` | Added in 0.2.0. Turn on the [prompt injection firewall](./prompt-injection-firewall.md). With CDP or WebDriver only the site rules apply. |
| `--firewall-policy <file>` | path | | root, `serve` | Added in 0.2.0. Firewall settings from a JSON file; other flags override it. |
| `--firewall-mode <mode>` | `enforce` \| `monitor` | `enforce` | root, `serve` | Added in 0.2.0. `monitor` logs what would be blocked and blocks nothing. |
| `--firewall-allow <action>` | action, repeatable | | root, `serve` | Added in 0.2.0. Let this action run without asking. Actions: `read`, `navigate`, `interact`, `submit`, `storage`, `cookies`, `script`, `session`, `download`. |
| `--firewall-confirm <action>` | action, repeatable | | root, `serve` | Added in 0.2.0. Ask you before this action runs. |
| `--firewall-deny <action>` | action, repeatable | | root, `serve` | Added in 0.2.0. Always refuse this action. |
| `--audit-log <file>` | path | | root, `serve` | Added in 0.2.0. Write the firewall activity log here. Set `ORBIS_AUDIT_KEY` to sign it. |
| `--confirm-timeout <sec>` | integer ≥ 5 | `120` | root, with `--mcp` | Added in 0.2.0. How long to wait for you to approve an action before refusing it. |

> **Changed in 0.2.0:** `--host localhost` (the default) and `--host 127.0.0.1` bind to `127.0.0.1` only, so other machines and containers cannot connect. To accept connections from other machines (for example in Docker or Kubernetes), pass `--host 0.0.0.0` explicitly. `--host ::1` binds to the IPv6 loopback, and printed URLs show `[::1]`. Any other `--host` value is bound as given. Read [security.md](./security.md) before running a server on a shared or public network.

WebDriver sessions that receive no command for **5 minutes** are closed automatically. Change this with `--session-idle-timeout <sec>` (`0` turns it off).

### Network options

Accepted by the root command, `serve` and `fetch`. They configure every HTTP request the engine makes: navigations, `<script src>` downloads and `fetch()`/XHR from page scripts. In `--mcp` mode they are passed to the selected MCP engine.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--http-proxy <url>` | URL | | Send all traffic through this proxy. `http://` sites are sent as plain forward-proxy requests, `https://` sites through `CONNECT`. It also prints an Orbis Cloud notice to stderr, which you can ignore. In the SDK, use the `network.proxy` option of the [TypeScript SDK](./typescript-sdk.md). |
| `--proxy-bearer-token <token>` | string | | Sends `Proxy-Authorization: Bearer <token>` to an `http://`/`https://` proxy set with `--http-proxy` or `--use-env-proxy`. Rejected with SOCKS proxies; ignored by the Chrome MCP engine. |
| `--proxy-bypass <hosts>` | comma list | | Hosts that skip the proxy, NO_PROXY syntax: `*`, `example.com` (host and subdomains), `.example.com` / `*.example.com` (subdomains), `host:port`. |
| `--use-env-proxy` | flag | off | Use `HTTPS_PROXY` (https URLs) or `HTTP_PROXY` (http URLs), falling back to `ALL_PROXY`; honour `NO_PROXY`. Lower-case variants are also read. Supported schemes: `http://`, `https://`, `socks5://`, `socks5h://`, `socks://`. Credentials go in the URL (`http://user:pass@host:3128`). |
| `--http-header <header>` | `"Name: Value"`, repeatable | `[]` | Extra header on every request, to **every host**. Overrides the built-in browser headers of the same name. A value without a colon exits with `Invalid --http-header`. Do not put secrets here unless every host you visit should receive them. |
| `--user-agent <ua>` | string | Chrome 130 on Windows UA | Overrides the `User-Agent` request header and `navigator.userAgent` in page scripts. Chrome client-hint headers are dropped when the value is not a Chrome User-Agent. |
| `--http-timeout <ms>` | integer | 20000 for navigations | Navigation timeout in milliseconds. A timeout passed to an individual call (for example `goto(url, { timeoutMs })`) takes precedence. |
| `--insecure-disable-tls-host-verification` | flag | off | Accept invalid/self-signed TLS certificates (also for proxy connections). Use only for staging or intercepting proxies. |
| `--obey-robots` | flag | off | Fetch `/robots.txt` for every origin and refuse disallowed requests (RFC 9309). Applies to navigations, redirect hops, scripts and page `fetch()`. Honours `Crawl-delay` (capped at 60 s) between requests to the same site. Rules are cached per origin for 24 h. A 4xx robots.txt means "allow all"; a 5xx or network error means "disallow all". Blocked requests fail with `Blocked by robots.txt: <url> (rules from <robots url>)` and a `[Memora] blocked by robots.txt: <url>` line on stderr. See [network-and-proxies.md](./network-and-proxies.md). |
| `--robots-agent <token>` | `[A-Za-z_-]+` | `MemoraBrowser` | Product token matched against `User-agent:` lines in robots.txt. Letters, `_` and `-` only; anything else exits with `Invalid --robots-agent`. |
| `--on-challenge <mode>` | `report` \| `stop` | `report` | Added in 0.1.2. What navigation does on a blocking CAPTCHA/bot challenge, block page or 429. `report` loads it and flags it; `stop` fails the navigation (`fetch` exits 1). Other values exit 1. See [challenges.md](./challenges.md). |
| `--challenge-cooldown <sec>` | integer ≥ 0 | `60` | Added in 0.1.2. Pause requests to a host for this long after a blocking challenge or 429. The site's `Retry-After` takes precedence; `0` disables. |
| `--allow-domain <site>` | site, repeatable | | Added in 0.2.0. Only open pages on these sites (and their subdomains). `*.example.com` = subdomains only; `example.com/app` = that path only. See [prompt-injection-firewall.md](./prompt-injection-firewall.md#choosing-where-your-agent-can-go). |
| `--block-domain <site>` | site, repeatable | | Added in 0.2.0. Refuse every request to these sites, including background requests from page scripts. |
| `--block-sensitive-domains` | flag | off | Added in 0.2.0. Refuse webmail, banking and payment sites, account settings, cloud consoles, admin pages and cloud credential addresses. On automatically with `--firewall standard` or `strict`. |

> **Changed in 0.2.0:** `--http-proxy` now routes traffic through the given proxy (earlier versions only printed a notice), and `--http-timeout` now limits navigations with the native engine (earlier versions always used 20,000 ms).

---

## Flag precedence and mode selection

The root command checks flags in this order; the first match wins:

1. `--mcp`: starts the MCP server. `--port`, `--host`, `--protocol`, `--eval` and `--no-stealth` are ignored.
2. `--protocol webdriver`: starts the WebDriver server. `--eval` is ignored.
3. Any other `--protocol` value than `cdp`: exits 1.
4. `--eval <url>`: one-shot, then exits.
5. Otherwise: CDP server.

Network options are parsed and validated first in every mode, so an invalid `--http-header` or `--robots-agent` exits 1 before anything starts.

---

## Startup banners and endpoints

### CDP mode

The banner is printed to stdout once the port is listening:

| Banner line | Meaning |
| :--- | :--- |
| `CDP WebSocket: ws://<host>:<port>/devtools/browser/memora-root` | Browser-level WebSocket. Any path under `/devtools/` is accepted; `/devtools/page/<id>` targets a specific page. |
| `Discovery Endpoint: http://<host>:<port>/json/version` | What Playwright/Puppeteer call first. Also the health-check URL. |
| `Agent Snapshot: http://<host>:<port>/orbis/snapshot` | REST agent endpoint (also `/memora/snapshot`). See [http-api.md](./http-api.md). |
| `Memory Footprint: ~N MB` | Resident set size of the Node.js process at startup (the "Chromium uses ~350MB+" text next to it is a fixed string, not a measurement). |
| `Proxy:` | The configured proxy (credentials hidden), or `Direct` when no proxy is set. |
| `Stealth Mode:` | `ACTIVE` unless `--no-stealth`. |

### WebDriver mode

| Banner line | Meaning |
| :--- | :--- |
| `WebDriver URL: http://<host>:<port>` | Use as Selenium's `command_executor`. The legacy `/wd/hub` prefix is also accepted. |
| `Status: http://<host>:<port>/status` | W3C status endpoint; `ready` is `false` once `--max-sessions` is reached. |
| `Max Sessions:` | The `--max-sessions` value. |

### `--eval` mode

Prints the fetch-and-distill time, title, interactive element count, estimated prompt tokens (characters / 4), the full action map, and the first 1,000 characters of Markdown. Example against a local fixture:

```text
🔍 [Orbis] Fetching & Distilling: http://127.0.0.1:18090/ ...

✨ Successfully distilled in 33.0ms!
📌 Title: Signup
🎯 Interactive Elements: 4
🧠 Estimated Prompt Tokens: 97

=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "Work email" placeholder="Work email" (selector: #email)
[@2] [select] "--India" type="select" (selector: #country)
[@3] [input] "[Untitled input]" type="checkbox" (selector: input[name="terms"])
[@4] [button] "Create account" type="submit" (selector: [data-testid="go"])

--- Distilled Content ---
# Create your account
 -- India I agree Create account
```

The same fixture with `orbis fetch http://127.0.0.1:18090/ --dump action_map`:

```text
# Title: Signup
URL: http://127.0.0.1:18090/
Tokens: ~97 | Actions: 4

=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "Work email" placeholder="Work email" (selector: #email)
...
```

Timings and token counts depend on the page and machine. Real sites vary; `https://example.com`, for instance, currently serves Orbis a minimal page with very few elements.

### `--mcp` mode

Prints nothing on stdout except JSON-RPC responses (stdout is the protocol channel). Startup messages, including the [update notice](#version-check-network-call-on-startup), go to stderr.

---

## Environment variables

| Variable | Read by | Effect |
| :--- | :--- | :--- |
| `ORBIS_NO_TELEMETRY` | root / `serve` | Any non-empty value disables the startup [version check](#version-check-network-call-on-startup). Recommended for production, CI and MCP. |
| `NODE_ENV=test` | root / `serve` | Also disables the version check. |
| `ORBIS_API_KEY`, `MEMORA_API_KEY` | CDP server, WebDriver server, TypeScript SDK, Python SDK | API key for the CDP/REST and WebDriver servers. When set, every HTTP request and CDP WebSocket connection must send it (`x-api-key: <key>`, `Authorization: Bearer <key>` or `?apiKey=<key>`), otherwise the server answers 401. The WebDriver server also accepts `Authorization: Basic` with the key as the password, so Selenium can use `http://orbis:<key>@127.0.0.1:9515`. See [security.md](./security.md) and [selenium-webdriver.md](./selenium-webdriver.md#api-key). |
| `ORBIS_SESSION_DIR` | CDP server, MCP server | Folder for session files read and written by the session endpoints and the `memora_session` tool. Default: the folder the server was started in. |
| `DEBUG_CDP` | CDP server | Logs each incoming CDP request, outgoing response and event (id, method, session) to **stdout**. |
| `DEBUG_WEBDRIVER` | WebDriver server | Logs each request (method, path, first 200 characters of the body) to **stderr**. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and lower-case) | all modes | Used only with `--use-env-proxy`. |
| `LOCALAPPDATA` | `--mcp --engine auto/chrome` | Used to look for a per-user Chrome install on Windows. |

Chrome/Edge discovery for `--engine chrome|auto` checks these paths only: `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `C:\Program Files\Microsoft\Edge\Application\msedge.exe`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, `/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, `/usr/bin/chromium`, `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

---

## Exit codes and signals

| Situation | Exit code | Output |
| :--- | :--- | :--- |
| Server stopped with Ctrl+C / `SIGINT` / `SIGTERM` | 0 | CDP: `[Orbis] Shutting down browser server...`; pages and connections are closed first. |
| `--eval` finished | 0 | |
| `--eval` failed (DNS, timeout, robots block...) | 1 | `❌ Error during eval: <reason>` on stderr. |
| `--eval` page answered HTTP 4xx/5xx | 1 | The page output is still printed. |
| `fetch` succeeded (HTTP status below 400) | 0 | |
| `fetch` page answered HTTP 4xx/5xx | 1 | The page is still printed to stdout; `HTTP <status> from <url>` on stderr. |
| `fetch` request failed | 1 | `Fetch error: <reason>` on stderr. |
| Port already in use | 1 | `❌ Port N is already in use by another process.` plus a hint to use `--port N+1`. |
| Server failed to start for another reason | 1 | `❌ Could not start ... : <reason>` |
| Invalid `--http-header`, `--robots-agent` or `--protocol` | 1 | `❌ <message>` |
| Invalid `--on-challenge`, `--challenge-cooldown` or `--handoff-timeout` (0.1.2+) | 1 | `❌ <message>` |
| `fetch` hit a challenge with `--on-challenge stop`, or a host in cooldown (0.1.2+) | 1 | `Fetch error: <challenge block or cooldown message>` on stderr. |
| Unknown option / missing argument | 1 | Commander's usage error. |
| `--mcp --engine chrome` without Chrome/Edge installed | 1 | A clear error saying that `--engine chrome` needs Google Chrome or Microsoft Edge installed. Install one, or use `--engine native` or `auto`. |

Process managers (systemd, Docker, Kubernetes) can rely on `SIGTERM` for graceful shutdown. See [production-deployment.md](./production-deployment.md).

---

## Version check (network call on startup)

When the root command or `serve` starts (all modes, including `--mcp` and `--eval`; never `fetch`), Orbis sends one HTTPS request:

```text
GET https://orbis.memora.company/api/v1/version-check?v=0.2.0
```

The request is aborted after 1.5 s and all failures are ignored, so it never blocks startup. The response can print an upgrade notice or a deprecation advisory. The notice is written to stderr, so it never mixes with the MCP protocol on stdout. Disable the check with `ORBIS_NO_TELEMETRY=1` (or `NODE_ENV=test`), which you should do in air-gapped, regulated or CI environments.

---

## Recipes

```bash
# Local development: CDP server for Playwright/Puppeteer
orbis --port 9222

# Same, without the version check, with debug logging of CDP traffic
ORBIS_NO_TELEMETRY=1 DEBUG_CDP=1 orbis --port 9222

# Container: listen on all interfaces (set an API key and keep the port on a private network)
ORBIS_API_KEY=change-me orbis --port 9222 --host 0.0.0.0

# IPv6 loopback only
orbis --port 9222 --host ::1

# Selenium grid replacement for a test runner with 8 workers
ORBIS_NO_TELEMETRY=1 orbis serve --protocol webdriver --port 9515 --max-sessions 8

# MCP server, native engine, robots.txt compliant
ORBIS_NO_TELEMETRY=1 orbis --mcp --engine native --obey-robots

# Crawl behind a corporate proxy, skipping internal hosts
HTTPS_PROXY=http://user:pass@proxy.corp:3128 NO_PROXY=localhost,.corp.internal \
  orbis --use-env-proxy --port 9222

# SOCKS5 proxy
ALL_PROXY=socks5://127.0.0.1:1080 orbis fetch https://example.com --use-env-proxy

# Pre-authenticated crawling with a header sent to every host
orbis fetch https://app.example.com/dashboard --http-header "Authorization: Bearer $TOKEN" --dump markdown

# Quick health check of a running CDP daemon
curl -fsS http://127.0.0.1:9222/json/version

# Quick health check of a running WebDriver daemon
curl -fsS http://127.0.0.1:9515/status
```

---

## Known issues

There are no CLI-specific known issues in 0.2.0. For limits that apply to every mode, see the pages below.

See also: [limitations.md](./limitations.md), [troubleshooting.md](./troubleshooting.md), [security.md](./security.md).
