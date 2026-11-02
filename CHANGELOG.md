# Orbis Changelog

All notable changes to the Orbis headless browser engine (`@memoracompany/memora-orbis` on npm and `memora-orbis` on PyPI) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0]

Upgrading? The [upgrade guide](./docs/upgrading.md) lists what to check, especially if you come from 0.1.0 or 0.1.1.

### Security
- **Fixed: a web page could read files from the computer running Orbis.** By loading a JavaScript module with a computed path, a page could make the native engine read files from the folder Orbis was started in (and folders above it), then send them elsewhere. Such module imports are now refused. Some pages could also crash the whole process this way; a module that fails to load is now reported in the page's console instead. **All 0.1.x users should upgrade.**

### Added
- **Prompt injection firewall** (off by default; turn on with `--firewall standard` or `strict`). Risky actions such as running JavaScript, reading cookies or storage, using session files and submitting forms ask you before they run. You can limit your agent to sites you allow, and email, banking, account-settings and admin sites are blocked by default. Page text reaches the model labelled as untrusted, common injection phrases and hidden text are flagged or removed, and every action can be written to a signed activity log. See the [guide](./docs/prompt-injection-firewall.md).
- `orbis firewall scan <url>`, `orbis firewall verify <file>`, `orbis firewall policy`, and the read-only `memora_firewall` MCP tool.
- Site rules for every mode: `--allow-domain`, `--block-domain`, `--block-sensitive-domains`.
- Python SDK: `FirewallBlockedError`.

### Changed (may need action, see the upgrade guide)
- `page.click()` and `agent.act()` are async and follow links / submit forms like a real click.
- `fillForm()` (TypeScript, Python, REST, LangChain) no longer submits unless asked.
- `OrbisAgent.connect(url)` returns a `RemoteOrbisAgent` that drives the remote daemon (before, it ran a local browser).
- `--host localhost` binds `127.0.0.1` only; use `--host 0.0.0.0` for containers.
- The API key is enforced on HTTP and WebSocket; requests from web pages in a browser are refused (no CORS).
- Session files over the network or MCP must be `.json` files inside the server's folder or `ORBIS_SESSION_DIR`.
- Cookies are scoped per site (domain, path, Secure, expiry); session files gain `cookieList`.
- Action maps show `[FILLED]` instead of typed values; passwords are never included.
- `orbis fetch` and `--eval` exit 1 on HTTP 4xx/5xx or failure.
- Python SDK default timeout is 60 s, configurable.
- JavaScript module imports with a computed path (`import("./" + name)`) are refused in the native engine (see Security).
- The MCP server supports protocol versions up to 2025-11-25 and answers clients that ask for an unknown version with the newest one it supports (it used to answer 2024-11-05).
- MCP `memora_eval` (native engine) awaits promises (up to 10 s) and returns plain values like the Chrome engine (strings as-is, other values as JSON) instead of `{type, value}`; thrown or rejected errors are tool errors.
- `fillForm()` returns `success: false` when a field was not found (listed in `skipped`) or a requested submit did not happen; a multi-step fill succeeds only if every step did.
- The WebDriver server requires the API key when `ORBIS_API_KEY` is set (`x-api-key`, `Authorization: Bearer`, Basic auth with the key as password, or `?apiKey=`); missing or wrong key gives HTTP 401, cross-site browser requests get 403. In Selenium use `http://orbis:KEY@host:port`.

