# Limitations and Known Issues

This page lists what Orbis does **not** do, with the recommended workaround for each limit, and the issues known in 0.1.x that 0.2.0 fixes. Orbis is not a full browser. It is a lightweight HTML engine with a partial DOM and JavaScript environment, designed to turn pages into compact, actionable text for agents. Check this page before you commit to Orbis for a workflow. Everything here was confirmed in the source code or at runtime.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. What Orbis is good at](#1-what-orbis-is-good-at)
- [2. JavaScript and DOM compatibility](#2-javascript-and-dom-compatibility)
- [3. Rendering, layout and visibility](#3-rendering-layout-and-visibility)
- [4. Browser features not implemented](#4-browser-features-not-implemented)
- [5. Networking and storage](#5-networking-and-storage)
- [6. Protocol coverage (CDP, WebDriver, MCP)](#6-protocol-coverage-cdp-webdriver-mcp)
- [7. Forking](#7-forking)
- [8. Stealth](#8-stealth)
- [9. Scale and isolation](#9-scale-and-isolation)
- [Snapshot size on link-dense pages](#snapshot-size-on-link-dense-pages)
- [10. Issues fixed in 0.2.0](#10-issues-fixed-in-020)

---

## 1. What Orbis is good at

Use Orbis for:

- server-rendered pages (documentation, articles, catalogs, search results, admin pages, dashboards rendered on the server),
- forms built from standard HTML controls,
- extracting text, links, tables and metadata,
- giving LLM agents a compact action map.

Prefer a real browser, or the MCP Chrome engine, for:

- single-page applications built with heavy frameworks,
- pixel output,
- iframes, shadow DOM, canvas, media, file transfer and dialogs.

## 2. JavaScript and DOM compatibility

Page scripts run in a Node.js `node:vm` context with a custom DOM. The tables below show what exists in a page in every mode (SDKs, REST, WebDriver, MCP native engine and CDP), probed with `typeof` inside the page context in 0.2.0.

**Globals**

| Available | Not available (`undefined`) |
| :--- | :--- |
| `document`, `window`/`self`/`top`/`parent`, `location`, `navigator`, `screen`, `localStorage`, `sessionStorage`, `console`, `history` (`pushState`, `replaceState`, `back`, `forward`) | `WebSocket`, `Worker` |
| `setTimeout`/`setInterval` and the `clear*` functions, `queueMicrotask`, `requestAnimationFrame`, `requestIdleCallback` | `alert`, `confirm`, `prompt` |
| `fetch`, `XMLHttpRequest` (asynchronous only, built on `fetch`), `Headers`, `Request`, `Response`, `FormData`, `AbortController`, `Blob`, `URL`, `URLSearchParams` | `crypto`, `indexedDB`, `customElements` |
| `Event`, `CustomEvent`, `MouseEvent`, `KeyboardEvent` and the other event constructors, `EventTarget` | |
| `getComputedStyle` (inline style plus defaults), `matchMedia`, `IntersectionObserver`, `ResizeObserver`, `CSS`, `performance` | |
| `atob`/`btoa`, `structuredClone`, `TextEncoder`/`TextDecoder`, ECMAScript built-ins (`Promise`, `JSON`, `Intl`, `Map`, ...) | |
| `MutationObserver` (**no-op stub**: `observe()` does nothing and callbacks never fire) | |

**Element members**

| Available | Not available |
| :--- | :--- |
| `classList`, `innerHTML`, `innerText`, `textContent`, `appendChild`, `remove()`, `cloneNode()`, `addEventListener`, `getBoundingClientRect`, `closest`, `matches`, `setAttribute`/`getAttribute`, `focus`, `blur`, `querySelector(All)` | `insertAdjacentHTML`, `replaceChild`, `contentDocument` |
| `style` (inline style), `dataset`, `hidden`, `checked`, `value`, and on `<select>`/`<option>`: `value`, `selectedIndex`, `options`, `selected`, `text`, `label`, `index` | |
| `document.createElement`, `document.createDocumentFragment`, `document.querySelector(All)` | `document.cookie` |

**Consequences**

- Server-rendered pages and simple scripts work. Large framework bundles (React, Vue, Angular) may still fail on APIs that are missing or only stubbed (`MutationObserver`, `WebSocket`, real layout). Use the MCP Chrome engine for those.
- Synchronous `XMLHttpRequest` (`open(..., false)`) is not supported; requests always complete asynchronously.
- Errors appear in the page console: `page.getLogs()` or MCP `memora_console`.

**Script execution details**

- Classic scripts run in document order. External scripts download in parallel.
- `defer` scripts run after the classic scripts, then `async` scripts.
- Module scripts (`type="module"`) and import maps are bundled with esbuild and run like deferred scripts.
- Data blocks (`application/json`, templates) never execute.
- Each batch of page scripts is stopped after **5 seconds** (`Script terminated after 5000ms`).
- After load, `goto()` waits up to 5 seconds for `fetch()` work, promise chains and timers of 1 second or less (nesting depth up to 10). `setInterval` and longer timers are ignored.
- Assigning `location` during load triggers a follow-up navigation (up to 5 per `goto()`).
- Workarounds: prefer server-rendered pages or the site's API; use `waitForSelector()` for late content; use the MCP Chrome engine for JavaScript-heavy sites; stub missing functions with `page.evaluate()` when that is enough. See [troubleshooting.md](./troubleshooting.md#page-content-and-javascript).

## 3. Rendering, layout and visibility

- **There is no rendering engine.** CSS stylesheets are not downloaded or applied, and there is no layout, painting, fonts, images, video, canvas or WebGL.
- **Visibility is approximate.** Snapshots treat an element as hidden only if it or an ancestor has:
  - the `hidden` attribute,
  - `aria-hidden="true"`,
  - `type="hidden"` (inputs),
  - or an inline `style` containing `display:none` / `visibility:hidden`.

  Elements hidden by CSS classes are treated as visible. Use `excludeSelectors` / `focusSelector` to trim them.
- **Geometry is synthetic.** `getBoundingClientRect` and CDP layout data are approximations produced for protocol compatibility. Do not use them for visual decisions.
- **Screenshots and PDF.** CDP `Page.captureScreenshot` returns a 1×1 transparent PNG. WebDriver screenshots return a blank PNG. WebDriver print returns `unsupported operation`.
- **Fixed viewport.** WebDriver window size is fixed at 1280×800, and window size/maximize commands are no-ops. CDP `Emulation.*` commands are accepted and ignored.

## 4. Browser features not implemented

| Feature | Status | Workaround |
| :--- | :--- | :--- |
| Iframes | Not loaded (`contentDocument` is undefined; WebDriver `no such frame`) | Navigate to the iframe `src` directly |
| Shadow DOM | Not supported (`shadowRoot` is `null`; WebDriver `no such shadow root`) | None |
| `alert` / `confirm` / `prompt` | Not defined. Calls throw `ReferenceError`. WebDriver reports `no such alert`. | Stub with `page.evaluate('window.alert=()=>{}; window.confirm=()=>true')` |
| File upload | `DOM.setFileInputFiles` throws `File uploads are not supported by Memora`. File inputs are skipped in form submissions. | Upload through the site's API |
| File download | Responses are read as text. Binary files (PDF, ZIP, images) are not saved. | Download with a normal HTTP client |
| Non-UTF-8 pages | Response bodies are decoded as UTF-8 | Fetch and decode yourself, then use `page.setContent(html, url)` |
| Multipart / file form posts | Forms submit as `application/x-www-form-urlencoded` (or GET) | Use the API |
| Media, WebRTC, notifications, geolocation, clipboard, service workers | Not available | — |

## 5. Networking and storage

- **Cookies are scoped per site** (0.2.0): domain (host-only or `Domain=`), path, `Secure` and expiry are honoured. `SameSite` is not enforced, and there is no `document.cookie` in page scripts.
- **Storage** (`localStorage`, `sessionStorage`) is kept per origin and survives navigation within a page (tab). It is not shared between pages.
- **Only documents, scripts, page `fetch()` and `XMLHttpRequest` are requested.** No CSS, images, fonts or media. There is no `WebSocket`.
- **Request interception** works over CDP (Playwright `page.route()`, `Fetch.*`) for navigations, scripts and `fetch()`/XHR. Redirect hops after the first request are not paused separately.
- **Headers are always Chrome-like.** The Chrome 130 header set is sent even with `--no-stealth`; with a custom non-Chrome `--user-agent` the Chrome client-hint headers are dropped (see [network-and-proxies.md](./network-and-proxies.md#3-headers-and-user-agent)).

## 6. Protocol coverage (CDP, WebDriver, MCP)

- **CDP.** Implemented domains:
  - `Target`, `Page`, `Runtime`, `DOM`, `Network` (enable, extra headers, cookies, response body), `Storage` (including cookies), `Input` (mouse, key, insertText), `Browser`, `Emulation` (no-op),
  - the custom `Orbis`/`Memora`/`LP` domains,
  - `Fetch` (request interception) and `Runtime.consoleAPICalled` console events.

  Cookie methods work per browser context, so Playwright `context.addCookies()`, `cookies()` and `clearCookies()` work. `/json/new?<url>` opens the new tab at that URL. Other domains return empty results. `Browser.close` closes only the pages that client created. See [playwright-puppeteer.md](./playwright-puppeteer.md).
- **WebDriver.** W3C Classic commands for sessions, navigation, elements, scripts, cookies and actions are implemented. Not supported: alerts, frames, shadow roots, real screenshots, print, window resizing. Navigation does not wait for async page work. When `ORBIS_API_KEY` is set, the WebDriver server requires the key (`x-api-key`, `Authorization: Bearer`, or Basic auth with the key as password, for example `http://orbis:KEY@host:port` in Selenium); without it requests get HTTP 401. See [selenium-webdriver.md](./selenium-webdriver.md).
- **MCP.** Protocol versions `2024-11-05` to `2025-11-25` (handshake-based; the stateless `2026-07-28` revision is not implemented), tools only (no resources or prompts), 17 `memora_*` tools. Tool calls run one at a time.
  - `memora_browse` truncates Markdown to 4,000 characters.
  - `memora_eval` waits up to 10 seconds for a promise, then fails with a timeout error.
  - `memora_fork` switches the active page with no tool to switch back.
  - With the Chrome engine, `memora_fork` opens a new tab and **re-loads** the URL instead of cloning state.

  See [mcp.md](./mcp.md).

## 7. Forking

`page.fork()` / `agent.fork()`:

- copies the URL, the **serialised DOM**, cookies, and the current document's storage into a new page by re-parsing the HTML. Do not rely on page scripts in the fork;
- does **not** copy JavaScript heap state or event listeners attached by scripts. **Verified:** a button wired by an external script did nothing in the fork, but worked in the original.
- registers the new page with the browser, so it appears in `listPages()` and `agent.tabs`; closing an agent returned by `agent.fork()` closes only the fork;
- took about 5–6 ms on a small page in our tests, and grows with page size. It is not a sub-millisecond copy-on-write operation.

Use forks for "what if" exploration of static or server-rendered pages. Re-navigate in the fork when you need fully working scripts.

## 8. Stealth

Stealth consists of:

- Chrome-like request headers (always sent),
- JavaScript patches (when stealth is on): `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`, `languages`, `plugins`, `mimeTypes`, `mediaDevices`, `getBattery`, `window.chrome` and `screen`, plus a `permissions.query` patch for `notifications` (that last patch only applies if `navigator.permissions.query` exists).

It does **not**:

- spoof TLS (JA3/JA4) or HTTP/2 fingerprints (requests use Node.js's TLS stack),
- spoof canvas or WebGL (they do not exist),
- solve CAPTCHAs or JavaScript challenges (from 0.1.2 Orbis detects them and can hand them to a person, see [challenges.md](./challenges.md); solving is not planned),
- emulate a real browser's full JavaScript surface.

Expect bot-protection products to detect Orbis. See [stealth.md](./stealth.md).

## 9. Scale and isolation

- One Orbis process is one Node.js event loop. Page scripts run synchronously and can block other pages for up to 5 seconds.
- REST and the Python SDK use the daemon's default page unless you pass `?id=<pageId>` (or `"id"` in the body).
- WebDriver defaults to at most 16 sessions per process, and closes sessions after 5 idle minutes (change with `--session-idle-timeout <sec>`; `0` disables it).
- There is no built-in metrics endpoint, memory cap or page eviction.

See [production-deployment.md](./production-deployment.md#2-capacity-and-isolation-model).

## Snapshot size on link-dense pages

Distillation shrinks typical forms and content pages. On the four benchmark fixtures it produced 33–40% fewer tokens than the raw HTML. On **link-dense real pages**, however, a full snapshot can be **larger** than the raw HTML. Every interactive element gets its own action-map line, and elements without an id, test id, name, aria-label, placeholder or unique class get a long positional selector, for example `html:nth-of-type(1) > body:nth-of-type(1) > ... > a:nth-of-type(3)`.

Measured in October 2026 with `tokenEstimate` (characters ÷ 4):

| Page | Actions | Snapshot estimate | Raw HTML estimate |
| :--- | :--- | :--- | :--- |
| Hacker News front page | 228 | ~17,800 tokens | ~8,700 tokens |
| A Wikipedia article | 1,230 | ~120,000 tokens | ~104,000 tokens |

Mitigations:
- Scope the snapshot with `focusSelector` (`main`, `article`, `#content`).
- Strip chrome with `excludeSelectors` (`nav`, `footer`, `aside`, `.sidebar`).
- Build a compact map from `snapshot.actions` (ID, role, text only) instead of sending `actionMapText`.
- After the first turn, send `diff().summary`.
- Truncate the Markdown.

See [best-practices.md](./best-practices.md) and [troubleshooting.md](./troubleshooting.md#prompts-are-huge-or-the-model-context-overflows).

## 10. Issues fixed in 0.2.0

These were the known issues of 0.1.0–0.1.2. Upgrade to 0.2.0 to get the fixes; some change behaviour, see [upgrading.md](./upgrading.md).

| # | In 0.1.x | In 0.2.0 |
| :--- | :--- | :--- |
| 1 | Server bound `0.0.0.0` for `--host localhost` | Binds `127.0.0.1` only. Use `--host 0.0.0.0` in containers. |
| 2 | `--host ::1` crashed on the first request | Works |
| 3 | API key not enforced | Enforced on HTTP and WebSocket; requests from web pages in a browser are refused |
| 4 | Session endpoints read/wrote any path | Only `.json` files inside the server's folder (or `ORBIS_SESSION_DIR`) |
| 5 | Page JavaScript could reach the host `process` | Known escape routes blocked (hardened, not a perfect sandbox; isolate untrusted sites in a container) |
| 6 | Cookies not scoped by domain | Scoped by site, path, `Secure` and expiry |
| 7 | Storage reset on navigation | Kept per origin across navigations |
| 8 | Typed values in action maps and diffs | Text fields show `[FILLED]`; passwords never included |
| 9 | `--http-proxy` did nothing | Routes traffic through the proxy |
| 10 | `--http-timeout` ignored for navigations | Applied to navigations |
| 11 | `act()` / `click()` / REST `act` did not follow links or submit | Follow links and submit forms (`act()`/`click()` are now async) |
| 12 | `fillForm` submitted by default | Submits only when asked |
| 13 | IDs from filtered snapshots hit the wrong element | Resolve against the snapshot you saw |
| 14 | `<label>` text not used in the action map | Used |
| 15 | Python `select_option()` returned 404 | Works (`POST /orbis/select-option`) |
| 16 | Python timeouts shorter than navigation | 60 s default, configurable |
| 17 | `/orbis/goto` ignored `id` | Honoured |
| 18 | `OrbisAgent.connect()` ran a local browser | Returns `RemoteOrbisAgent`, which drives the daemon |
| 19 | CDP `Browser.close` closed every page | Closes only the caller's own pages |
| 20 | Update notice on stdout broke MCP | Printed to stderr |
| 21 | `--eval` exited 0 on failure | Exits 1 |
| 22 | Missing `style`, `dataset`, `remove()`, `XMLHttpRequest`, `history`, `Event` | Available (see [section 2](#2-javascript-and-dom-compatibility)) |
| 23 | Snapshots of link-dense pages larger than the HTML | MCP output stays compact by default; full SDK snapshots can still be large (see [above](#snapshot-size-on-link-dense-pages)) |
| 24 | `select.value` always `''` | Reflects the selected option |
| 25 | `waitForFunction('<string>')` returned immediately | Waits for a truthy result |
| 26 | Closing a fork shut down the parent | Closes only the fork |
| 27 | `label:` case-sensitive on aria-label | Case-insensitive |
| 28 | `role:link` did not match `<a>` | Implicit roles are computed |
| 29 | `@alias` took the first partial match | Picks the best match (fields before links) |
| 30 | MCP tool calls ran concurrently | Run one at a time, in order |
| 31 | `memora_cookies clear` removed nothing | Clears cookies |
| 32 | `goto('about:blank')` threw | Works |
| 33 | `extract()` returned `attributes: {}` | Returns all attributes |
| 34 | Playwright `newCDPSession` failed (Duplicate target) | Works |
| 35 | `--engine chrome` crashed without Chrome | Clear error message |
| 36 | REST `act` reset the diff baseline | Baseline kept |
| 37 | `orbis fetch` exited 0 on HTTP errors | Exits 1 on 4xx/5xx (page still printed) |
| 38 | `Crawl-delay` ignored | Honoured with `--obey-robots` (max 60 s) |
| 39 | Playwright `selectOption`, `route()`, console events | Work |
| 40 | `--user-agent` only changed the header | Also `navigator.userAgent` |
| 41 | Typed value could become an element's name | Never used as a name |
| 42 | MCP `memora_eval` (native engine) returned `{type, value}` and did not await promises | Awaits promises (up to 10 s) and returns plain values, like the Chrome engine; errors are tool errors |
| 43 | MCP `memora_diff` after `memora_act` / `memora_fill_form` showed no change | Shows the change |
| 44 | MCP tool descriptions claimed "95% token savings" | Claim removed (33–40% fewer tokens measured on the benchmark pages) |
| 45 | HTML output wrapped in `<#document>` | Starts with `<!DOCTYPE html>` |
| 46 | `fillForm()` reported `success` even when fields were missing | `success` is false if a field was skipped or a requested submit failed |
| 47 | `BrowserOptions.timeout` ignored | Sets the default navigation timeout |
| 48 | Playwright `context.addCookies()` / `cookies()` / `clearCookies()` failed | Work |
| 49 | Wrong HTTP method on REST hung or gave 404 | HTTP 405 with an `Allow` header |
| 50 | `/json/new?<url>` ignored the URL | Opens the new tab at that URL |
| 51 | WebDriver server did not check the API key | Checked when `ORBIS_API_KEY` is set (HTTP 401 without it) |
| 52 | WebDriver idle session timeout fixed at 5 minutes | `--session-idle-timeout <sec>` (`0` disables) |
| 53 | Python `fill_form(submit=...)` typed as bool only; PyPI listed an MIT license | Accepts a bool or a submit selector; license metadata corrected |

If you hit a problem not listed here, see [troubleshooting.md](./troubleshooting.md) and report it with the bug template.
