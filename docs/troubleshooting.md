# Troubleshooting and FAQ

This page lists the problems people commonly run into with Orbis 0.1.0. Each entry gives the symptom, the verified cause, and the fix. Search this page for the exact error message you see. If your problem is not listed, check [limitations.md](./limitations.md) to see whether the feature is supported at all.

Applies to: Orbis 0.1.1 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Installation and startup](#installation-and-startup)
- [Page content and JavaScript](#page-content-and-javascript)
- [Interacting with elements](#interacting-with-elements)
- [Python SDK](#python-sdk)
- [MCP clients](#mcp-clients)
- [Network, proxies and robots.txt](#network-proxies-and-robotstxt)
- [Playwright, Puppeteer and Selenium](#playwright-puppeteer-and-selenium)
- [Sessions](#sessions)
- [Diagnostic toolkit](#diagnostic-toolkit)
- [FAQ](#faq)

---

## Installation and startup

### `npx memora-orbis` fails with `404 Not Found`

**Cause:** there is no npm package called `memora-orbis`. `memora-orbis` is a *binary name* inside the `@memoracompany/memora-orbis` package (and the name of the PyPI package).

**Fix:**

```bash
npx -y @memoracompany/memora-orbis --version
```

Alternatively, install globally and use any of the binaries `orbis`, `memora-orbis` or `memora-browser` (the last one is deprecated):

```bash
npm install -g @memoracompany/memora-orbis
```

### `Port 9222 is already in use by another process.`

**Cause:** another process (often a real Chrome started with `--remote-debugging-port=9222`, or a second Orbis) holds the port. The CLI prints a hint and exits with code 1. `OrbisAgent.launch()` throws Node's `EADDRINUSE` error instead.

**Fix:** pick another port (`orbis --port 9223`, `OrbisAgent.launch({ cdpPort: 9223 })`) or stop the other process. Every concurrent `OrbisAgent.launch()` in one machine needs its own `cdpPort`. To find the owner:

```bash
lsof -i :9222
```

```powershell
Get-NetTCPConnection -LocalPort 9222 | Select-Object OwningProcess
```

### The daemon crashes on the first request after starting with `--host ::1`

**Cause:** IPv6 literal hosts produce invalid internal URLs in 0.1.0.

**Fix:** use an IPv4 address. For loopback-only access use `--host 127.0.0.2` (see [security.md](./security.md#21-the-server-listens-on-all-interfaces-by-default)).

### The server is reachable from other machines even though I used `--host localhost`

**Cause:** in 0.1.0, `localhost` and `127.0.0.1` are rewritten to `0.0.0.0`. **Fix:** see [security.md](./security.md#3-network-isolation).

### `Unknown --protocol "..."`

Only `cdp` (default) and `webdriver` exist: `orbis serve --protocol webdriver --port 9515`. Flags such as `--cdp 9222`, `--webdriver 9515`, `--stealth` and `--headless` **do not exist**. See [cli-reference.md](./cli-reference.md).

### `Invalid --robots-agent "...": use letters, "_" and "-" only (RFC 9309)`

The robots token cannot contain digits, spaces, `/` or dots. Use something like `AcmeResearchBot`. Put the version and contact URL in `--user-agent` instead.

## Page content and JavaScript

### The action map is empty, or content that you see in Chrome is missing

Work through these causes in order:

1. **The content is rendered by client-side JavaScript that Orbis cannot run.** Orbis executes page scripts in a lightweight DOM, not a full browser. Many modern bundles (React, Vue and Angular apps, analytics, anything using `XMLHttpRequest`, `history.pushState`, `new Event()`, `requestAnimationFrame` or `element.style`) throw and never render. See the [compatibility table](./limitations.md#2-javascript-and-dom-compatibility).
   - Check the page console: `page.getLogs()` (SDK) or `memora_console` (MCP). Look for `TypeError`, `ReferenceError` and `[MemoraDOM] Error in ... handler`.
   - **Fix:** prefer server-rendered pages. Use the site's JSON API, or a server-rendered variant of the page if the site offers one. For JavaScript-heavy pages in MCP, use the Chrome engine (`--engine chrome`).
2. **The data arrives after load.** `goto()` waits up to 5 seconds (the *settle* phase) for `fetch()` calls, their promise chains, and timers of 1 second or less. It ignores `setInterval` and longer timers.
   - **Fix:** wait explicitly:

     ```ts
     await page.goto(url);
     await page.waitForSelector('.results li', { timeoutMs: 10_000 });   // throws on timeout
     const snap = page.getSemanticSnapshot();
     ```

     You can also raise `page.settleTimeoutMs`, or call `await page.waitForIdle(8000)`.
3. **A script hit the 5-second watchdog.** The console shows `Script terminated after 5000ms`. This is not configurable. Use another URL or the site's API.
4. **The script failed to download.** The console shows `Failed to load script <url>: HTTP 403` or similar. Check headers, proxies and robots.txt.
5. **The elements are hidden.** By default, snapshots skip elements with the `hidden` attribute, `aria-hidden="true"`, `type="hidden"`, or an inline `style` containing `display:none` or `visibility:hidden` (themselves or on an ancestor). Pass `{ filterHidden: false }` to include them.
6. **`focusSelector` / `excludeSelectors`** removed the content. An invalid or non-matching `focusSelector` falls back to the whole document; `excludeSelectors` silently ignores invalid selectors.
7. **The site served different content to Orbis.** Some sites return a reduced page or a challenge page to automated clients. Compare `page.content()` with what you expect. In unreleased builds, `page.challenge()` tells you whether it was a recognised CAPTCHA, bot check or block page (see [challenges.md](challenges.md)).

### The snapshot shows menus, modals or cookie banners that are not visible in Chrome

**Cause:** Orbis does not apply CSS stylesheets. Elements hidden by a CSS class (`.hidden`, `.modal { display: none }`) look visible to Orbis. Only the `hidden` attribute, `aria-hidden` and inline `style` are understood.

**Fix:** pass `excludeSelectors` (for example `['nav', 'footer', '.modal', '#cookie-banner']`) or `focusSelector: 'main'`.

### `ReferenceError: alert is not defined` (or `confirm`, `prompt`) in the console

**Cause:** dialogs are not implemented. The click handler throws and stops at that line.

**Fix:** stub the functions before triggering the action:

```ts
page.evaluate('window.alert = () => {}; window.confirm = () => true; window.prompt = () => ""');
await page.activate('text=Delete');
```

Over CDP, register the stub with `Page.addScriptToEvaluateOnNewDocument` (Playwright: `page.addInitScript`).

### `TypeError: Cannot set properties of undefined (setting 'display')`

**Cause:** elements have no `style` object in 0.1.0, so page code such as `el.style.display = 'block'` throws. The error is logged as `[MemoraDOM] Error in <event> handler`. The rest of that handler does not run. For example, a dependent dropdown might not be populated. **Fix:** see the workarounds in [limitations.md](./limitations.md#2-javascript-and-dom-compatibility). Often the reliable route is to set the final field values directly with `fillForm`, or to call the site's API.

### Prompts are huge, or the model context overflows

**Cause:** full snapshots of link-dense pages carry one line per interactive element, often with a long positional selector. In October 2026 a Hacker News front page produced 228 actions and about 17,800 estimated tokens, against about 8,700 for its raw HTML. A Wikipedia article produced 1,230 actions and about 120,000 tokens. MCP `memora_browse` also returns up to 4,000 characters of Markdown on top of the action map.

**Fix:**
- Snapshot only the region you need: `agent.snapshot({ focusSelector: 'main', excludeSelectors: ['nav', 'footer', 'aside'] })`, or MCP `focus`/`exclude`. Remember that action IDs from focused snapshots must not be used for acting (see [`@3` clicked the wrong element](#3-clicked-the-wrong-element)).
- Send a compact list built from `snapshot.actions` (for example `@id role "text"`, without selectors), and keep the selectors in your code.
- After the first turn, send only `diff().summary`.
- Cap the Markdown length, and check `snapshot.tokenEstimate` before every model call.

See [best-practices.md](./best-practices.md) and [limitations.md](./limitations.md#snapshot-size-on-link-dense-pages).

### `Navigation timeout after 20000ms: <url>`

The default navigation timeout is 20 seconds. Raise it per call with `page.goto(url, { timeoutMs: 60_000 })`, or via the `timeout` argument of the MCP `memora_browse` tool. `--http-timeout` does **not** change it in 0.1.0 (see [network-and-proxies.md](./network-and-proxies.md#4-timeouts)).

## Interacting with elements

### Clicking a link or submit button does nothing (URL unchanged)

**Cause:** `agent.act(target)`, `page.click(target)`, REST `POST /orbis/act` and the Python SDK's `act()` only **dispatch a click event**. They do not perform browser default actions, so they don't follow links, submit forms or toggle checkboxes. **Verified:** `act('text=Go next')` returned `true`, but the URL did not change.

**Fix:**

| Interface | How to get full click behaviour |
| :--- | :--- |
| TypeScript | `await agent.page.activate(target)`. It follows links, submits forms, toggles checkboxes/radios and selects options, and returns `true` if it navigated. |
| Forms (any SDK) | `fillForm(fields, 'text=Submit')`. The submit target is activated with default actions. |
| Python / REST | For links, read the `href` from `snapshot.actions` and call `goto(href)`. For forms, use `fill_form(fields, submit=True)`. |
| MCP | `memora_act` with `type: "click"` already uses full activation |
| Playwright / Selenium | `page.click()` / `element.click()` perform default actions |

### `@3` clicked the wrong element

The action ID was resolved against a different element list than the one the model saw:

- **IDs from a focused snapshot.** Snapshots taken with `focusSelector` (MCP `focus`) number elements from `@1` inside the focused region. Action resolution always renumbers the **whole document**. **Verified:** `@1` was an input in `snapshot({ focusSelector: 'main' })`, but a navigation link in the full snapshot.
- **The page changed** between the snapshot and the action (async rendering, a previous action), so the numbering shifted.
- **The element is hidden,** and therefore not numbered.

**Fix:**
- Use action IDs only from an **unfocused** snapshot taken immediately before acting.
- Re-snapshot after every action.
- For deterministic code, use the stable `selector` field from `snapshot.actions[i].selector`, or a semantic locator such as `label:Email` or `text=Save` (see [locators.md](./locators.md)).

### Inputs appear as `"[Untitled input]"` in the action map

**Cause:** an element's text is taken from `aria-label`, `placeholder`, `title`, `value`, or its text content. The text of an associated `<label>` element is **not** used.

**Fix:** target it with `label:<label text>` in code. For an LLM, also include the Markdown (`snapshot.markdown`), where the label text appears, or the `name`/`selector` fields. Shorter `selector`s such as `#email` usually carry the meaning.

### `fillForm` submitted the form when I only wanted to fill it

**Cause:** `agent.fillForm(fields, submit = true)` defaults to `submit = true`, and so do REST `/orbis/fill-form` and the Python `fill_form()`. **Verified:** filling one field navigated to the form's action URL.

**Fix:** pass `false`, for example `agent.fillForm(fields, false)` or Python `fill_form(fields, submit=False)`.

### `fillForm` result lists fields in `skipped`

The locator did not resolve on the current page. `skipped` contains the original keys. Check the locator against the current snapshot. A field may appear only after an earlier step, in which case use `steps` (see [typescript-sdk.md](./typescript-sdk.md)).

### Typed passwords show up in snapshots and diffs

Typed values are stored in the `value` attribute and reported as `value="..."` in the action map and diff. Redact them before sending them to a model. See [security.md](./security.md#7-keeping-secrets-away-from-the-llm).

## Python SDK

### `select_option()` raises `HTTPError: HTTP Error 404: Not Found`

> **Known issue (0.1.0):** the Python SDK posts to `/orbis/select-option`, which the server does not implement.

**Workaround:** `act()` with text on a `<select>` selects the matching option (by value, exact text, then partial text):

```python
agent.act("label:Country", "India")      # instead of agent.select_option("label:Country", "India")
```

### Python SDK calls time out

**Symptom:** `TimeoutError` / `socket.timeout` / `urllib.error.URLError: <urlopen error timed out>` from `goto()` or other calls.

**Cause:** the SDK uses fixed timeouts: 5 s for `connect()`, 15 s for most calls, 10 s for `markdown()`. The daemon allows navigations up to 20 s, plus up to 5 s of settle time.

**Fix:**
- Retry the call. The daemon may still finish the navigation, and a following `snapshot()` will show the result.
- Call the REST API directly with your own HTTP client and a longer timeout:

```python
import json, urllib.parse, urllib.request
url = "http://127.0.0.1:9222/orbis/goto?" + urllib.parse.urlencode({"url": "https://slow.example.com"})
with urllib.request.urlopen(url, timeout=60) as r:
    snap = json.loads(r.read())["snapshot"]
```

### `ConnectionRefusedError` from `OrbisAgent.connect()`

The daemon is not running, or it is listening on a different host or port. Start it with `orbis --port 9222` (see [getting-started.md](./getting-started.md)). If you started it with `--host 127.0.0.2`, connect to `http://127.0.0.2:9222`.

### Two Python agents interfere with each other

Every REST call uses the daemon's single default page. Run **one daemon per agent** on different ports. See [production-deployment.md](./production-deployment.md#2-capacity-and-isolation-model).

### `ImportError: LangChain is not installed`

`to_langchain_tools()` needs `pip install langchain`. See [integrations.md](./integrations.md).

## MCP clients

### The Orbis tools do not appear in Claude Desktop, Cursor or Windsurf

Check, in order:

1. **Package name.** Use `"command": "npx", "args": ["-y", "@memoracompany/memora-orbis", "--mcp"]`. `npx memora-orbis` fails (404).
2. **Node.js on the client's PATH.** GUI apps often don't inherit your shell PATH. Use the absolute path to `npx` (`which npx` / `where npx`), or install globally and use `"command": "orbis", "args": ["--mcp"]` with an absolute path.
3. **Valid JSON** in the config file (no trailing commas). Restart the client completely after editing.
4. **The first start can be slow** while `npx` downloads the package. Run `npx -y @memoracompany/memora-orbis --version` once beforehand.
5. **Test the server by hand.** You should get two JSON responses:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx -y @memoracompany/memora-orbis --mcp --engine native
```

6. **Stray stdout output.** Add `"env": { "ORBIS_NO_TELEMETRY": "1" }`. If an update is announced, the update notice is printed on stdout, which is the MCP channel.
7. **Tool names.** Tools are listed as `memora_*` (15 tools). `orbis_*` names are accepted as aliases when called, but they are not listed. See [mcp.md](./mcp.md).

### MCP pages behave differently on my laptop and in CI

`--engine auto` (the default) uses the installed **Chrome or Edge** if it finds one, and the native engine otherwise. Pin the engine with `--engine native` or `--engine chrome` for consistent results.

## Network, proxies and robots.txt

### `Blocked by robots.txt: <url> (rules from <origin>/robots.txt)`

`--obey-robots` is on, and the URL is disallowed for your `--robots-agent` token. If the origin's `robots.txt` returned a 5xx error or could not be fetched, **everything** on that origin is disallowed for 24 hours in that process. Restart the process to clear the cache after the site recovers. See [network-and-proxies.md](./network-and-proxies.md#robotstxt).

### `--http-proxy` has no effect, and the banner mentions Orbis Cloud

`--http-proxy` is a placeholder for an upcoming managed service in 0.1.0. Use `--use-env-proxy` with `HTTPS_PROXY`/`HTTP_PROXY`, or `network.proxy` in TypeScript. See [network-and-proxies.md](./network-and-proxies.md#7-proxies).

### `... (407) â€” proxy rejected the credentials`

The proxy credentials are wrong or missing. Put `user:pass@` in the proxy URL (percent-encode special characters), or use `--proxy-bearer-token` (HTTP(S) proxies only).

### `self-signed certificate`, `unable to verify the first certificate`, `certificate has expired`

The target's TLS certificate is not trusted. Prefer `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. Use `--insecure-disable-tls-host-verification` only for staging hosts (see [security.md](./security.md#8-tls)).

### The site shows a CAPTCHA, a challenge page, or `403` to Orbis

Orbis sends Chrome-like headers and patches common `navigator` properties (see [stealth.md](./stealth.md)). It does **not** solve CAPTCHAs or JavaScript challenges, does not spoof TLS fingerprints, and its JavaScript environment differs from a real browser. Bot-protection systems can detect it. Respect the site's decision:
- use the site's official API,
- ask the site owner for access or an allowlist,
- reduce request rates,
- enable `--obey-robots`.

Do not attempt to bypass access controls you are not authorised to bypass.

## Playwright, Puppeteer and Selenium

### Screenshots are blank

There is no rendering engine. CDP `Page.captureScreenshot` returns a 1Ã—1 transparent PNG, and WebDriver screenshots return a blank PNG. Use `snapshot.markdown`, `page.content()` or the action map instead. If you need pixels, use the MCP Chrome engine or a real browser.

### Content inside an `<iframe>` or a web component's shadow DOM is missing

Iframes are not loaded. WebDriver `switch_to.frame()` raises `no such frame: Frames are not supported yet`. Shadow DOM is not supported (`element.shadowRoot` is `null`, and WebDriver raises `no such shadow root`). **Fix:** navigate directly to the iframe's `src` URL. There is no workaround for shadow DOM content in 0.1.0.

### Selenium `driver.get()` returns before the page's data has loaded

WebDriver navigation skips the settle phase. Use `WebDriverWait(driver, 10).until(EC.presence_of_element_located(...))`.

### `no such alert` from Selenium

Dialogs are not supported (see above). Stub `window.alert` with `driver.execute_script`.

### After one Playwright script finished, other clients lost their pages

`browser.close()` in a CDP client sends `Browser.close`, which closes **every** page in the daemon. Give each client its own daemon, or close only your own pages (`page.close()` / `context.close()`).

### `File uploads are not supported by Memora`

`setInputFiles` (CDP `DOM.setFileInputFiles`) is not implemented. Upload through the site's API instead.

## Sessions

| Message | Fix |
| :--- | :--- |
| `Session file not found: <path>` | The path is resolved on the machine and working directory of the process that loads it (the daemon for Python/REST, the MCP server for MCP). Use absolute paths. |
| `Unsupported session version: X. Expected version 1` | The file is not an Orbis v1 session. See the format in [sessions-and-auth.md](./sessions-and-auth.md#2-session-file-format-version-1). |
| Logged out after navigating although the session loaded | The application probably stores its token in `localStorage`, which does not survive navigation in the native engine. See [sessions-and-auth.md](./sessions-and-auth.md#8-native-engine-behaviour-you-must-know). |

## Diagnostic toolkit

| Tool | Use |
| :--- | :--- |
| `orbis fetch <url> --dump action_map` | What Orbis sees: title, token estimate, actions |
| `orbis fetch <url> --dump html` | The DOM after scripts ran |
| `orbis fetch <url> --dump structured_data` | Meta tags, OpenGraph, JSON-LD |
| `page.getLogs()` / `memora_console` | Page console output and script errors |
| `page.lastStatus`, `page.url` | HTTP status and final URL after redirects |
| `page.evaluate('typeof someGlobal')` | Check whether an API exists in the page context. Returns `{ success, result }`. |
| `DEBUG_CDP=1`, `DEBUG_WEBDRIVER=1` | Protocol tracing (see [production-deployment.md](./production-deployment.md#10-logging-and-observability)) |
| `curl http://127.0.0.1:9222/json/version` | Is the daemon alive? |
| `curl http://127.0.0.1:9515/status` | Is the WebDriver daemon alive, and does it have free sessions? |

When reporting a bug, include:
- the Orbis version (`orbis --version`), Node.js version and OS,
- the exact command or code,
- the URL (or a minimal HTML reproduction),
- the console logs,
- the output of `orbis fetch <url> --dump action_map`.

Use the bug report template in `.github/ISSUE_TEMPLATE/bug_report.md`. Report security issues privately (see [SECURITY.md](../SECURITY.md)).

## FAQ

**Does Orbis need Chrome installed?**
No. The native engine is pure Node.js (Node 20 or 22 recommended; CI tests 20.x and 22.x). Chrome or Edge is used only by the MCP server, when `--engine chrome` is set, or when `auto` finds one installed.

**Is there a `--stealth` or `--headless` flag?**
No. Stealth is on by default (`--no-stealth` turns it off), and Orbis is always headless.

**Why does `tokenEstimate` differ from my model's token count?**
It is a rough estimate: the characters of the title, action map and Markdown, divided by 4. Use your model's tokenizer for billing-grade counts.

**Can several agents share one daemon?**
Not through the REST/Python API, because all requests use one default page. Use one daemon per agent, separate CDP pages, or WebDriver sessions. See [production-deployment.md](./production-deployment.md#2-capacity-and-isolation-model).

**Does the API key protect my daemon?**
No. In 0.1.0 the server does not check it. Use network isolation and a gateway (see [security.md](./security.md)).

**How fast is `fork()`?**
`fork()` serialises the current DOM, cookies and storage, and re-parses them into a new page. On small pages it took about 5â€“6 ms in our tests; it grows with page size. JavaScript state and event listeners attached by scripts are **not** copied (see [limitations.md](./limitations.md)).

**Can Orbis download files or render PDFs?**
No. See [limitations.md](./limitations.md).

**Which numbers can I quote for performance?**
Only measured ones, with their context. On a Windows 11 laptop (Node 22, October 2026, 200 local test pages, median of three runs), Orbis loaded the pages in 0.31 s against 3.4 s for headless Chrome. With 10 tabs open it used 107 MB against 1,154 MB. On four test fixtures, distillation produced 33â€“40% fewer tokens than the raw HTML. Your results will differ; measure your own workload.

**Is Orbis free to use in production?**
No. The Community Evaluation License covers evaluation, development and proof-of-concept work. Production use requires a commercial license. See [LICENSE.md](../LICENSE.md) and [production-deployment.md](./production-deployment.md#licensing).
