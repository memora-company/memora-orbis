# Concepts

This page explains how Orbis works: what kind of browser it is, what happens when it loads a page, how it turns a page into an action map and Markdown, how action IDs, diffs, forks and sessions behave, and which engine runs in which mode. Read it once before you build anything serious. Most surprises in production come from one of the rules described here.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [What Orbis is (and is not)](#what-orbis-is-and-is-not)
- [Architecture](#architecture)
- [The page lifecycle](#the-page-lifecycle)
  - [JavaScript compatibility](#javascript-compatibility)
- [Multi-Tab and Context Concurrency](#multi-tab-and-context-concurrency)
- [The semantic snapshot](#the-semantic-snapshot)
- [Action IDs](#action-ids)
- [Markdown output](#markdown-output)
- [Diffs](#diffs)
- [Forks](#forks)
- [Sessions](#sessions)
- [Engines: native and Chrome](#engines-native-and-chrome)
- [Stealth](#stealth)
- [Pages, servers and sharing](#pages-servers-and-sharing)
- [Measured performance](#measured-performance)
- [Glossary](#glossary)

---

## What Orbis is (and is not)

Orbis is a **headless browser that does not render**. It downloads HTML, builds a DOM, runs the page's JavaScript in a sandbox, and then gives you a text view of the page designed for language models and automation code.

Because it skips layout and painting, it starts quickly and uses little memory. The same choice sets its limits:

| Orbis does | Orbis does not |
| :--- | :--- |
| Parse HTML into a standards-style DOM | Compute layout, positions or sizes (bounding boxes are synthetic) |
| Run classic and module `<script>`s, including external ones | Apply CSS stylesheets (only inline `style` and the `hidden` attribute affect visibility) |
| Support `fetch()` from page scripts, timers, `localStorage`, `sessionStorage`, cookies | Provide the full browser API to page scripts (see [JavaScript compatibility](#javascript-compatibility)) |
| Work very well on server-rendered HTML | Reliably run large client-rendered single-page apps |
| | Render pixels: screenshots are a 1x1 transparent PNG; no PDF |
| Follow redirects, submit forms, follow links, keep history | Load iframes or shadow DOM |
| Produce an action map, Markdown, metadata and diffs | Show dialogs (`alert`, `confirm`, `prompt` do not exist) |
| Speak CDP, WebDriver, MCP and its own REST API | Upload or download files, use Canvas or WebGL |

If a site only works with real rendering (canvas apps, heavy WebGL, layout-dependent interactions), use a full browser for that site. For MCP use, Orbis can drive a locally installed Chrome; see [Engines](#engines-native-and-chrome). The full list is in [Limitations](./limitations.md).

## Architecture

```text
                    Ã¢â€Å’Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Orbis process (Node.js) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â
                    Ã¢â€â€š                                                                              Ã¢â€â€š
 TypeScript SDK Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“ÂºÃ¢â€â€š  OrbisAgent Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº OrbisBrowser Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº OrbisContext (Context / CookieJar isolation)Ã¢â€â€š
                    Ã¢â€â€š                       Ã¢â€â€š              Ã¢â€â€š                                       Ã¢â€â€š
 REST  /orbis/*  Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“ÂºÃ¢â€â€š  CDP server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â¤              Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº OrbisPage (Tab 1: DOM, VM, fetch) Ã¢â€â€š
 CDP   /devtools Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“ÂºÃ¢â€â€š  (HTTP + WebSocket)   Ã¢â€â€š              Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº OrbisPage (Tab 2: DOM, VM, fetch) Ã¢â€â€š
                    Ã¢â€â€š                       Ã¢â€â€š                                                      Ã¢â€â€š
 WebDriver Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“ÂºÃ¢â€â€š  WebDriver server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Ëœ                                                      Ã¢â€â€š
                    Ã¢â€â€š                                                                              Ã¢â€â€š
 MCP (stdio) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“ÂºÃ¢â€â€š  MCP server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº native engine or Chrome engine                               Ã¢â€â€š
                    Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Ëœ
```

- **OrbisBrowser** holds contexts, pages and one shared connection pool. All pages share browser options and max concurrency guards.
- **OrbisContext** encapsulates an isolated `CookieJar`, browser storage, and tab group.
- **OrbisPage** is one tab: a URL, a DOM, a lazily created JavaScript context, an isolated cookie jar, storage and history.
- **OrbisAgent** is a high-velocity controller managing active tab switching (`tabs`, `newTab()`, `switchTab()`, `closeTab()`) and LLM distillation.
- **Servers** (CDP/REST, WebDriver, MCP) expose a browser to external tools and processes.

## The page lifecycle

When you call `goto(url)` (or a server receives a navigation), Orbis does the following:

1. **Request.** It sends the request through the network fetcher, using the stealth headers (unless disabled), your extra headers, user agent and cookies. With `--obey-robots`, it checks robots.txt first. Redirects are followed manually (up to 20 hops) so cookies set on each hop are kept.
2. **Parse.** It parses the response into a new DOM. The previous document's JavaScript context is discarded, so its timers and requests stop.
3. **Run scripts.** It runs scripts in the same order a browser parser would:
   - Classic scripts run in document order. External ones are downloaded in parallel but executed in order.
   - `defer` scripts run after them, then `async` scripts.
   - Module scripts (`type="module"`) are bundled with esbuild, then run like deferred or async scripts.
   - Data blocks (`type="application/json"`, templates and so on) never run.
   - Each batch of scripts has a 5-second watchdog. A script that runs longer is stopped and an error is logged to the page console.
   - Pages without scripts never create a JavaScript context.
4. **Settle.** It waits until the page's asynchronous work is finished: in-flight `fetch()` calls and their promise chains, and one-shot timers of 1 second or less (up to 10 levels of nesting). Repeating timers and longer timeouts are ignored. The wait is capped at 5 seconds by default (`page.settleTimeoutMs`, or `settleTimeoutMs` in `goto` options) and never goes past the navigation timeout.
5. **Script redirects.** If a script assigned `window.location`, Orbis follows it (up to 5 times) and repeats the steps.
6. **Ready.** `goto()` resolves with `{ status, url }`. `OrbisAgent.goto()` also returns the semantic snapshot.

The default navigation timeout is 20 seconds for `page.goto()`. Pass a number or `{ timeoutMs }` as the second argument to change it per call. See [Network and proxies](./network-and-proxies.md).

> **Known issue (0.1.0):** `--http-timeout` and `network.timeoutMs` do not change the navigation timeout. `page.goto()` always passes its own timeout (20 seconds unless you give one), which overrides them. A test with `orbis fetch --http-timeout 1000` against a page that responds after 3 seconds still loaded the page. Set the timeout on `goto()` in code; on the CLI there is currently no way to shorten it.

### JavaScript compatibility

Page scripts run in a Node.js `vm` context with a DOM that implements the most common parts of the web platform, not all of it. The table below was produced by evaluating `typeof <name>` inside a page with the native engine (SDK use, no CDP client attached):

| Available to page scripts | Not available in 0.1.0 |
| :--- | :--- |
| `document`, `window` (`self`, `top`, `parent`), `location`, `navigator`, `screen`, `console` | `XMLHttpRequest`, `WebSocket`, `Worker` |
| `fetch`, `Headers`, `Request`, `Response`, `FormData`, `Blob`, `AbortController` | `history` (no `pushState`), `requestAnimationFrame`, `matchMedia`, `performance` |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask` | `Event`, `CustomEvent` constructors, `structuredClone` |
| `localStorage`, `sessionStorage` | `crypto`, `TextEncoder`, `atob`, `btoa` |
| `URL`, `URLSearchParams`, `Promise`, `JSON`, `Intl` | `getComputedStyle`, `IntersectionObserver`, `ResizeObserver` |
| `MutationObserver` (a stub: callbacks never fire) | `alert`, `confirm`, `prompt` |

On elements, `classList`, `appendChild`, `insertBefore`, `removeChild`, `append`, `prepend`, `innerHTML`, `outerHTML`, `textContent`, `value`, `getAttribute`/`setAttribute`, `addEventListener`, `closest`, `matches` and `getBoundingClientRect` are available. **`element.style`, `dataset`, `innerText`, `remove()` and `cloneNode()` are not.** When a CDP client (Playwright, Puppeteer) uses a page, Orbis installs a compatibility layer in that process that adds `style`, `getComputedStyle`, event constructors and reflected properties such as `hidden`, `checked` and `disabled`. Do not rely on it in SDK, REST, WebDriver or MCP use.

What this means in practice:

- A script that does `el.style.display = 'block'` throws `TypeError: Cannot set properties of undefined`. The rest of that handler does not run, so content it would have shown stays hidden.
- `element.value` only reflects the `value` attribute. For a `<select>`, page scripts always read `''`, so handlers like `onchange="load(this.value)"` get an empty string. Orbis's own `selectOption()` and form submission handle selects correctly.
- Many large client-rendered applications (React, Vue, Angular bundles, analytics libraries) depend on missing APIs and may render nothing. Server-rendered pages work well.
- **The sandbox is not a security boundary.** Page scripts run in a Node.js `vm` context, and a page can reach the host's `process` object through standard JavaScript tricks (verified in 0.1.0). Any site Orbis loads can run code with the privileges of the Orbis process. Run Orbis in an isolated container without secrets when it visits sites you do not control. See [Security](./security.md).
- Script errors do not stop Orbis. They are written to the page console. Read them with `page.getLogs()`, the `memora_console` MCP tool, or watch stderr for `[MemoraDOM] Error in ... handler`.
- Before you build on a site, run `orbis fetch <url> --dump action_map` and check that the elements you need are listed. If they are not, use a full browser for that site or, with MCP, `--engine chrome`.

## Multi-Tab and Context Concurrency

Starting in Orbis 0.1.2, Orbis provides high-performance multi-tab fleet management within a single process:

1. **Lightweight Tabs (`OrbisPage`):** Because Orbis pages skip pixel rendering and compositing, each tab uses only a few megabytes of memory (~10 MB vs >100 MB in real Chrome). You can open dozens of background tabs concurrently without CPU or memory spikes.
2. **Context Isolation (`OrbisContext`):** `agent.newContext()` or `browser.newContext()` creates an independent browser context. Each context maintains its own **CookieJar** (RFC 6265 compliant with domain, path, and security scoping) and independent storage. Multiple agent workers can log into completely different accounts on the same site concurrently without session bleed.
3. **Tab Lifecycle & Memory Safety:** When a tab is closed via `agent.closeTab(id)` or `page.close()`, all pending in-flight network requests are instantly cancelled using `AbortController`, timers are stopped, and DOM references are freed immediately.
4. **Concurrency Safety Limit:** `browser.maxConcurrentPages` (default: 100) protects against accidental unbounded page creation in runaway loops.
5. **Agent Tab Switching:** `agent.tabs` lists all open pages; `agent.newTab(url, { isolated })` creates tabs; `agent.switchTab(indexOrId)` changes active focus; `agent.closeTab(id)` cleans up.

## The semantic snapshot

A snapshot (`agent.snapshot()`, `page.getSemanticSnapshot()`) is the main output of Orbis:

```typescript
interface SemanticPageSnapshot {
  url: string;
  title: string;            // document title, or 'Untitled Page'
  tokenEstimate: number;    // ceil(characters of title + action map + markdown / 4)
  interactiveCount: number; // number of actions
  actions: InteractiveElement[];
  actionMapText: string;    // the text block you give to an LLM
  markdown: string;         // the page content as Markdown
}
```

### Which elements become actions

An element is listed in the action map when it is any of these:

- a native interactive tag: `a`, `button`, `input`, `select`, `textarea`, `summary`
- an element with role `button`, `link`, `checkbox`, `radio`, `tab`, `menuitem`, `switch`, `option` or `treeitem`
- an element with `tabindex="0"`
- an element with an inline `onclick` attribute

These are skipped entirely, including their children: `script`, `style`, `noscript`, `svg`, `canvas`, `template`.

By default, hidden elements are left out (`filterHidden` is on). An element counts as hidden when it, or any ancestor, has the `hidden` attribute, `aria-hidden="true"`, an inline style with `display: none` or `visibility: hidden`, or is `<input type="hidden">`. Orbis does not apply stylesheets, so an element hidden only by a CSS class is still listed.

Elements matching `excludeSelectors` are skipped with their children. With `focusSelector`, only the first element matching the selector and its descendants are walked.

### How each action is described

Each action line has this format:

```text
[@<n>] [<role>] "<text>" type="..." placeholder="..." value="..." href="..." [DISABLED] [CHECKED] [EXPANDED] [SELECTED] (selector: <css>)
```

- **role** is the `role` attribute if present, otherwise `link` for `a`, `button` for `button`, or the tag name.
- **text** is the first non-empty value of `aria-label`, `placeholder`, `title`, `value`, then the element's text. Whitespace is collapsed and the text is cut at 80 characters. If all are empty, it is `[Untitled <tag>]`.
- **The text of a `<label>` is not used.** An input that only has a `<label for>` shows as `[Untitled input]`. The `label:` locator still finds it. See [Locators](./locators.md).
- **selector** is a CSS selector unique in the document, chosen in this order: `#id`, test ID attributes (`data-testid`, `data-test-id`, `data-qa`, `data-cy`), `tag[name]`, `tag[aria-label]`, `tag[placeholder]`, a unique class, then a path with `:nth-of-type()`.
- **value** reflects the current value, including values you typed. This means typed passwords appear in the action map. See [Security](./security.md).

## Action IDs

Action IDs (`@1`, `@2`, ...) are short handles for the elements in a snapshot. They let a language model pick an element without writing a selector.

The rules:

1. **They are positional.** IDs are assigned in document order, starting at `@1`, every time a snapshot is taken.
2. **They are recomputed when you use them.** When you act on `@3`, Orbis takes a fresh snapshot of the **whole document** and uses the third element of that snapshot. If the page changed since the model saw the map (a script added a banner, a dropdown opened), `@3` can point to a different element.
3. **Focused or filtered snapshots use different numbers.** A snapshot taken with `focusSelector` or `excludeSelectors` numbers only the elements it includes, but acting on an ID always resolves against the full, unfiltered document. Do not act on IDs taken from a focused or filtered snapshot. Use the `selector` field of the action instead, or use filters only for the Markdown you send to the model.
4. **Hidden elements are not numbered** (with the default `filterHidden`).

Practical consequences:

- Take a new snapshot (or a diff) after every action, and give the model only the latest map.
- For scripted, deterministic automation, prefer stable locators (`label:`, `testid:`, `#id`, the action's `selector`).
- Semantic aliases such as `@email` match by name, placeholder, text or selector substring and are less sensitive to position. See [Locators](./locators.md).

## Markdown output

`agent.markdown()`, `page.getMarkdown()` and the `markdown` field of a snapshot give the readable content of the page:

- Supported: headings, paragraphs, links, bold, italic, inline code, strikethrough, images, line breaks, block quotes, preformatted blocks, horizontal rules, ordered and unordered lists, and tables.
- Not rendered: `script`, `style`, `noscript`, `svg`, `canvas`, `template` and everything in `<head>`.
- The same `focusSelector`, `excludeSelectors` and `filterHidden` options apply.
- Form controls are not described in Markdown. They are in the action map.

Use `excludeSelectors` such as `["nav", "footer", ".cookie-banner"]` to remove boilerplate before sending a page to a model.

## Diffs

`agent.diff()` (or `page.diff()`) takes a new snapshot and compares it with the page's **last snapshot**. It returns:

```typescript
interface PageDiff {
  urlChanged: boolean;   previousUrl: string;   currentUrl: string;
  titleChanged: boolean; previousTitle: string; currentTitle: string;
  addedActions: InteractiveElement[];
  removedActions: InteractiveElement[];
  mutatedActions: Array<{ actionId: string; selector: string; role: string; text: string;
                          changes: Record<string, { from: any; to: any }> }>;
  summary: string;       // human- and LLM-readable text
}
```

How it works:

- Elements are matched between snapshots by their generated **selector**.
- Mutations are tracked for `text`, `value`, `disabled`, `checked`, `expanded` and `selected`.
- If there is no previous snapshot, the diff reports an "Initial page load" and lists every action as added.
- **Every snapshot and every diff replaces the baseline.** Resolving an `@ID` or an `@alias` also takes a snapshot, so the baseline becomes the state just before that action. Calling `diff()` twice in a row returns "No visual, DOM, or interactive changes detected." the second time.

Example summary:

```text
=== PAGE STATE DELTA ===
URL navigated: "https://shop.example/cart" -> "https://shop.example/checkout"
Title changed: "Cart" -> "Checkout"

Added (2 elements):
  + [@4] [input] "Card number" (selector: #card)
  + [@5] [button] "Pay now" (selector: #pay)

Mutated (1 elements):
  * [@2] [input] "Promo code" (value: undefined -> "SPRING")
```

Diffs are usually much shorter than a full snapshot, which makes them a good thing to send to a model after each step of a multi-step task.

## Forks

`agent.fork()` (or `page.fork()`) creates a new, independent page that starts from the current one. Use it to try several options from the same starting point without reloading.

What is copied:

- the URL
- the current DOM, serialized to HTML (including typed values and checked states)
- cookies, `localStorage` and `sessionStorage`

What is **not** copied:

- JavaScript variables and **event listeners**. A button whose behaviour was attached by a script will usually do nothing in the fork.
- History.

Other facts:

- In Orbis 0.1.2+, forked pages are registered with the browser and context, so they appear in `listPages()`, `agent.tabs`, and can be managed like standard tabs.
- Forking is extremely fast. It serializes and re-parses the DOM in memory: about 5 ms on standard test pages.
- After forking, the two pages do not affect each other. Navigations in a fork make their own network requests.

Forks work well for reading, extracting, filling forms, following plain links (`activate()` on an `<a href>`) and submitting standard HTML forms. They are not suitable for interactions that depend on JavaScript event handlers.

## Sessions

A session is the authentication state of a page: cookies, `localStorage` and `sessionStorage`, plus the URL it was saved from. Orbis saves it as JSON (format version 1):

```json
{
  "version": 1,
  "createdAt": "2026-10-31T09:12:44.120Z",
  "url": "https://app.example.com/dashboard",
  "cookies": { "sid": "..." },
  "localStorage": { "auth_token": "..." },
  "sessionStorage": {}
}
```

Restoring a session sets cookies and storage. It does **not** navigate: call `goto()` afterwards. Session files contain live credentials; store them like passwords. See [Sessions and authentication](./sessions-and-auth.md).

> **Note on Storage:** With the native engine, `localStorage` and `sessionStorage` belong to the current document and are reset on every navigation. Cookies survive navigation; restored storage does not. Cookie-based logins work reliably across navigations.

> **Note on Cookies:** Orbis introduces an isolated, domain-aware `CookieJar` (RFC 6265 compliant). Cookies are scoped per-domain and per-context. Parallel agent personas operating in different contexts (`agent.newContext()`) or isolated tabs (`agent.newTab({ isolated: true })`) maintain completely separate cookie jars.

## Engines: native and Chrome

| Engine | Used by | What it is |
| :--- | :--- | :--- |
| **native** | SDK, CLI `fetch`/`--eval`, CDP/REST server, WebDriver server, MCP (when chosen) | The built-in TypeScript engine described on this page |
| **chrome** | MCP server only | A real headless Chrome or Edge, driven through `playwright-core`, with the same Orbis tools on top |

The `--engine` flag (`auto`, `native`, `chrome`) only affects `--mcp`. With `auto` (the default), the MCP server uses Chrome or Edge if it finds one in a standard install location, and the native engine otherwise. Every other mode always uses the native engine.

## Stealth

Stealth is **on by default** in every mode. There is no `--stealth` flag; use `--no-stealth` (CLI) or `stealth: false` (SDK) to turn it off. Stealth sends a consistent Chrome 130 on Windows header profile and patches common automation signals in the page's JavaScript environment, such as `navigator.webdriver`. It does not change TLS or HTTP/2 fingerprints and does not solve CAPTCHAs. Details: [Stealth](./stealth.md).

## Pages, servers and sharing

How many pages exist depends on how you use Orbis. This matters for concurrency:

| Mode | Pages | Safe for concurrent users? |
| :--- | :--- | :--- |
| `OrbisAgent.launch()` | Multiple tabs and isolated contexts (`tabs`, `newTab()`, `newContext()`) | Yes. Supports multi-tab concurrency and multi-agent context isolation |
| REST API and Python SDK | Endpoints use the daemon's **default page** unless you pass `?id=`; `/orbis/goto` always uses the default page | No. Run one daemon per concurrent agent |
| CDP (Playwright, Puppeteer) | One page per target created by the client; supports CDP `Target.createBrowserContext` | Yes, within limits. `Browser.close` from one client closes all pages |
| WebDriver (Selenium) | One page per session; at most 16 sessions by default; idle sessions closed after 5 minutes | Yes |
| MCP | One active page per server process | One client per process (the normal MCP model) |

See [Production deployment](./production-deployment.md) for sizing and isolation patterns.

## Measured performance

These numbers were measured by the Orbis team. They are not guarantees. Measure on your own pages.

| Measurement | Result | Context |
| :--- | :--- | :--- |
| Time to load 200 local test pages one after another | 0.31 s (headless Chrome: 3.4 s) | Windows 11 laptop, median of 3 runs, October 2026, timed after the browser started |
| Memory with 10 tabs open | 107 MB (headless Chrome: 1,154 MB) | Same machine; Orbis = Node.js RSS, Chrome = Playwright headless shell working set |
| Tokens of distilled output vs raw HTML | 33Ã¢â‚¬â€œ40% fewer (37% average) | The four HTML fixtures in the Orbis benchmark |
| Parse page and build action map plus Markdown | About 4 ms average | Same four fixtures |
| Fork a page | 4.9 ms | Orbis test fixture |

Token savings on real pages are **not guaranteed**. Every line of `actionMapText` includes the element's CSS selector, and on pages with many links inside nested tables or lists those selectors are long `:nth-of-type()` paths. Measured on 31 October 2026 with `orbis fetch --dump action_map`:

| Page | Raw HTML | Orbis `tokenEstimate` (action map + Markdown) |
| :--- | :--- | :--- |
| Hacker News front page | about 35 KB (about 8,700 tokens at 4 characters per token) | about 17,800 tokens, 228 actions |
| Wikipedia article "Web browser" | about 416 KB (about 104,000 tokens) | about 120,000 tokens, 1,230 actions |

To keep prompts small:

- Pass `focusSelector` (for example `main`, `#content`) and `excludeSelectors` (for example `nav`, `footer`, `.sidebar`).
- Send the model a compact map built from `snapshot.actions` (action ID, role, text) without selectors. See [Best practices](./best-practices.md).
- Send `markdown` only when the model needs to read content, and `diff().summary` after each step instead of a full snapshot.

## Glossary

| Term | Meaning |
| :--- | :--- |
| **Action** | An interactive element listed in a snapshot |
| **Action ID** | A positional handle such as `@3`, recomputed on every snapshot |
| **Action map** | The text list of actions (`actionMapText`) meant for an LLM prompt |
| **Activate** | A click with browser default behaviour: follows links, submits forms, toggles checkboxes (`page.activate()`) |
| **Daemon** | A long-running `orbis` server process (CDP/REST or WebDriver) |
| **Diff** | Comparison between the last snapshot and the current state |
| **Distill** | Turn a page into an action map plus Markdown |
| **Fork** | A new page created from a copy of the current page's DOM, cookies and storage |
| **Locator** | A string that identifies an element (`@1`, `label:Email`, `#id`, ...) |
| **Native engine** | The built-in TypeScript browser engine |
| **Session** | Saved cookies, `localStorage` and `sessionStorage` |
| **Settle** | The wait after scripts run, until the page's async work finishes |
| **Snapshot** | A `SemanticPageSnapshot`: URL, title, actions, action map, Markdown, token estimate |
