# TypeScript / Node.js SDK Reference

This is the complete reference for the Node.js API exported by `@memoracompany/memora-orbis`: the high-level `OrbisAgent` controller, the lower-level `OrbisBrowser`, `OrbisContext`, and `OrbisPage` classes, every exported type, and the building blocks (parser, distiller, locator engine, adapters) you can use on their own.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Installation and imports](#installation-and-imports)
- [Mental model in 60 seconds](#mental-model-in-60-seconds)
- [OrbisAgent](#orbisagent)
- [OrbisBrowser](#orbisbrowser)
- [OrbisPage](#orbispage)
- [Output formats: action map, diff summary, Markdown](#output-formats-action-map-diff-summary-markdown)
- [Types](#types)
- [Lower-level exports](#lower-level-exports)
- [Deprecated aliases](#deprecated-aliases)
- [Complete examples](#complete-examples)
- [Known issues](#known-issues)

---

## Installation and imports

```bash
npm install @memoracompany/memora-orbis
```

The package is ESM (`"type": "module"`) and ships TypeScript declarations. Use `import`, not `require`.

```ts
import {
  OrbisAgent,
  OrbisBrowser,
  OrbisPage,
  type SemanticPageSnapshot,
  type PageDiff,
} from '@memoracompany/memora-orbis';
```

Node.js 20 or 22 is required. No Chrome download is needed: the default engine is pure Node.js.

---

## Mental model in 60 seconds

- **OrbisBrowser** holds pages, one shared connection pool and the network settings (proxy, headers, robots.txt).
- **OrbisPage** is one tab: it downloads HTML, parses it into an in-memory DOM, runs the page's scripts in a V8 sandbox, and turns the result into an **action map** (numbered interactive elements `@1`, `@2`, ...) plus **Markdown**. There is no rendering engine, no layout and no screenshots. See [concepts.md](./concepts.md) and [limitations.md](./limitations.md).
- **OrbisAgent** is a convenience wrapper: one browser, one page, and (with `launch()`) a CDP server so Playwright/Puppeteer can attach to the same process.

Everything except navigation is **synchronous** and runs in your process. A typical agent turn is: `goto()` Ã¢â€ â€™ read `actionMapText` Ã¢â€ â€™ `act()` / `fillForm()` Ã¢â€ â€™ `diff()`.

---

## OrbisAgent

```ts
class OrbisAgent {
  readonly browser: OrbisBrowser;
  page: OrbisPage;
  readonly cdpServer?: CDPServer;
  apiKey?: string;

  constructor(browser: OrbisBrowser, page: OrbisPage, cdpServer?: CDPServer);

  static launch(options?: OrbisAgentOptions): Promise<OrbisAgent>;
  static connect(cdpUrl?: string, options?: { apiKey?: string }): Promise<OrbisAgent>;

  goto(url: string, options?: SnapshotOptions): Promise<SemanticPageSnapshot>;
  snapshot(options?: SnapshotOptions): SemanticPageSnapshot;
  markdown(options?: SnapshotOptions): string;
  diff(options?: SnapshotOptions): PageDiff;
  act(target: string, text?: string): boolean;
  selectOption(target: string, valueOrText: string): boolean;
  fillForm(fields: Record<string, string>, submit?: boolean | string): Promise<FormFillResult>;
  challenge(): ChallengeSignal | null;

  // Multi-tab and worker concurrency
  get tabs(): OrbisPage[];
  newTab(url?: string, options?: { isolated?: boolean; switch?: boolean }): Promise<OrbisPage>;
  switchTab(tabIdOrIndex: string | number): OrbisPage;
  closeTab(tabId?: string): boolean;
  newContext(options?: ContextOptions): OrbisContext;

  fork(): OrbisAgent;
  saveSession(filePath: string): void;
  loadSession(filePath: string): void;
  dumpSession(): SessionData;
  get cdpEndpoint(): string;
  close(): Promise<void>;
}

interface OrbisAgentOptions extends BrowserOptions {
  cdpPort?: number;
}
```

### `OrbisAgent.launch(options?)`

Creates an `OrbisBrowser`, starts a **CDP server** on `options.cdpPort ?? options.port ?? 9222`, opens one page and returns the agent.

| Option | Default | Notes |
| :--- | :--- | :--- |
| `cdpPort` | `9222` | Port for the embedded CDP/REST server. Must be free, otherwise `launch()` rejects with `EADDRINUSE`. |
| `stealth` | `true` | JavaScript fingerprint script. See [stealth.md](./stealth.md). |
| `apiKey` | `ORBIS_API_KEY` or `MEMORA_API_KEY` env | Stored on the server but **not enforced** in 0.1.0 (see [security.md](./security.md)). |
| `host` | `localhost` | `localhost`/`127.0.0.1` bind to `0.0.0.0` in 0.1.0. |
| `network`, `userAgent` | | See [BrowserOptions](#browseroptions) and [NetworkOptions](#networkoptions). |

```ts
const agent = await OrbisAgent.launch({ cdpPort: 9333 });
console.log(agent.cdpEndpoint); // http://localhost:9333
```

Because `launch()` always opens a port, give each concurrent agent in one process its own `cdpPort`. If you do not need CDP access at all, build the agent yourself without a server:

```ts
const browser = new OrbisBrowser();
const agent = new OrbisAgent(browser, browser.newPage()); // no port opened
```

If you pass both `port` and `cdpPort`, the server listens on `port` (the spread options win) while `cdpEndpoint` reports `cdpPort`. Pass only one of them.

### `OrbisAgent.connect(cdpUrl?, options?)`

```ts
const agent = await OrbisAgent.connect('http://localhost:9222', { apiKey: process.env.ORBIS_API_KEY });
```

Sends `GET <origin>/json/version` (with `x-api-key` and `Authorization: Bearer` headers when a key is available) and throws `Failed to connect to Orbis CDP at ...: HTTP <status>` if it is not 200.

> **Important (verified):** `connect()` only checks that the daemon is reachable. All subsequent calls (`goto`, `act`, `fillForm`, ...) run on a **new local in-process engine**, not on the remote daemon. The daemon's pages, cookies and sessions are untouched; nothing you do through this agent appears in the daemon's `/json/list`. To drive a remote daemon, use its [REST API](./http-api.md), the [Python SDK](./python-sdk.md) (which calls that REST API), or Playwright/Puppeteer over CDP ([playwright-puppeteer.md](./playwright-puppeteer.md)). `close()` on a connected agent only closes the local page.

### `agent.goto(url, options?)`

Navigates the agent's page (see [`page.goto`](#gotourl-timeoutoropts) for loading semantics: redirects, scripts, a settle phase of up to 5 s, 20 s timeout) and returns a fresh [`SemanticPageSnapshot`](#semanticpagesnapshot). `options` are [`SnapshotOptions`](#snapshotoptions) applied to the returned snapshot.

- HTTP error statuses (404, 500) do **not** throw; check `agent.page.lastStatus`.
- Network failures, timeouts and robots.txt blocks **do** throw.
- Relative URLs are resolved against the current page URL.
- `data:` URLs work (verified).

```ts
const snap = await agent.goto('https://news.ycombinator.com', { excludeSelectors: ['footer'] });
if (agent.page.lastStatus >= 400) throw new Error(`HTTP ${agent.page.lastStatus}`);
console.log(snap.title, snap.interactiveCount, `~${snap.tokenEstimate} tokens`);
console.log(snap.actionMapText);
```

### `agent.challenge()`

Unreleased. Returns the `ChallengeSignal` of the last navigation, or `null`. `blocking: true` means the loaded page is a CAPTCHA interstitial, block page or 429, not the real page. See [challenges.md](./challenges.md).

### `agent.snapshot(options?)`

Re-distills the current DOM without any network request. Use it after `act()` or after waiting for the page's scripts. The snapshot becomes the baseline for the next `diff()`.

### `agent.markdown(options?)`

Returns only the Markdown of the current page (`focusSelector`, `excludeSelectors`, `filterHidden` are honoured).

### `agent.diff(options?)`

Takes a new snapshot and compares it with the previous one (`page.lastSnapshot`), returning a [`PageDiff`](#pagediff). The new snapshot then becomes the baseline. If there is no previous snapshot, every element is reported as added with the summary `Initial page load: ...`.

Elements are matched between snapshots by their generated **selector**, not by `@ID`. See the [diff summary format](#diff-summary).

Note that resolving an `@ID` (in `act`, `fillForm`, `selectOption`) also takes a snapshot internally, so after `agent.act('@3')` the baseline is the page state just *before* the click, and `diff()` reports exactly what the click changed.

### `agent.act(target, text?)`

Synchronous. Resolves `target` with the [locator engine](./locators.md) and:

- with `text`: sets the element's value and dispatches `input` and `change` events (a `<select>` target is delegated to `selectOption`);
- without `text`: dispatches a single `click` event on the element.

Returns `false` if the target was not found, otherwise `true` (even if nothing happened on the page).

> **Important (verified):** `act(target)` only **dispatches a click event**. It does not perform browser default actions: it does **not** follow `<a href>` links, does **not** submit forms and does **not** toggle checkboxes. JavaScript click handlers do run, and if a handler assigns `location.href`, that navigation is still not performed by `act()`. To click "like a user" use `await agent.page.activate(target)`, which follows links, submits forms, toggles checkboxes/radios, selects options and performs script-requested navigations.

```ts
agent.act('label:Email', 'ada@example.com'); // type
agent.act('@7');                              // fire click handlers only

const navigated = await agent.page.activate('text=Next page'); // real click
```

Typing sets the `value` attribute in one step; no `keydown`/`keypress`/`keyup` events are fired. Widgets that only react to keyboard events will not see the text. See [limitations.md](./limitations.md).

### `agent.selectOption(target, valueOrText)`

Synchronous. Chooses an option in a dropdown and returns `true` on success.

| Target resolves to | Behaviour |
| :--- | :--- |
| `<select>` | Picks the first `<option>` whose `value` equals `valueOrText` (case-insensitive), else whose text equals it (case-insensitive), else whose text contains it. Marks it selected (deselecting others unless `multiple`) and fires `input` + `change` on the select, so dependent fields rendered by `change` handlers appear. |
| `<option>` | Selects that option. |
| anything else (custom dropdown) | Dispatches a click on the trigger, then searches the **whole document** for `[role="option"]`, `[role="menuitem"]`, `li`, `.dropdown-item`, `.select-option` and clicks the first one (in document order) whose text equals **or contains** `valueOrText`. |

The custom-dropdown fallback can pick an unrelated `<li>` (for example a navigation item) that appears earlier in the page and contains the same words. For custom widgets prefer clicking the trigger and then the exact option with a precise locator. See [best-practices.md](./best-practices.md).

```ts
agent.selectOption('#country', 'India');      // by text
agent.selectOption('#country', 'IN');         // by value
agent.selectOption('label:Country', 'india'); // case-insensitive
```

### `agent.fillForm(fields, submit = true)`

Fills several fields in one call and, **by default, submits the form**.

> **Important (verified):** `submit` defaults to `true`. Calling `agent.fillForm({ ... })` without a second argument submits the surrounding form and navigates. Pass `false` to only fill.

`fields` maps any [locator](./locators.md) to a string value. Per field:

| Element | What happens |
| :--- | :--- |
| `input[type=checkbox|radio]` | Checked if the value is `"true"`, `"1"`, `"yes"`, `"checked"` or `"on"`; **unchecked for any other value**. Fires `input` + `change`. |
| `<select>` | Selects the option whose `value` equals the string exactly, else whose trimmed text equals it exactly (case-sensitive). If none match, sets the select's `value` attribute and fires `change` (no option becomes selected). For fuzzy matching use `selectOption()`. |
| `[contenteditable]` | Replaces `textContent`, fires `input` + `change`. |
| anything else | Same as `act(target, value)`. |

Fields whose locator does not resolve are **skipped silently** and listed in `result.skipped`; `result.success` is always `true`. Always check `skipped`.

`submit`:

| Value | Behaviour |
| :--- | :--- |
| `true` (default) | If at least one field was filled, submits the `<form>` that contains the first filled field (or the first form on the page). Fires `submit`; if no handler calls `preventDefault()`, navigates with the form data (GET query string or urlencoded POST). |
| `false` | Do not submit. |
| locator string | Resolves it and performs a real click (`activate`), or submits it if it is a `<form>`. If the locator does not resolve, nothing is submitted and `submitted` is `false`. |

```ts
const res = await agent.fillForm(
  {
    'label:Email': 'ada@example.com',
    'placeholder:Password': process.env.APP_PASSWORD!,
    'input[name="terms"]': 'true',
    '#country': 'IN',
  },
  'text=Create account',
);
if (res.skipped.length) throw new Error(`Fields not found: ${res.skipped.join(', ')}`);
console.log(res.submitted, res.url, res.title);
```

Multi-step wizards are supported at the page level via `steps`; see [`page.fillForm`](#fillformoptions).

File inputs cannot be filled (no file upload support in 0.1.0).

### Multi-Tab Fleet and Context Concurrency

Starting in Orbis 0.1.2, `OrbisAgent` manages multi-tab workflows, tab switching, and isolated contexts natively.

#### `agent.tabs`

Returns an array of all active `OrbisPage` tabs open across the browser session.

```ts
console.log(`Open tabs: ${agent.tabs.length}`);
for (const tab of agent.tabs) {
  console.log(`Tab ID: ${tab.id}, URL: ${tab.url}`);
}
```

#### `agent.newTab(url?, options?)`

Spawns a new tab in the browser session. If a URL is provided, navigates to it immediately.

Options:
- `switch` (`boolean`, default: `true`): Whether to set this new tab as `agent.page` (the active tab).
- `isolated` (`boolean`, default: `false`): If `true`, runs the tab in an isolated `OrbisContext` with its own `CookieJar`.

```ts
// Open a secondary background tab without switching focus
const backgroundTab = await agent.newTab('https://news.ycombinator.com', { switch: false });

// Open a tab in a completely isolated context (e.g. for a secondary account)
const privateTab = await agent.newTab('https://dashboard.example.com', { isolated: true });
```

#### `agent.switchTab(tabIdOrIndex)`

Switches the agent's active working page (`agent.page`) to another tab by index (`0`, `1`, ...) or tab ID.

```ts
agent.switchTab(0); // Switch to the first tab
console.log(`Active page is now: ${agent.page.url}`);
```

#### `agent.closeTab(tabId?)`

Closes a specific tab by ID or the current active tab (`agent.page.id`). Aborts in-flight network requests immediately to free memory. If the active tab is closed, focus falls back to the most recently opened remaining tab.

```ts
agent.closeTab(backgroundTab.id);
```

#### `agent.newContext(options?)`

Creates an isolated `OrbisContext` (`BrowserContext`). Contexts hold their own cookie jars, storage, and tabs, enabling multi-agent workflows within a single process.

```ts
const context = agent.newContext();
const workerPage = context.newPage();
await workerPage.goto('https://app.example.com');
```

#### `agent.challenge()`

Returns a `ChallengeSignal` object if the loaded page is a CAPTCHA, Cloudflare Turnstile, AWS WAF, Akamai, or 429 block page; returns `null` otherwise.

---

### `agent.fork()`

Clones the current page into a new, independent page and returns a new `OrbisAgent` for it, sharing the same browser and CDP server.

What is copied: URL, the serialized current DOM (including typed values, which are stored as attributes), cookies, `localStorage`, `sessionStorage`. What is **not** copied (verified): the JavaScript heap and event listeners. A button whose click handler was attached by a script works in the original but does nothing in the fork. Link navigation and form submission through `page.activate()` work in the fork because they do not need JavaScript.

Cost: about 5 to 6 ms on a small test page in our runs (the project's website records 4.9 ms); it grows with DOM size. Forked pages are **not** registered with the browser: they do not appear in `browser.listPages()`, `/json/list` or over CDP.

Good uses: try several answers to a form, compare two navigation paths, let an LLM explore without touching the "main" state.

> **Known issue (0.1.0, verified):** calling `close()` on a forked agent also stops the **parent's** CDP server and closes the shared browser, because the fork shares them. Close a fork with `fork.page.close()` instead, and only call `close()` on the original agent.

```ts
const branch = agent.fork();
await branch.fillForm({ '#coupon': 'SAVE10' }, 'text=Apply');
const ok = branch.snapshot().markdown.includes('Discount applied');
branch.page.close();          // not branch.close()
if (ok) await agent.fillForm({ '#coupon': 'SAVE10' }, 'text=Apply');
```

### `agent.saveSession(filePath)` / `agent.loadSession(filePath)` / `agent.dumpSession()`

- `saveSession` writes a [`SessionData`](#sessiondata-and-pagestate) JSON file (cookies, localStorage, sessionStorage, current URL) and creates parent directories. The file contains authentication cookies in **plain text**: treat it like a password.
- `loadSession` validates the file (`version` must be `1`) and **merges** its cookies into the page's jar and restores storage. It does **not** navigate to the saved URL; call `goto()` afterwards.
- `dumpSession` returns the same object without writing a file.

Cookies are stored by name only (no domain/path/expiry); see [sessions-and-auth.md](./sessions-and-auth.md) and [security.md](./security.md) for the consequences.

```ts
await agent.goto('https://app.example.com/login');
await agent.fillForm({ 'label:Email': user, 'label:Password': pass }, 'text=Sign in');
agent.saveSession('./secrets/app-session.json');

// later, in another process
agent.loadSession('./secrets/app-session.json');
await agent.goto('https://app.example.com/dashboard');
```

### `agent.cdpEndpoint`

`http://localhost:<port>` for agents created with `launch()`, or the origin passed to `connect()`. Hand it to Playwright (`chromium.connectOverCDP(agent.cdpEndpoint)`), Puppeteer (`puppeteer.connect({ browserURL })`), Browser-Use or Stagehand. See [integrations.md](./integrations.md).

### `agent.close()`

Closes the page. For agents created by `launch()` (or the constructor) it also stops the CDP server and closes the browser and its connection pool. Always call it in a `finally` block; otherwise the open port keeps Node.js alive.

---

## OrbisBrowser

```ts
class OrbisBrowser {
  readonly options: BrowserOptions;
  readonly defaultContext: OrbisContext;
  readonly contexts: Map<string, OrbisContext>;
  maxConcurrentPages: number; // default: 100

  constructor(options?: BrowserOptions);
  newPage(options?: { isolated?: boolean; context?: OrbisContext }): OrbisPage;
  newContext(options?: ContextOptions): OrbisContext;
  getPage(id: string): OrbisPage | undefined;
  closePage(id: string): boolean;
  listPages(): OrbisPage[];
  get defaultPage(): OrbisPage;   // first open page; creates one if none
  close(): void;
}
```

- Defaults: `{ port: 9222, host: 'localhost', stealth: true }`. A top-level `userAgent` is copied into `network.userAgent` (an explicit `network.userAgent` wins).
- `maxConcurrentPages`: Safe concurrency ceiling (default: `100` tabs). Prevents unbounded memory growth.
- **Context Isolation:** `browser.newContext()` creates a dedicated `OrbisContext` with its own RFC 6265 `CookieJar` and storage, mirroring Playwright's `browser.newContext()`.
- `newPage({ isolated: true })`: Directly creates a page in its own dedicated, isolated context.
- All pages share one connection pool and one robots.txt cache.
- `close()` closes every page, all contexts, and the connection pool. It does not stop a `CDPServer`; stop that separately.
- Creating a browser does not open any port. Wrap it in `new CDPServer(browser)` only if you need CDP.

```ts
const browser = new OrbisBrowser({
  network: {
    useEnvProxy: true,
    headers: { 'Accept-Language': 'en-GB,en;q=0.9' },
    obeyRobots: true,
    robotsAgent: 'AcmeBot',
  },
});
const [a, b] = [browser.newPage(), browser.newPage()];
await Promise.all([a.goto('https://example.com'), b.goto('https://example.org')]);
browser.close();
```

---

## OrbisPage

`OrbisPage` (alias of the internal `MemoraPage` class) exposes everything the agent uses plus lower-level controls. Access it as `agent.page` or `browser.newPage()`.

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Random UUID. Used as the CDP target id and in `?id=` REST parameters. |
| `url` | `string` | Current URL (`about:blank` initially). |
| `document` | `MemoraDocument` | The live DOM. |
| `lastStatus` | `number` | HTTP status of the last navigation (`200` initially). |
| `lastHeaders` | `Record<string, string>` | Response headers of the last navigation (lower-case keys). Unreleased. |
| `lastChallenge` | `ChallengeSignal \| null` | CAPTCHA / bot-check / rate-limit signal of the last navigation; also `page.challenge()`. Unreleased. See [challenges.md](./challenges.md). |
| `lastChallengeCooldownSec` | `number` | Seconds the challenged host is paused for (`0` if none). Unreleased. |
| `lastSnapshot` | `SemanticPageSnapshot \| null` | Baseline for `diff()`. |
| `settleTimeoutMs` | `number` | Default settle budget for `goto()`, `5000`. Set to `0` for fastest loads of static pages. |
| `locatorEngine` | `LocatorEngine` | Defaults to the process-wide `defaultLocatorEngine`. Assign a new `LocatorEngine()` to customise one page only. |
| `fetcher` | `NetworkFetcher` | Cookie jar and HTTP client for this page. |
| `sandbox` | `V8Sandbox` | The page's JS context, created lazily on first use. |

### Navigation

#### `goto(url, timeoutOrOpts?)`

```ts
goto(url: string, timeoutOrOpts?: number | NavigateOptions): Promise<{ status: number; url: string }>;

interface NavigateOptions {
  timeoutMs?: number;            // default 20000, per navigation hop
  method?: string;               // default 'GET'
  body?: string;
  headers?: Record<string, string>;
  history?: 'push' | 'replace' | 'none'; // default 'push'
  settleTimeoutMs?: number;      // default page.settleTimeoutMs (5000); 0 disables
}
```

Loading sequence: request with manual redirect following (up to 20 hops, cookies captured on every hop, 303 and POSTÃ¢â€ â€™301/302 become GET) Ã¢â€ â€™ parse HTML Ã¢â€ â€™ run classic scripts in document order (external ones downloaded in parallel), then `defer`, then `async`; module scripts are bundled Ã¢â€ â€™ wait until fetch/XHR/short timers are idle (bounded by `settleTimeoutMs` and the timeout) Ã¢â€ â€™ follow `window.location` assignments made by scripts (up to 5). Pages without scripts never create a JS context.

```ts
await page.goto('https://api.example.com/search', {
  method: 'POST',
  body: JSON.stringify({ q: 'orbis' }),
  headers: { 'Content-Type': 'application/json' },
  settleTimeoutMs: 0,
});
```

Any response body is parsed as HTML, including JSON. To read a JSON API, use `page.evaluate` with `fetch()` or a normal HTTP client.

#### `activate(target)`

`activate(target: string | MemoraElement): Promise<boolean>`: a real user click. Dispatches `click`; if not prevented: toggles checkbox/radio (with `input`/`change`), selects `<option>`, performs script-requested navigation, follows `<a href>` (except `#...` and `javascript:`), or submits the owning form for submit buttons. Resolves `true` if it navigated. Throws `Element "<target>" not found` if the locator does not resolve.

#### `back()`, `forward()`, `reload()`, `canGoBack()`, `canGoForward()`

`back`/`forward` re-request the history entry (no bfcache) and resolve `null` when there is no entry. `reload` re-requests the current URL (no-op on `about:blank`).

#### `setContent(html, url = 'about:blank')`

Replaces the document with `html`, synchronously runs its inline scripts, and sets `page.url` (used to resolve relative links). No network request. Ideal for tests and for distilling HTML you already have.

```ts
page.setContent('<h1>Invoice</h1><button>Pay</button>', 'https://billing.example/');
console.log(page.getSemanticSnapshot().actionMapText);
```

#### `submitForm(form, submitter?)`

Fires `submit` and, unless prevented, navigates with the form data. Returns `true` if it navigated.

### Interaction

| Method | Returns | Description |
| :--- | :--- | :--- |
| `click(target)` | `boolean` | Dispatch-only click (what `agent.act(target)` uses). |
| `type(target, text)` | `boolean` | Set value + `input`/`change` (delegates `<select>` to `selectDropdownOption`). |
| `selectDropdownOption(target, valueOrText)` | `boolean` | What `agent.selectOption` uses. |
| `selectOption(optionElement)` | `void` | Select a specific `<option>` element. |
| `fillForm(options)` | `Promise<FormFillResult>` | See below. |
| `resolveElement(target)` | `MemoraElement \| null` | Resolve any [locator](./locators.md). |

#### `fillForm(options)`

```ts
page.fillForm({
  fields?: Record<string, string>,
  submit?: string | boolean,      // here there is NO default: omitted means "do not submit"
  submitActionId?: string,        // alias, takes precedence over submit
  steps?: FormFillOptions[],      // multi-step wizard
}): Promise<FormFillResult>
```

Unlike `agent.fillForm`, `page.fillForm` does not submit unless you ask. With `steps`, each step is executed in order (fill, then submit/next), with a 20 ms pause between steps, and the results are merged.

```ts
const res = await agent.page.fillForm({
  steps: [
    { fields: { 'label:Email': 'ada@example.com' }, submit: 'text=Next' },
    { fields: { 'label:Company': 'Analytical Engines Ltd' }, submit: 'text=Next' },
    { fields: { 'input[name="terms"]': 'true' }, submit: 'text=Finish' },
  ],
});
```

Note: a step's `submit: 'text=Next'` uses `activate()`, so a "Next" button that only reveals the next step with JavaScript works only if its handler runs synchronously or within the click; there is no waiting between steps beyond 20 ms. Call `await page.waitForIdle()` between separate `fillForm` calls for slower wizards.

### Reading the page

| Method | Returns | Notes |
| :--- | :--- | :--- |
| `title()` | `string` | `document.title`. |
| `content()` | `string` | Serialized DOM (wrapped in `<#document>...</#document>` in 0.1.0). |
| `getSemanticSnapshot(options?)` | `SemanticPageSnapshot` | Also updates `lastSnapshot`. |
| `getMarkdown(options?)` | `string` | |
| `diff(previous?, options?)` | `PageDiff` | Compare with `previous` or `lastSnapshot`. |
| `getStructuredData()` | `StructuredPageData` | Meta, Open Graph, Twitter, canonical, JSON-LD. |
| `querySelector(css)` / `querySelectorAll(css)` | `MemoraElement \| null` / `MemoraElement[]` | Plain CSS only (css-select). |
| `extract(selector, attribute?, limit = 50)` | `any[]` | See below. |
| `evaluate(code)` | `{ success, result \| error }` | See below. |
| `getLogs()` / `clearLogs()` | console entries | `{ type, text, timestamp }[]` captured from page scripts (errors from failed scripts and blocked loads included). |
| `dumpSession()` | `SessionData` | |

#### `extract(selector, attribute?, limit = 50)`

CSS selector, first `limit` matches. `attribute`: `'text'`/`'textContent'` Ã¢â€ â€™ trimmed text; `'html'`/`'innerHTML'` Ã¢â€ â€™ inner HTML; any other name Ã¢â€ â€™ that attribute (or `null`); omitted Ã¢â€ â€™ `{ tag, text, attributes }`.

```ts
page.extract('a.storylink', 'href', 30);
page.extract('table#prices td.price', 'text');
```

> **Known issue (0.1.0, verified):** with no `attribute`, the `attributes` field of each result serializes as an empty object `{}`. Request the attributes you need explicitly.

#### `evaluate(code)`

Runs `code` in the page's JS context with a 5 s CPU timeout and returns a serialized result object, not the raw value:

```ts
page.evaluate('document.title');
// { success: true, result: { type: 'string', value: 'Signup' } }
page.evaluate('1 === 2');
// { success: true, result: { type: 'boolean', value: false } }
page.evaluate('nope()');
// { success: false, error: 'nope is not defined' }
```

Result shapes: `{ type: 'undefined' }`, `{ type: 'null', value: null }`, primitives `{ type, value }`, arrays `{ type: 'object', subtype: 'array', value: [...] }` (first 50 items, each serialized), DOM nodes `{ type: 'object', subtype: 'node', description: '<tag>' }`, other objects `{ type: 'object', value: <JSON copy> }`. Promises are not awaited.

```ts
const r = page.evaluate('JSON.parse(localStorage.getItem("user") || "null")');
const user = r.success ? r.result.value : null;
```

The page DOM is Orbis's own lightweight implementation, not a full browser DOM. Among other things, elements have no `style` object, `dataset`, `innerText`, `insertAdjacentHTML()` or `remove()`, and there is no `alert()`/`confirm()`. Code you pass to `evaluate()` (and HTML you pass to `setContent()`) should use `getAttribute`/`setAttribute`/`removeAttribute`, `textContent` and `querySelector(All)`. Errors thrown by page scripts and event handlers do not reject your calls; they are recorded in `page.getLogs()` (and event-handler errors are also printed as `[MemoraDOM] Error in <event> handler`). See [limitations.md](./limitations.md) for the compatibility table.

### Waiting

| Method | Description |
| :--- | :--- |
| `waitForIdle(timeoutMs = settleTimeoutMs)` | Resolves `true` when in-flight `fetch()` calls, their promise chains and one-shot timers up to 1 s are done; `false` on timeout. `setInterval` and long timeouts are ignored. Immediately `true` for pages without scripts. |
| `waitForSelector(locator, { timeoutMs = 5000, state = 'visible' })` | Polls every 50 ms. Accepts any [locator](./locators.md). `'visible'` only checks the element's own `hidden`, `aria-hidden="true"` and inline `display:none` (not ancestors, not stylesheets). Throws `Timeout waiting for selector ...`. |
| `waitForFunction(fnOrCode, { timeoutMs = 5000, pollIntervalMs = 50 })` | Polls until truthy. Pass a **function**; see the known issue below. |
| `settleOnDOMMutation({ quietPeriodMs = 200, timeoutMs = 5000 })` | Currently equivalent to `waitForIdle(min(quietPeriodMs, timeoutMs))`. It does not observe DOM mutations. |

> **Known issue (0.1.0, verified):** `waitForFunction` with a **string** expression resolves `true` immediately even when the expression is false, because it tests the serialized result object (always truthy) instead of its value. Pass a function that reads the DOM yourself:
>
> ```ts
> await page.waitForFunction(() => page.querySelector('#results li') !== null, { timeoutMs: 10_000 });
> // or with page JS state:
> await page.waitForFunction(() => page.evaluate('window.appReady === true').result?.value === true);
> ```

### State, sessions and forking

| Method | Description |
| :--- | :--- |
| `fork()` | Returns a new independent page (see [`agent.fork()`](#agentfork)). Not registered with the browser. |
| `dumpState()` / `restoreState(state)` | `PageState` = URL, full HTML, cookies, storage. `restoreState` uses `setContent`, so it does not refetch. |
| `saveSession(path)` / `loadSession(path)` / `restoreSession(data)` | See [sessions-and-auth.md](./sessions-and-auth.md). |
| `close()` | Disposes the JS context (timers, pending requests). Use `browser.closePage(id)` to also unregister it. |

---

## Output formats: action map, diff summary, Markdown

### Action map

`snapshot.actionMapText` starts with a header and has one line per interactive element, in document order:

```text
=== INTERACTIVE ACTION MAP (<count> elements) ===
[@<n>] [<role>] "<text>"[ type="..."][ placeholder="..."][ value="..."][ href="..."][ [DISABLED]][ [CHECKED]][ [EXPANDED]][ [SELECTED]] (selector: <unique CSS selector>)
```

Real output for a small signup page (verified):

```text
=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "Work email" placeholder="Work email" (selector: #email)
[@2] [select] "--India" type="select" (selector: #country)
[@3] [input] "[Untitled input]" type="checkbox" (selector: input[name="terms"])
[@4] [button] "Create account" type="submit" (selector: [data-testid="go"])
```

When there are none: `=== NO INTERACTIVE ELEMENTS FOUND ===`.

Rules:

- Interactive = `a`, `button`, `input`, `select`, `textarea`, `summary`, elements with an interactive ARIA role (`button`, `link`, `checkbox`, `radio`, `tab`, `menuitem`, `switch`, `option`, `treeitem`), `tabindex="0"`, or an `onclick` attribute.
- `<text>` is the first non-empty of `aria-label`, `placeholder`, `title`, `value`, text content; whitespace collapsed, max 80 characters, `[Untitled <tag>]` if empty. **`<label>` text is not used**, so a labelled input without placeholder/aria-label shows as `[Untitled input]`; `<select>` shows its options' text run together.
- `role` is the explicit `role` attribute, else `link` for `a`, `button` for `button`, else the tag name.
- Hidden elements (`hidden`, `aria-hidden="true"`, `type="hidden"`, inline `display:none`/`visibility:hidden`, on the element or an ancestor) are skipped unless `filterHidden: false`. CSS from stylesheets is not evaluated.
- The selector is the first unique one of: `#id`, `[id="..."]`, `[data-testid|data-test-id|data-qa|data-cy="..."]`, `tag[name="..."]`, `tag[aria-label="..."]`, `tag[placeholder="..."]`, `tag.class`, else an `:nth-of-type` path.
- `tokenEstimate` = `ceil(characters of title + actionMapText + markdown / 4)`. It is a rough estimate, not a tokenizer count.
- The snapshot is **not always smaller than the raw HTML**. Each action line carries a full CSS selector, and elements without ids get long `:nth-of-type` paths, so link-dense pages can produce more text than their HTML. Measured examples (October 2026): the Hacker News front page gave a `tokenEstimate` of about 17,800 with 228 actions (raw HTML about 35 KB, roughly 8,700 tokens at 4 characters per token); the Wikipedia "Web browser" article gave about 120,000 with 1,230 actions (raw HTML about 416 KB). On small form-like pages the snapshot is typically smaller (the project's four benchmark fixtures averaged 37% fewer tokens than their raw HTML). Use `focusSelector`/`excludeSelectors`, send `markdown` and the action map separately only when needed, and build a compact map from `snapshot.actions` for large pages; see [best-practices.md](./best-practices.md).

`@IDs` are positional and are re-computed every time they are resolved. Read [locators.md](./locators.md#action-ids-n) before relying on them across turns.

### Diff summary

`diff.summary` (verified output after selecting a country revealed a hidden button):

```text
=== PAGE STATE DELTA ===

Added (1 elements):
  + [@5] [button] "Hidden btn" (selector: #extra > button:nth-of-type(1))
```

Full format:

```text
=== PAGE STATE DELTA ===
URL navigated: "<old>" -> "<new>"
Title changed: "<old>" -> "<new>"

Added (<n> elements):
  + [@<id>] [<role>] "<text>" (selector: <selector>)

Removed (<n> elements):
  - [@<id>] [<role>] "<text>" (selector: <selector>)

Mutated (<n> elements):
  * [@<id>] [<role>] "<text>" (text: "a" -> "b", value: ..., disabled: ..., checked: ..., expanded: ..., selected: ...)
```

or `No visual, DOM, or interactive changes detected.` Only `text`, `value`, `disabled`, `checked`, `expanded` and `selected` are tracked; non-interactive content changes are not reported (compare `markdown` for that). In "Removed", the `@id` is the element's number in the *previous* snapshot.

### Markdown

`convertToMarkdown` renders headings (`#` to `######`), paragraphs, blockquotes, `<pre>` code blocks, horizontal rules, ordered and unordered lists, tables, and inline links, images, bold, italics, strikethrough, inline code and line breaks. It skips `script`, `style`, `noscript`, `svg`, `canvas`, `template`, `head`, `meta` and `link`, plus hidden and excluded subtrees. Text of form controls (for example `<option>` labels) appears inline; placeholders do not. It is optimised for LLM reading, not for faithful round-tripping.

---

## Types

All types are exported from the package root.

### SnapshotOptions

```ts
interface SnapshotOptions {
  focusSelector?: string;      // CSS; only this subtree is distilled (falls back to the whole document if not found)
  excludeSelectors?: string[]; // CSS; matching subtrees are skipped (invalid selectors are ignored)
  filterHidden?: boolean;      // default true
}
```

### SemanticPageSnapshot

```ts
interface SemanticPageSnapshot {
  url: string;
  title: string;              // 'Untitled Page' if empty
  tokenEstimate: number;
  interactiveCount: number;
  actions: InteractiveElement[];
  actionMapText: string;
  markdown: string;
}
```

### InteractiveElement

```ts
interface InteractiveElement {
  actionId: string;      // '@1', '@2', ...
  tag: string;           // lower-case tag name
  role: string;
  text: string;
  name?: string;         // name attribute
  type?: string;         // type attribute, or 'textarea' / 'select'
  value?: string;
  placeholder?: string;
  href?: string;
  selector: string;      // unique CSS selector at snapshot time
  isClickable: boolean;  // false for inputs except type=submit/button
  isInput: boolean;      // input, textarea, select
  disabled: boolean;
  checked?: boolean;     // present only when true
  expanded?: boolean;
  selected?: boolean;
}
```

Tip: persist `selector`, not `actionId`, if you need to target the same element later.

### PageDiff

```ts
interface PageDiff {
  urlChanged: boolean;
  previousUrl: string;
  currentUrl: string;
  titleChanged: boolean;
  previousTitle: string;
  currentTitle: string;
  addedActions: InteractiveElement[];
  removedActions: InteractiveElement[];
  mutatedActions: Array<{
    actionId: string;
    selector: string;
    role: string;
    text: string;
    changes: Record<string, { from: any; to: any }>;
  }>;
  summary: string;
}
```

There is no `added`/`removed` field; use `addedActions`/`removedActions`.

### FormFillOptions / FormStep

```ts
interface FormFillOptions {
  fields?: Record<string, string>;
  submit?: string | boolean;
  submitActionId?: string;
  steps?: FormFillOptions[];
}
type FormStep = FormFillOptions;
```

### FormFillResult

```ts
interface FormFillResult {
  success: boolean;      // always true in 0.1.0; check `skipped`
  filled: string[];      // locators that were filled
  skipped: string[];     // locators that did not resolve
  fieldsFilled: number;
  submitted: boolean;
  url: string;           // after submission/navigation
  title: string;
}
```

### SessionData and PageState

```ts
interface SessionData {
  version: 1;
  createdAt: string;                        // ISO timestamp
  url: string;
  cookies: Record<string, string>;          // name -> value, no domain/path/expiry
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

interface PageState {
  url: string;
  html: string;
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}
```

### BrowserOptions

```ts
interface BrowserOptions {
  port?: number;                 // CDP server port, default 9222
  host?: string;                 // default 'localhost'
  stealth?: boolean;             // default true
  userAgent?: string;            // copied into network.userAgent
  viewport?: { width: number; height: number }; // accepted, not used by the native engine
  timeout?: number;              // accepted, not used in 0.1.0
  network?: NetworkOptions;
  engine?: 'native' | 'chrome' | 'auto'; // accepted, not used by OrbisBrowser (only the MCP server selects engines)
  apiKey?: string;               // not enforced in 0.1.0
}
```

### NetworkOptions

```ts
interface NetworkOptions {
  proxy?: string;              // http://, https://, socks5://, socks5h://, socks:// (user:pass@ allowed)
  proxyBearerToken?: string;   // Proxy-Authorization: Bearer <token> (http/https proxies only)
  noProxy?: string[];          // ['localhost', '.internal.corp', 'host:8080', '*']
  useEnvProxy?: boolean;       // HTTP(S)_PROXY / ALL_PROXY / NO_PROXY when proxy is not set
  headers?: Record<string, string>; // sent to every host
  userAgent?: string;
  timeoutMs?: number;          // see known issue: not applied to page.goto
  insecureTls?: boolean;       // accept invalid certificates
  obeyRobots?: boolean;        // RFC 9309 enforcement
  robotsAgent?: string;        // default 'MemoraBrowser'
}
```

Unlike the CLI's inert `--http-proxy`, `network.proxy` **does** route traffic when set programmatically. See [network-and-proxies.md](./network-and-proxies.md).

```ts
const browser = new OrbisBrowser({
  network: { proxy: 'http://user:pass@proxy.corp:3128', noProxy: ['localhost', '.corp.internal'] },
});
```

### StructuredPageData

```ts
interface StructuredPageData {
  url: string;
  title: string;
  description?: string;
  canonical?: string;
  openGraph: Record<string, string>; // og:* (property= or name=); og:title / og:description fill title / description if missing
  twitter: Record<string, string>;   // twitter:* names
  meta: Record<string, string>;      // every other <meta name=...> (description, robots, viewport, ...)
  jsonLd: any[];                     // parsed application/ld+json blocks
}
```

Verified example:

```json
{
  "url": "http://127.0.0.1:18082/",
  "title": "Signup",
  "openGraph": { "og:title": "Signup OG" },
  "twitter": {},
  "meta": { "description": "Create an account" },
  "jsonLd": [{ "@type": "WebPage", "name": "Signup" }],
  "description": "Create an account",
  "canonical": "https://example.com/signup"
}
```

---

## Lower-level exports

These are stable enough to use directly when you do not need a browser object.

| Export | Signature | Use |
| :--- | :--- | :--- |
| `parseHTML` | `(html: string) => MemoraDocument` | Parse HTML (parse5) without running scripts. |
| `parseFragmentInto` | `(html: string, container: MemoraElement) => void` | Parse a fragment into an element. |
| `selectOne` / `selectAll` | `(selector, root) => MemoraElement \| null` / `MemoraElement[]` | CSS selection on Orbis nodes. |
| `extractSemanticSnapshot` | `(doc, url, options?) => SemanticPageSnapshot` | Action map + Markdown for any document. |
| `convertToMarkdown` | `(doc, options?) => string` | Markdown only. |
| `extractStructuredData` | `(doc, url) => StructuredPageData` | Metadata only. |
| `computePageDiff` | `(prev, curr) => PageDiff` | Diff two snapshots you stored yourself. |
| `saveSessionToFile` / `loadSessionFromFile` / `validateSessionData` | | Session file helpers. |
| `LocatorEngine`, `defaultLocatorEngine`, strategy classes, `LocatorStrategy`, `LocatorContext` | | See [locators.md](./locators.md#custom-strategies). |
| `CDPServer` | `new CDPServer(browser)`; `start()`, `stop()`, `close()` | Serve CDP + REST for an existing browser. |
| `CDPDispatcher` | | CDP method dispatcher (internal building block). |
| `MCPServer` | `new MCPServer(network?, engine?)`; `start()` | Embed the MCP stdio server. See [mcp.md](./mcp.md). |
| `NativeEngineAdapter`, `ChromeEngine` | | The two MCP engine backends. |
| `NetworkFetcher` | | HTTP client with cookie jar. |
| `V8Sandbox` | | Page JS runtime. |
| `MemoraDocument`, `MemoraElement`, `MemoraNode`, `MemoraTextNode`, `MemoraCommentNode` | | DOM node classes. |
| `getBrowserUseConfig(agentOrPort = 9222)` / `getOrbisBrowserUseConfig` | `=> { cdpUrl, disableSecurity: true, extraChromiumArgs }` | Browser-Use settings. |
| `getStagehandConfig(agentOrPort = 9222)` / `getOrbisStagehandConfig` | `=> { env: 'LOCAL', localBrowserUrl, enableCaching: false }` | Stagehand settings. |
| `createOrbisLangChainTools(agent)` / `createMemoraLangChainTools(agent)` | `=> LangChainToolLike[]` | Five tool objects (`navigate`, `snapshot`, `act`, `diff`, `fill_form`) with `name`, `description`, `invoke`, `call`. They are plain objects, not LangChain `Tool` instances; wrap them (for example with `DynamicTool`). Their `act` tool uses `agent.act`, so it does not follow links. See [integrations.md](./integrations.md). |

Distilling HTML you already have, with no browser at all:

```ts
import { parseHTML, extractSemanticSnapshot } from '@memoracompany/memora-orbis';

const doc = parseHTML(htmlFromYourCrawler);
const snap = extractSemanticSnapshot(doc, 'https://source.example/page', { excludeSelectors: ['nav', 'footer'] });
await llm.invoke(`${snap.actionMapText}\n\n${snap.markdown}`);
```

---

## Deprecated aliases

`MemoraAgent` = `OrbisAgent`, `MemoraBrowser` = `OrbisBrowser`, `MemoraPage` = `OrbisPage`, `MemoraAgentOptions` = `OrbisAgentOptions`. They still work but new code should use the `Orbis*` names.

---

## Complete examples

### Minimal agent loop with an LLM

```ts
import { OrbisAgent, OrbisBrowser } from '@memoracompany/memora-orbis';

const browser = new OrbisBrowser();
const agent = new OrbisAgent(browser, browser.newPage()); // no CDP port needed

try {
  let snap = await agent.goto('https://shop.example.com');
  for (let turn = 0; turn < 10; turn++) {
    const decision = await askLLM(snap.actionMapText, snap.markdown); // your code: returns { action, target, text? }
    if (decision.action === 'done') break;

    if (decision.action === 'type') agent.act(decision.target, decision.text);
    else if (decision.action === 'click') await agent.page.activate(decision.target); // follows links, submits forms

    await agent.page.waitForIdle();
    const delta = agent.diff();      // compact feedback for the next turn
    snap = agent.snapshot();         // fresh @IDs for the next decision
    console.log(delta.summary);
  }
} finally {
  await agent.close();
}
```

### Robust login with verification

```ts
const agent = await OrbisAgent.launch({ cdpPort: 9400 });
try {
  await agent.goto('https://app.example.com/login');
  const res = await agent.fillForm(
    { 'label:Email': process.env.APP_USER!, 'label:Password': process.env.APP_PASS! },
    'text=Sign in',
  );
  if (res.skipped.length) throw new Error(`Missing fields: ${res.skipped}`);
  if (!res.submitted) throw new Error('Submit button not found');
  if (agent.page.lastStatus >= 400 || res.url.includes('/login')) throw new Error('Login failed');
  agent.saveSession('./secrets/app.json');
} finally {
  await agent.close();
}
```

More scenario-driven examples are in [use-cases.md](./use-cases.md); patterns for retries, timeouts and token budgets are in [best-practices.md](./best-practices.md).

---

## Known issues

| Issue | Workaround |
| :--- | :--- |
| `act(target)` does not follow links or submit forms. | `await agent.page.activate(target)`. |
| `agent.fillForm` submits by default. | Pass `false` as the second argument. |
| `connect()` does not drive the remote daemon. | Use the REST API, Python SDK, or CDP. |
| `close()` on a fork stops the parent's server and browser. | `fork.page.close()`. |
| `waitForFunction('expr')` returns immediately. | Pass a function. |
| `extract(sel)` without attribute returns `attributes: {}`. | Pass the attribute name. |
| `network.timeoutMs` / `--http-timeout` not applied to `page.goto`. | Pass `timeoutMs` to `page.goto`, or wrap calls in your own timeout. |
| `content()` is wrapped in `<#document>` tags. | Strip the wrapper. |
| Cookies are not scoped to domains. | One browser per site/tenant; see [security.md](./security.md). |
| `apiKey` is not enforced by the CDP server. | Network isolation or an authenticating proxy; see [security.md](./security.md). |

See also [limitations.md](./limitations.md) and [troubleshooting.md](./troubleshooting.md).