### Fixed
All known issues of 0.1.x (full list in [limitations.md](./docs/limitations.md#10-issues-fixed-in-020)), including:
- Security: page scripts could reach the host Node.js process through `constructor` chains (known routes now blocked); the server listened on all interfaces; the API key was not checked; session endpoints wrote anywhere; cookies leaked between sites.
- `--http-proxy` and `--http-timeout` now work; `Crawl-delay` is honoured with `--obey-robots`.
- Page scripts get `XMLHttpRequest`, `history`, `Event` constructors, `element.style`, `dataset`, `remove()`; `select.value` works; storage survives navigation.
- Locators: `<label>` names inputs, `label:` is case-insensitive, `role:link` matches `<a>`, `@alias` picks the best match, IDs from filtered snapshots resolve correctly.
- Playwright: `newCDPSession`, `page.route()`, `page.selectOption()` and console events work; `Browser.close` closes only the caller's pages.
- MCP tool calls run in order; update notices go to stderr; `--engine chrome` without Chrome gives a clear error.
- `goto('about:blank')`, `extract()` attributes, `waitForFunction(string)`, fork `close()`, REST `/orbis/goto?id=`, REST `act` diff baseline, Python `select_option()`.
- Chrome engine: after a navigation was blocked (by robots.txt or the firewall), the next navigation could fail with "interrupted by another navigation".
- Broken characters (such as `â€”`) in CLI help and messages.
- MCP `memora_eval` (native engine) awaits promises; `memora_diff` shows changes made by `memora_act` and `memora_fill_form`; tool descriptions no longer claim "95% token savings".
- HTML output (`page.content()`, `orbis fetch --dump html`, REST and MCP) starts with `<!DOCTYPE html>` instead of a `<#document>` wrapper.
- `fillForm()` no longer reports success when fields were skipped or a requested submit did not happen.
- `new OrbisBrowser({ timeout })` sets the default navigation timeout.
- Playwright `context.addCookies()`, `cookies()` and `clearCookies()` work (CDP `Storage` and `Network` cookie methods, per browser context).
- REST endpoints answer a wrong HTTP method with 405 and an `Allow` header (before, `/orbis/session` hung and POST-only routes gave 404).
- `/json/new?<url>` opens the new tab at that URL and returns its URL and title.
- The WebDriver server checks the API key; its idle session timeout is configurable with `--session-idle-timeout <sec>` (default 300, `0` disables).
- Python `fill_form()` accepts a submit selector (`submit: Union[bool, str]`); PyPI metadata lists "Other/Proprietary License" instead of MIT.

### Performance
Measured on a Windows 11 laptop (Node 22), 0.1.2 and 0.2.0 run on the same machine.


| What | 0.1.2 | 0.2.0 | Result |
|---|---|---|---|
| Action map for nodejs.org (thousands of links) | over 120 s (looked stuck) | about 93 ms | Much faster |
| Engine memory at start | 79.6 MB | 73.6 MB | About 6 MB less |

---

## [0.1.2] - 2026-10-31

### Changed
- **Package Rebranding & Alignment:** Formally rebranded npm package to `@memoracompany/memora-orbis` to ensure 100% naming parity across npm (`@memoracompany/memora-orbis`) and PyPI (`memora-orbis`).
- **Repository URLs:** Updated all metadata and documentation references to `https://github.com/memora-company/memora-orbis`.
- **Distribution Packages:** Generated hardened `memoracompany-memora-orbis-0.1.2.tgz` and PyPI wheels.

---

## [0.1.1] - 2026-10-31

### Highlights
- **Multi-Tab & Worker Concurrency (High-Concurrency Fleet):** Full support for managing hundreds of concurrent background tabs within a single Orbis browser process. Dedicated `OrbisContext` / `BrowserContext` isolation ensures cookie jars, local storage, and page lifecycles never collide.
- **Isolated Cookie Jars:** Per-tab and per-context RFC 6265 compliant cookie management. Prevents cross-tenant session leaks when running multiple agent personas simultaneously.
- **Memory Leak & Lifecycle Hardening:** In-flight network requests are automatically aborted via `AbortController` on tab teardown. Forked pages now properly register with the parent browser.
- **Automated Bot Challenge & CAPTCHA Detection:** Early-warning signal engine for Cloudflare Turnstile, reCAPTCHA v2/v3, AWS WAF, Akamai, DataDome, and 429 rate limits, with typed Python exceptions and configurable CLI policies.

---

### Added

#### 1. Multi-Tab Fleet Management (`OrbisAgent`)
- Added `agent.tabs`: Returns an array of all active `OrbisPage` tabs currently open in the browser.
- Added `agent.newTab(url?, options?)`: Spawns a new tab, optionally navigates to a URL, and automatically sets the active agent focus. Supports `{ isolated: true }` to run inside a separate browser context.
- Added `agent.switchTab(tabIdOrIndex)`: Seamlessly switch the active tab context using either numerical index (`0`, `1`, ...) or target page ID.
- Added `agent.closeTab(tabId?)`: Closes a designated tab or the active working tab, gracefully aborting any pending fetch requests and releasing DOM resources.
- Added `agent.newContext(options?)`: Spawns a fresh `OrbisContext` for isolated multi-tenant parallel workflows.

```typescript
import { OrbisAgent } from '@memoracompany/memora-orbis';

const agent = await OrbisAgent.launch({ cdpPort: 9222 });

// Open multiple tabs concurrently
const researchTab = await agent.newTab('https://news.ycombinator.com', { switch: true });
const adminTab = await agent.newTab('https://dashboard.example.com', { isolated: true });

console.log(`Active tabs: ${agent.tabs.length}`);

// Switch between tabs instantly without reloading
agent.switchTab(0);
console.log(`Working on: ${agent.page.url}`);

// Close tab and release resources
agent.closeTab(adminTab.id);
```

#### 2. Isolated Browser Contexts (`OrbisContext`)
- Introduced `OrbisContext` (`src/engine/context.ts`):
  - Encapsulates separate cookie jars, security boundaries, and page groups.
  - Default browser context for standard tabs, with on-demand isolated contexts for parallel agent workers.
  - Full CDP Target domain integration:
    - `Target.createBrowserContext`: Creates isolated contexts over CDP.
    - `Target.disposeBrowserContext`: Closes and tears down context tabs and cookies.
    - `Target.createTarget`: Accepts `browserContextId` for fine-grained tab creation.

#### 3. Per-Context Domain-Scaped `CookieJar`
- Introduced `CookieJar` (`src/network/cookie-jar.ts`):
  - In-memory RFC 6265 compliant cookie jar with domain, path, and secure scoping.
  - Prevents credential bleed across different agent personas operating in parallel tabs.
  - Supports cookie serialization, cloning for page forks, and Set-Cookie header parsing.

#### 4. Challenge Detection & Early Warning
- Added `ChallengeSignal` detection across major bot management platforms:
  - Cloudflare Turnstile and Managed Challenges
  - Google reCAPTCHA v2 and v3
  - AWS WAF Challenge & Captcha
  - Akamai Bot Manager & DataDome
  - HTTP 429 Too Many Requests
- Added `--on-challenge flag` (default) and `--on-challenge stop` CLI options.
- Added Python SDK typed errors:
  - `ChallengeDetectedError`
  - `ChallengeCooldownError`
  - `snapshot.challenge` and `snapshot.blocked` properties.

---

### Changed & Improved

- **Page Fork Lifecycle Registration:** Forked pages created via `page.fork()` or `agent.fork()` are now explicitly registered in `browser.pages` and linked to their parent `OrbisContext`.
- **Resource Teardown:** `page.close()` now terminates all pending HTTP/HTTPS requests in the fetch pipeline using `AbortController`, preventing memory accumulation during high-frequency scraping.
- **Concurrency Guards:** Implemented `browser.maxConcurrentPages` limit (default: 100 tabs) to prevent accidental memory exhaustion on high-throughput server fleets.
- **Obfuscation & Build Stability:** Removed redundant npm lifecycle hooks (`prepublishOnly` removed in favor of `prepack`) avoiding Windows file locking collisions during packaging.
- **ESM Exports:** Hardened TypeScript declarations with explicit `export type` syntax to guarantee compatibility with Node 20/22 native ESM loaders.

---

### Fixed

- **Link Distillation Origin Preservation:** Fixed bug in `cleanUrlForLLM` where relative and absolute links stripped origins inappropriately.
- **CLI Proxy Forwarding:** Fixed issue where `--http-proxy` flags were not propagated to the internal undici agent.

---

## [0.1.0] - 2026-10-31

### Initial Release

The initial public evaluation release of **Orbis by Memora** — the lightweight headless browser built from the ground up for autonomous AI agents.

### Core Features

- **No-Render Headless Engine:** Downloads HTML, constructs the DOM, and executes JavaScript in an isolated V8 sandbox without layout or painting overhead. Runs in ~107 MB RAM across 10 tabs (vs >1,100 MB for Headless Chrome).
- **Interactive Action Map:** Automatically annotates interactive controls with numbered action IDs (`@1`, `@2`, `@email`), HTML roles, labels, and CSS selectors.
- **Markdown Distillation:** Produces clean, token-efficient Markdown representations of web content, saving 33–40% tokens compared to raw HTML.
- **10-Strategy Locator Engine:** Resolves elements by:
  1. Action ID (`@1`, `@2`)
  2. Semantic alias (`@email`, `@submit`)
  3. Visible text (`text=Sign In`)
  4. Form label (`label:Email`)
  5. Placeholder (`placeholder:Search`)
  6. Test ID (`testid:checkout-btn`)
  7. ARIA role (`role:button[name="Submit"]`)
  8. XPath (`//button[...]`)
  9. CSS selector (`#login-btn`)
  10. Bare name fallback (`username`)
- **State Diffs (`diff()`):** Calculates atomic page state deltas between turns, reporting added, removed, and mutated interactive elements.
- **Page Branching (`fork()`):** Clones page DOM, storage, and cookies in <5ms for speculative exploration.
- **Multi-Protocol Connectivity:**
  - TypeScript SDK (`@memoracompany/memora-orbis`)
  - Python SDK (`memora-orbis`)
  - Chrome DevTools Protocol (CDP) server for Playwright and Puppeteer
  - W3C WebDriver server for Selenium
  - Model Context Protocol (MCP) server exposing 15 tools for Claude, Cursor, and Windsurf
  - Command-line interface (`orbis fetch`, `orbis --eval`, `orbis serve`)
- **Stealth Profile:** Built-in evasion profile mimicking Chrome on Windows with proper navigator attributes and automation flags masked by default.
- **Compliance:** Opt-in RFC 9309 robots.txt compliance (`--obey-robots`).
