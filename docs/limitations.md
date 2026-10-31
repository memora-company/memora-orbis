# Limitations and Known Issues

This page lists what Orbis 0.1.0 does **not** do, and the bugs known in this release. It also gives the recommended workaround for each one. Orbis is not a full browser. It is a lightweight HTML engine with a partial DOM and JavaScript environment, designed to turn pages into compact, actionable text for agents. Check this page before you commit to Orbis for a workflow. Everything here was confirmed in the 0.1.0 source code or at runtime.

Applies to: Orbis 0.1.0 (`@memoracompany/orbis` on npm, `memora-orbis` on PyPI)

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
- [10. Known issues in 0.1.0](#10-known-issues-in-010)

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

Page scripts run in a Node.js `node:vm` context with a custom DOM. The tables below show what exists in a page when Orbis is used through the SDKs, REST, WebDriver or the native MCP engine (probed with `typeof` inside the page context).

**Globals**

| Available | Not available (`undefined`) |
| :--- | :--- |
| `document`, `window`/`self`/`top`/`parent` (window is an event target), `location`, `navigator`, `screen`, `localStorage`, `sessionStorage`, `console` | `XMLHttpRequest`, `WebSocket`, `Worker`, `history` |
| `setTimeout`/`setInterval` and the `clear*` functions, `queueMicrotask` | `requestAnimationFrame`, `IntersectionObserver`, `ResizeObserver`, `getComputedStyle`, `matchMedia`, `performance` |
| `fetch`, `Headers`, `Request`, `Response`, `FormData`, `AbortController`, `Blob`, `URL`, `URLSearchParams` | `alert`, `confirm`, `prompt` |
| ECMAScript built-ins (`Promise`, `JSON`, `Intl`, `Map`, ...) | `Event`, `CustomEvent` constructors |
| `MutationObserver` (**no-op stub**: `observe()` does nothing and callbacks never fire) | `crypto`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `structuredClone`, `indexedDB`, `customElements` |

**Element members**

| Available | Not available |
| :--- | :--- |
| `classList`, `innerHTML`, `textContent`, `appendChild`, `addEventListener`, `getBoundingClientRect`, `closest`, `matches`, `setAttribute`/`getAttribute`, `focus`, `querySelector(All)`, `value` (see note) | `style`, `dataset`, `innerText`, `hidden`, `checked`, `selectedIndex`, `options`, `remove()`, `cloneNode()`, `blur()`, `insertAdjacentHTML`, `replaceChild`, `contentDocument` |
| `document.createElement`, `document.querySelector(All)` | `document.createDocumentFragment`, `document.cookie` |

**CDP compatibility layer.** When a CDP client (Playwright, Puppeteer) attaches to a page, Orbis installs extra shims in that process. They include:
- event constructors (`Event`, `CustomEvent`, `MouseEvent`, `KeyboardEvent`, ...),
- `EventTarget`, `getComputedStyle`, `requestAnimationFrame`, `requestIdleCallback`, `matchMedia`,
- `IntersectionObserver`, `ResizeObserver`, `CSS`, `atob`/`btoa`, `structuredClone`,
- viewport/scroll properties,
- an element `style` object (heuristic: inline style plus defaults),
- reflected element properties such as `hidden`, `checked`, `disabled`, `type`, `name`, `placeholder`, `tabIndex`, `cloneNode`, `blur`.

These shims are **not** present in SDK, REST or WebDriver-only use until a CDP client touches a page in that process. Do not depend on them outside CDP.

**Consequences**

- Many modern bundles (React, Vue, Angular, analytics, consent managers, anything using `XMLHttpRequest`, `history.pushState`, `new Event()`, `requestAnimationFrame` or `element.style`) throw or do not render content.
- `el.style.display = 'block'` throws `TypeError: Cannot set properties of undefined (setting 'display')`. Inside an event handler this is logged as `[MemoraDOM] Error in <event> handler`, and the rest of the handler does not run. For example, a dependent dropdown may never be populated.
- **`value` only reflects the `value` attribute.** For inputs this works, because typing sets the attribute. For a `<select>`, `select.value` is always `''` in page scripts, even after `selectOption()` (verified). A handler such as `onchange="loadStates(this.value)"` receives an empty string, so dependent fields are not populated. `selectOption()` and `fillForm()` do mark the right `<option selected>`, and native form submissions send it correctly. Workarounds: submit the form and read the next page, or call the site's function yourself with `page.evaluate("loadStates('IN')")`. See [examples/04-dynamic-dropdown-wizard](../examples/04-dynamic-dropdown-wizard/).
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

| Feature | Status in 0.1.0 | Workaround |
| :--- | :--- | :--- |
| Iframes | Not loaded (`contentDocument` is undefined; WebDriver `no such frame`) | Navigate to the iframe `src` directly |
| Shadow DOM | Not supported (`shadowRoot` is `null`; WebDriver `no such shadow root`) | None |
| `alert` / `confirm` / `prompt` | Not defined. Calls throw `ReferenceError`. WebDriver reports `no such alert`. | Stub with `page.evaluate('window.alert=()=>{}; window.confirm=()=>true')` |
| File upload | `DOM.setFileInputFiles` throws `File uploads are not supported by Memora`. File inputs are skipped in form submissions. | Upload through the site's API |
| File download | Responses are read as text. Binary files (PDF, ZIP, images) are not saved. | Download with a normal HTTP client |
| Non-UTF-8 pages | Response bodies are decoded as UTF-8 | Fetch and decode yourself, then use `page.setContent(html, url)` |
| Multipart / file form posts | Forms submit as `application/x-www-form-urlencoded` (or GET) | Use the API |
| Browser history API | `history` is undefined in page scripts. Orbis keeps its own back/forward list (`page.back()`, `page.forward()`). | — |
| Media, WebRTC, notifications, geolocation, clipboard, service workers | Not available | — |

## 5. Networking and storage

- **Cookies are not scoped.** The jar is a flat `name → value` map per page. Domain, path, `Secure`, `HttpOnly`, `SameSite` and expiry are ignored, and every cookie is sent to every host. See [security.md](./security.md#25-cookies-are-not-scoped-to-a-site).
- **Storage does not survive navigation.** `localStorage` and `sessionStorage` are reset on every navigation in the native engine. See [sessions-and-auth.md](./sessions-and-auth.md#8-native-engine-behaviour-you-must-know).
- **Only documents, scripts and page `fetch()` are requested.** No CSS, images, fonts or media. There is no `XMLHttpRequest` or `WebSocket`.
- **No request interception.** CDP domains Orbis does not implement (for example `Fetch`) are accepted and silently ignored. Playwright `page.route()` and Puppeteer request interception therefore have no effect.
- **Headers are always Chrome-like.** The Chrome 130 header set is sent even with `--no-stealth` (see [network-and-proxies.md](./network-and-proxies.md#3-headers-and-user-agent)).
- **`--http-proxy` is a placeholder,** and **`--http-timeout` does not affect navigations** (see the table below).

## 6. Protocol coverage (CDP, WebDriver, MCP)

- **CDP.** Implemented domains:
  - `Target`, `Page`, `Runtime`, `DOM`, `Network` (enable, extra headers, cookies, response body), `Storage`, `Input` (mouse, key, insertText), `Browser`, `Emulation` (no-op),
  - the custom `Orbis`/`Memora`/`LP` domains.

  Other domains return empty results. `Browser.close` closes every page in the daemon. See [playwright-puppeteer.md](./playwright-puppeteer.md).
- **WebDriver.** W3C Classic commands for sessions, navigation, elements, scripts, cookies and actions are implemented. Not supported: alerts, frames, shadow roots, real screenshots, print, window resizing. Navigation does not wait for async page work. See [selenium-webdriver.md](./selenium-webdriver.md).
- **MCP.** Protocol version `2024-11-05`, tools only (no resources or prompts), 15 `memora_*` tools.
  - `memora_browse` truncates Markdown to 4,000 characters.
  - `memora_fork` switches the active page with no tool to switch back.
  - With the Chrome engine, `memora_fork` opens a new tab and **re-loads** the URL instead of cloning state.

  See [mcp.md](./mcp.md).

## 7. Forking

`page.fork()` / `agent.fork()`:

- copies the URL, the **serialised DOM**, cookies, and the current document's storage into a new page by re-parsing the HTML. Do not rely on page scripts in the fork;
- does **not** copy JavaScript heap state or event listeners attached by scripts. **Verified:** a button wired by an external script did nothing in the fork, but worked in the original.
- creates a page that is **not registered** with the browser, so it does not appear in `listPages()`, CDP target lists or REST endpoints;
- took about 5–6 ms on a small page in our tests, and grows with page size. It is not a sub-millisecond copy-on-write operation.

Use forks for "what if" exploration of static or server-rendered pages. Re-navigate in the fork when you need fully working scripts.

## 8. Stealth

Stealth in 0.1.0 consists of:

- Chrome-like request headers (always sent),
- JavaScript patches (when stealth is on): `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`, `languages`, `plugins`, `mimeTypes`, `mediaDevices`, `getBattery`, `window.chrome` and `screen`, plus a `permissions.query` patch for `notifications` (that last patch only applies if `navigator.permissions.query` exists).

It does **not**:

- spoof TLS (JA3/JA4) or HTTP/2 fingerprints (requests use Node.js's TLS stack),
- spoof canvas or WebGL (they do not exist),
- solve CAPTCHAs or JavaScript challenges (unreleased builds detect them and can hand them to a person, see [challenges.md](./challenges.md); solving is not planned),
- emulate a real browser's full JavaScript surface.

Expect bot-protection products to detect Orbis. See [stealth.md](./stealth.md).

## 9. Scale and isolation

- One Orbis process is one Node.js event loop. Page scripts run synchronously and can block other pages for up to 5 seconds.
- REST and the Python SDK use one shared default page per daemon.
- WebDriver defaults to at most 16 sessions per process, and closes sessions after 5 idle minutes.
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

## 10. Known issues in 0.1.0

| # | Issue | Impact | Workaround | Details |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Server binds `0.0.0.0` when `--host` is `localhost`/`127.0.0.1` | Daemon reachable from the network | Specific private IP, `--host 127.0.0.2`, unpublished container port, firewall | [security.md](./security.md#21-the-server-listens-on-all-interfaces-by-default) |
| 2 | `--host ::1` (IPv6 literal) crashes on the first request | Daemon down | Use IPv4 addresses | [troubleshooting.md](./troubleshooting.md#the-daemon-crashes-on-the-first-request-after-starting-with---host-1) |
| 3 | API key not enforced by the server | No authentication | Gateway authentication plus network isolation | [security.md](./security.md#22-api-keys-are-not-enforced) |
| 4 | Session endpoints read/write arbitrary paths | File disclosure / overwrite | Block at the gateway; run as an unprivileged user with a read-only filesystem | [security.md](./security.md#24-session-endpoints-read-and-write-arbitrary-paths) |
| 5 | Page JavaScript can reach the host Node.js `process` | A visited site can execute code on the host | Container/VM isolation, no secrets in the environment, trusted URLs only in-process | [security.md](./security.md#26-page-javascript-is-not-sandboxed) |
| 6 | Cookies not scoped by domain | Session cookies leak to other sites | One page/browser per site and credential set | [security.md](./security.md#25-cookies-are-not-scoped-to-a-site) |
| 7 | `localStorage`/`sessionStorage` reset on navigation | Storage-based logins do not persist | Cookie/header auth, or the MCP Chrome engine | [sessions-and-auth.md](./sessions-and-auth.md#8-native-engine-behaviour-you-must-know) |
| 8 | Typed values appear as `value="..."` in action maps and diffs | Secrets sent to the LLM | Fill secrets in code; redact before prompting | [security.md](./security.md#7-keeping-secrets-away-from-the-llm) |
| 9 | `--http-proxy` does not set a proxy | Traffic goes direct | `--use-env-proxy` or `network.proxy` | [network-and-proxies.md](./network-and-proxies.md#7-proxies) |
| 10 | `--http-timeout` ignored for navigations | Cannot shorten timeouts from the CLI | `page.goto(url, { timeoutMs })`; MCP `timeout` argument | [network-and-proxies.md](./network-and-proxies.md#4-timeouts) |
| 11 | `agent.act()` / `page.click()` / REST `/orbis/act` / Python `act()` do not follow links or submit forms | Navigation silently does not happen | `page.activate()`, `fillForm(..., submit)`, `goto(href)`, or MCP `memora_act` | [troubleshooting.md](./troubleshooting.md#clicking-a-link-or-submit-button-does-nothing-url-unchanged) |
| 12 | `fillForm` submits by default (`submit = true`) | Unintended submissions | Pass `false` explicitly | [troubleshooting.md](./troubleshooting.md#fillform-submitted-the-form-when-i-only-wanted-to-fill-it) |
| 13 | Action IDs from focused or filtered snapshots (`focusSelector`, `excludeSelectors`, MCP `focus`/`exclude`) do not match action resolution | Wrong element clicked | Use IDs from unfiltered snapshots, or `selector` / semantic locators | [troubleshooting.md](./troubleshooting.md#3-clicked-the-wrong-element) |
| 14 | `<label>` text not used in the action map | Inputs shown as `[Untitled input]` | `label:` locators; include Markdown in prompts | [troubleshooting.md](./troubleshooting.md#inputs-appear-as-untitled-input-in-the-action-map) |
| 15 | Python `select_option()` calls a missing endpoint (404) | Dropdown selection fails | `agent.act(target, "Option text")` | [python-sdk.md](./python-sdk.md) |
| 16 | Python SDK HTTP timeouts (15 s) are shorter than navigation (20 s) | Spurious timeouts | Retry, or call REST with a longer timeout | [troubleshooting.md](./troubleshooting.md#python-sdk-calls-time-out) |
| 17 | REST/Python share one default page; `/orbis/goto` ignores `id` | Agents interfere with each other | One daemon per agent | [production-deployment.md](./production-deployment.md#2-capacity-and-isolation-model) |
| 18 | TypeScript `OrbisAgent.connect(url)` only checks that the endpoint answers, then runs a **local, in-process** browser | Remote daemon state (pages, cookies) is not used | Use `OrbisAgent.launch()` locally, or drive a remote daemon with Playwright CDP or REST | [typescript-sdk.md](./typescript-sdk.md) |
| 19 | CDP `Browser.close` closes every page in the daemon | One client can disrupt others | One daemon per client; close pages, not the browser | [playwright-puppeteer.md](./playwright-puppeteer.md) |
| 20 | Startup update notice is printed to stdout | Can corrupt the MCP JSON-RPC stream when a new version is announced | `ORBIS_NO_TELEMETRY=1` in MCP configs | [production-deployment.md](./production-deployment.md#11-outbound-version-check-and-air-gapped-environments) |
| 21 | `--eval` exits 0 even when the page fails | CI checks pass falsely | Use `orbis fetch` (exits 1 on failure) | [production-deployment.md](./production-deployment.md#12-using-orbis-in-ci) |
| 22 | Elements lack `style`, `dataset`, `remove()`, and similar members; no `XMLHttpRequest`/`history`/`Event` | Many SPA scripts fail | Server-rendered pages, site APIs, MCP Chrome engine | [Section 2](#2-javascript-and-dom-compatibility) |
| 23 | Full snapshots of link-dense pages can exceed the raw HTML size | Context overflow, high token cost | `focusSelector`/`excludeSelectors`, compact maps, diffs | [Snapshot size](#snapshot-size-on-link-dense-pages) |
| 24 | `select.value` is always `''` in page scripts | `onchange` handlers that read `this.value` do nothing useful; dependent dropdowns stay empty | Form submission, or `page.evaluate()` calling the site's function | [Section 2](#2-javascript-and-dom-compatibility) |
| 25 | `page.waitForFunction('<string expression>')` returns `true` immediately, even when the expression is false | Waits that do not wait | Pass a function: `waitForFunction(() => Boolean(page.querySelector('#done')))` | [typescript-sdk.md](./typescript-sdk.md) |
| 26 | Calling `close()` on an agent returned by `agent.fork()` shuts down the parent's CDP server and browser | All pages closed unexpectedly | Dispose forks with `fork.page.close()`; call `close()` only on the original agent | [typescript-sdk.md](./typescript-sdk.md) |
| 27 | `label:` falls back to a case-sensitive `aria-label` match against a lower-cased query | `label:Search Products` misses `aria-label="Search Products"` | Use `[aria-label="Search Products"]` (CSS) or the action's `selector` | [locators.md](./locators.md) |
| 28 | `role:link` does not match `<a>` (implicit roles are not computed) | Role locators miss native elements | `text=`, CSS (`a[href*="..."]`) or explicit `role` attributes | [locators.md](./locators.md) |
| 29 | `@alias` returns the first element that contains the word anywhere | `@email` can hit a nav link "Email us" before `input[name=email]` | Prefer `label:`, `placeholder:` or `#id` for scripted steps | [locators.md](./locators.md) |
| 30 | MCP `tools/call` requests are handled concurrently | A browse and an act sent together can race | Clients must wait for each tool result before the next call | [mcp.md](./mcp.md) |
| 31 | MCP `memora_cookies` with `clear` reports success but removes nothing | Stale cookies remain | Restart the MCP server, or load a session file with empty cookies into a fresh server | [mcp.md](./mcp.md) |
| 32 | `goto('about:blank')` throws "about scheme is not supported" | Cannot reset a page by navigating to blank | `page.setContent('<html></html>', 'about:blank')` or a new page | [typescript-sdk.md](./typescript-sdk.md) |
| 33 | `page.extract(selector)` without an attribute returns `attributes: {}` | Attribute data missing | Pass the attribute name, e.g. `extract('a', 'href')` | [typescript-sdk.md](./typescript-sdk.md) |
| 34 | Playwright `context.newCDPSession(page)` fails with `Duplicate target` | Custom `Orbis.*` CDP calls unavailable through Playwright | Raw WebSocket to the page's `webSocketDebuggerUrl` | [playwright-puppeteer.md](./playwright-puppeteer.md) |
| 35 | `--engine chrome` crashes at start-up when no Chrome or Edge is installed | MCP server does not start | Install Chrome/Edge or use `--engine native` | [mcp.md](./mcp.md) |
| 36 | REST `/orbis/act` (and Python `act()`) takes a snapshot after acting, which resets the diff baseline | `diff()` right after `act()` reports no changes | Use the `snapshot` returned by `act()`, or compare snapshots yourself | [http-api.md](./http-api.md) |
| 37 | `orbis fetch` exits 0 when the server answers with an HTTP error such as 503 | Monitoring scripts miss outages | Check the status yourself (SDK `page.goto()` returns `status`), or grep the output | [cli-reference.md](./cli-reference.md) |
| 38 | `Crawl-delay` in robots.txt is ignored | Crawl rate is not limited by Orbis | Rate-limit in your own code | [network-and-proxies.md](./network-and-proxies.md) |
| 39 | Playwright `page.selectOption()` throws a `TypeError`; `page.route()` handlers never run; no console events are forwarded | Some Playwright scripts fail | Click the `<option>`, or use the SDK's `selectOption()`; no interception | [playwright-puppeteer.md](./playwright-puppeteer.md) |
| 40 | `--user-agent` changes only the request header; `navigator.userAgent` and `Sec-Ch-Ua` keep the Chrome 130 values | Inconsistent fingerprint | Leave the default UA when consistency matters | [stealth.md](./stealth.md) |
| 41 | A typed value can also become the element's `text` in the action map (when the field has no `aria-label`, `placeholder` or `title`) | Secrets leak even after removing `value="..."` | Redact by the secret's value, not only the `value` attribute | [best-practices.md](./best-practices.md) |

If you hit a problem not listed here, see [troubleshooting.md](./troubleshooting.md) and report it with the bug template.
