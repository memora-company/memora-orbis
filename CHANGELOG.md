# Orbis Changelog

All notable changes to the Orbis headless browser engine (`@memoracompany/memora-orbis` on npm and `memora-orbis` on PyPI) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

The initial public evaluation release of **Orbis by Memora** â€” the lightweight headless browser built from the ground up for autonomous AI agents.

### Core Features

- **No-Render Headless Engine:** Downloads HTML, constructs the DOM, and executes JavaScript in an isolated V8 sandbox without layout or painting overhead. Runs in ~107 MB RAM across 10 tabs (vs >1,100 MB for Headless Chrome).
- **Interactive Action Map:** Automatically annotates interactive controls with numbered action IDs (`@1`, `@2`, `@email`), HTML roles, labels, and CSS selectors.
- **Markdown Distillation:** Produces clean, token-efficient Markdown representations of web content, saving 33â€“40% tokens compared to raw HTML.
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
