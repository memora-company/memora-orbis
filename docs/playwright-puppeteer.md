# Playwright and Puppeteer over CDP

Orbis serves a subset of the Chrome DevTools Protocol (CDP). Playwright's `chromium.connectOverCDP()` and Puppeteer's `puppeteer.connect()` can attach to it and drive pages through their normal APIs: navigation, selectors, `fill`, `click`, `evaluate`, extra headers. The engine underneath is not Chrome. It is the native Orbis engine, an HTML parser and DOM with a V8 script sandbox and no rendering. Code that depends on pixels, layout, frames or uploads behaves differently. This page shows how to connect, lists exactly which CDP methods are implemented, and records what was verified to work and fail against the 0.1.0 build.

Applies to: Orbis 0.1.0 (`@memoracompany/orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Start the daemon](#start-the-daemon)
- [Connect with Playwright](#connect-with-playwright)
- [Connect with Puppeteer](#connect-with-puppeteer)
- [Compatibility matrix](#compatibility-matrix)
- [Using Orbis features from a CDP client](#using-orbis-features-from-a-cdp-client)
- [Implemented CDP methods](#implemented-cdp-methods)
- [Discovery endpoints](#discovery-endpoints)
- [Concurrency and isolation](#concurrency-and-isolation)
- [Running a Playwright test suite on Orbis](#running-a-playwright-test-suite-on-orbis)
- [Debugging](#debugging)
- [Known issues](#known-issues)

---

## Start the daemon

```bash
npx -y @memoracompany/orbis --port 9222
```

CDP is the default protocol, so `orbis --port 9222` and `orbis serve --protocol cdp --port 9222` are equivalent. There are no `--cdp`, `--headless` or `--stealth` flags. Orbis is always headless and stealth is on by default (`--no-stealth` turns it off). See [cli-reference.md](./cli-reference.md).

The banner prints the endpoints:

```
  ▶ CDP WebSocket:      ws://localhost:9222/devtools/browser/memora-root
  ▶ Discovery Endpoint: http://localhost:9222/json/version
```

> **Security:** with `--host localhost` (the default) or `--host 127.0.0.1`, the server actually listens on `0.0.0.0`, which is every network interface. No authentication is enforced. Anyone who can reach the port can drive the browser, read the page and use the session endpoints to read and write JSON files on the host. Firewall the port, or run the daemon in an isolated network namespace. See [security.md](./security.md).

## Connect with Playwright

Install the client library. Playwright does not need to download browsers to connect over CDP:

```bash
npm install playwright-core      # or: npm install playwright
```

```typescript
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];          // Orbis exposes one default context
const page = await context.newPage();

await page.goto('https://example.com');
console.log(await page.title());                // "Example Domain"

await page.fill('#q', 'hello');
await page.click('button[type=submit]');        // real form submission, navigates
console.log(page.url());

const info = await page.evaluate(() => ({
  ua: navigator.userAgent,
  webdriver: navigator.webdriver,               // false with stealth on
}));

await page.close();
await browser.close();                          // see "Concurrency and isolation"
```

Python Playwright works the same way:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:9222")
    page = browser.contexts[0].new_page()
    page.goto("https://example.com")
    print(page.title())
    browser.close()
```

Use `connectOverCDP`. Do not use `chromium.connect()`, which expects Playwright's own server protocol, not CDP.

## Connect with Puppeteer

```bash
npm install puppeteer-core
```

```typescript
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
const page = await browser.newPage();
await page.goto('https://example.com');
console.log(await page.title());
await page.close();
browser.disconnect();     // disconnect rather than close() to leave the daemon's pages alone
```

`browserWSEndpoint: 'ws://localhost:9222/devtools/browser/memora-root'` also works.

> Puppeteer is not covered by the Orbis 0.1.0 automated tests, but Playwright over CDP is. Puppeteer issues extra CDP calls during start-up (for example `Page.setInterceptFile`, `Performance.enable`). Orbis answers calls to unknown domains with an empty result, so these do not fail, but features that depend on them silently do nothing. Validate your own flows before relying on Puppeteer in production.

---

## Compatibility matrix

Verified against the 0.1.0 build with Playwright 1.5x over CDP unless marked "by source", which means taken from `src/cdp/dispatcher.ts`.

| Feature | Status | Notes |
| :--- | :--- | :--- |
| `page.goto`, `reload`, `goBack`, `goForward` | Works | Redirects followed, cookies from redirects kept. |
| `page.title()`, `content()`, `url()` | Works | |
| CSS, text and XPath selectors, `locator()` | Works | Selectors run through Playwright's injected script inside the Orbis sandbox. |
| `page.fill`, `type`, `press` | Works | Via `Input.insertText` / `Input.dispatchKeyEvent`. |
| `page.click` on links and submit buttons | Works | Default actions (navigate, submit) are performed. |
| `page.evaluate`, `evaluateHandle`, `$eval` | Works | Runs in the page's V8 sandbox. |
| `page.setExtraHTTPHeaders` / `context.setExtraHTTPHeaders` | Works | Applied to subsequent requests from that page. |
| `navigator.webdriver` | `false` | With stealth on (default). |
| `context.newPage()`, `browser.newContext()` | Works | Contexts are logical. They do not isolate storage (see below). |
| `context.cookies()` | Returns `[]` | `Network.getCookies` / `Storage.getCookies` always return an empty list. |
| `context.addCookies()` | Silently ignored | No error, but the cookie is not sent (verified). Set cookies via `document.cookie` in `evaluate`, or use the Orbis session APIs. |
| `page.screenshot()`, `locator.screenshot()` | Returns a 1×1 transparent PNG | No rendering engine. The call succeeds so tools do not crash, but the image is blank. |
| `page.pdf()` | Fails | Throws a type error inside Playwright (no PDF data returned). |
| `setInputFiles` (file upload) | Fails | `DOM.setFileInputFiles` throws "File uploads are not supported". |
| `setViewportSize`, device emulation, geolocation, timezone, media | No effect | `Emulation.*` returns `{}`. Viewport metrics are fixed. |
| `boundingBox()`, hover/click coordinates | Synthetic | Boxes come from a simplified internal layout, not CSS layout. `boundingBox()` may return `null`. Do not use for visual assertions. |
| iframes | Not loaded | Only the top-level frame exists (`page.frames().length === 1`). |
| Shadow DOM | Not supported | |
| `page.route()` / request interception | Not supported | The `Fetch` domain is not implemented. |
| `page.on('request' / 'response')` | Partial | Events fire for the main document only, not for subresources. |
| `context.newCDPSession(page)` | **Crashes the Playwright client** | Playwright throws `Duplicate target <id>` from its target handling and the Node process exits. Use a raw WebSocket instead (see below). |
| `browser.close()` | Closes **every** page on the daemon | Calls `Browser.close`, which closes all pages for all connected clients. The daemon keeps serving. |
| Tracing, video, HAR recording | Not supported | Need rendering or the `Fetch` and `Tracing` domains. |

General rules:

- **Orbis fits server-rendered pages.** Test suites against client-rendered single-page apps (React, Vue, Angular) will likely fail. The native engine's page runtime has no `XMLHttpRequest`, `WebSocket`, `requestAnimationFrame`, `IntersectionObserver`, `ResizeObserver`, `getComputedStyle`, `matchMedia`, `history`, `crypto`, `TextEncoder`, `atob`/`btoa` or `performance`, and `MutationObserver` is a stub. When a CDP client attaches, Orbis installs a compatibility layer (`src/cdp/dom-compat.ts`) that adds some DOM properties and classes Playwright needs. That layer is not a full browser runtime. See [limitations.md](./limitations.md) for the complete table.
- Anything visual (screenshots, PDFs, layout, pixel coordinates, CSS computed styles) is out of scope. Run those tests on real Chrome.
- DOM-level automation (navigate, find, fill, click, read text, evaluate) is the supported surface.
- See [limitations.md](./limitations.md) for engine-wide limits such as JavaScript support.

## Using Orbis features from a CDP client

Orbis adds a custom CDP domain, `Orbis` (aliases `Memora` and `LP`), with the agent features. Because `context.newCDPSession()` crashes Playwright in 0.1.0, call it over a raw WebSocket on the page target:

```typescript
import WebSocket from 'ws';

// 1. Find the page target
const targets = await (await fetch('http://localhost:9222/json/list')).json();
const target = targets.find((t: any) => t.url.startsWith('http'));

// 2. Open a CDP connection to that page
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.once('open', r));

let nextId = 1;
function send(method: string, params: object = {}): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// 3. Use Orbis methods
const snap = await send('Orbis.getSemanticSnapshot', { excludeSelectors: ['nav', 'footer'] });
console.log(snap.actionMapText);

const { markdown } = await send('Orbis.getMarkdown', { focusSelector: 'main' });
const { diff } = await send('Orbis.diff');
await send('Orbis.act', { actionId: '@3', type: 'type', text: 'hello' });

ws.close();
```

| Method | Params | Result |
| :--- | :--- | :--- |
| `Orbis.getSemanticSnapshot` (also `getSemanticTree`, `snapshot`) | `focusSelector?`, `excludeSelectors?` | `SemanticPageSnapshot` (`url`, `title`, `tokenEstimate`, `interactiveCount`, `actions`, `actionMapText`, `markdown`) |
| `Orbis.getMarkdown` | `focusSelector?`, `excludeSelectors?` | `{ markdown }` |
| `Orbis.getStructuredData` | none | `{ structuredData }` (meta, OpenGraph, Twitter, JSON-LD) |
| `Orbis.diff` | `previousSnapshot?`, `focusSelector?`, `excludeSelectors?` | `{ diff, currentSnapshot }` |
| `Orbis.fillForm` | `fields`, `submit?` (**defaults to `true`**), `submitActionId?`, `steps?` | `FormFillResult` plus `snapshot` |
| `Orbis.saveSession` | `filePath?` | With `filePath`: writes the file on the daemon host. Without it: `{ success, session }` |
| `Orbis.loadSession` | `filePath` or `session` | `{ success, url }` |
| `Orbis.act` | `actionId`, `type` (`"click"` / `"type"`), `text?` | `{ success }`. Click dispatches the event only (no link navigation or form submit). |

The same features are also available over plain HTTP. See [http-api.md](./http-api.md).

A raw WebSocket opened alongside Playwright on the same page is fine. Playwright's crash comes from its own `attachToTarget` handling, not from a second connection.

## Implemented CDP methods

From `src/cdp/dispatcher.ts`. Any method in an unlisted domain returns `{}` without error. Any unlisted method in a listed domain also returns `{}` unless noted.

| Domain | Methods with behaviour |
| :--- | :--- |
| `Target` | `getTargets`, `createTarget`, `closeTarget`, `attachToTarget`, `detachFromTarget`, `setAutoAttach`, `setDiscoverTargets`, `getTargetInfo`, `createBrowserContext`, `getBrowserContexts`, `disposeBrowserContext` |
| `Page` | `enable`, `getFrameTree`, `getResourceTree`, `addScriptToEvaluateOnNewDocument`, `removeScriptToEvaluateOnNewDocument`, `setLifecycleEventsEnabled`, `createIsolatedWorld`, `navigate`, `reload`, `stopLoading`, `getNavigationHistory`, `navigateToHistoryEntry`, `getLayoutMetrics` (fixed viewport), `captureScreenshot` (1×1 PNG) |
| `Runtime` | `enable`, `evaluate` (`returnByValue`, `awaitPromise`), `callFunctionOn`, `getProperties`, `releaseObject`, `releaseObjectGroup`, `runIfWaitingForDebugger` |
| `DOM` | `enable`, `disable`, `getDocument`, `querySelector`, `querySelectorAll`, `getOuterHTML`, `describeNode`, `resolveNode`, `requestNode`, `scrollIntoViewIfNeeded`, `getContentQuads`, `getBoxModel` (synthetic layout), `focus`, `setFileInputFiles` (throws) |
| `Network` | `enable`, `setExtraHTTPHeaders`, `getCookies` / `getAllCookies` (always empty), `getResponseBody` (main document only) |
| `Storage` | `getCookies` (always empty) |
| `Input` | `dispatchMouseEvent`, `dispatchKeyEvent`, `insertText` |
| `Browser` | `getVersion`, `close` (closes all pages) |
| `Emulation` | all methods are no-ops |
| `Orbis` / `Memora` / `LP` | see [above](#using-orbis-features-from-a-cdp-client) |

Events emitted: `Target.targetCreated`, `Target.targetDestroyed`, `Target.attachedToTarget`, `Target.detachedFromTarget`, `Page.frameNavigated`, `Page.frameStartedLoading`, `Page.frameStoppedLoading`, `Page.frameRequestedNavigation`, `Page.domContentEventFired`, `Page.loadEventFired`, `Page.lifecycleEvent`, `Runtime.executionContextCreated`, `Runtime.executionContextsCleared`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`.

`Browser.getVersion` reports `product: "MemoraEngine/0.1.0"`, while `/json/version` reports `Browser: "Chrome/130.0.0.0"` for client compatibility.

## Discovery endpoints

| Endpoint | Description |
| :--- | :--- |
| `GET /json/version` | Browser info and `webSocketDebuggerUrl` (`ws://<host>:<port>/devtools/browser/memora-root`). |
| `GET /json` or `/json/list` | All pages, each with `id`, `url`, `title` and `webSocketDebuggerUrl` (`/devtools/page/<id>`). |
| `GET /json/new` | Creates a page and returns its target. |
| `GET /json/close/<id>` | Closes a page. |

The `webSocketDebuggerUrl` uses the `--host` value. If clients connect from another machine, start the daemon with `--host <reachable-name-or-ip>` so the advertised URLs are reachable. With `--host` set to a specific address, the server binds only to that address.

The same port also serves the agent REST API (`/orbis/*`). See [http-api.md](./http-api.md).

---

## Concurrency and isolation

- **Cookies are per page, not per context.** Each Orbis page has its own cookie jar. A login performed in one page is not visible in a second page, even in the same Playwright context. Keep a whole authenticated flow in one page, or move state with the session APIs ([sessions-and-auth.md](./sessions-and-auth.md)).
- **Within one page's jar, cookies are not domain-scoped.** A cookie received from one host is sent to every host that page requests. Do not visit untrusted sites in a page that holds an authenticated session ([security.md](./security.md)).
- **Contexts do not isolate anything.** `browser.newContext()` returns a logical context ID. Pages in different contexts are already isolated from each other in the same way pages in one context are (separate jars and storage).
- **`browser.close()` affects every client.** It closes all pages on the daemon, including pages other clients are using. In shared setups call `browser.close()` only when you own the daemon. Otherwise close your own pages and disconnect.
- **One daemon per test worker.** Run one daemon per Playwright worker or parallel job, each on its own port. That gives clean isolation and simple failure handling. See [production-deployment.md](./production-deployment.md).

## Running a Playwright test suite on Orbis

`playwright.config.ts` with a daemon per worker, started by a global fixture:

```typescript
// fixtures.ts
import { test as base, chromium, type Browser } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

async function waitForPort(port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Orbis did not start on port ${port}`);
}

export const test = base.extend<{}, { orbis: Browser }>({
  orbis: [async ({}, use, workerInfo) => {
    const port = 9400 + workerInfo.workerIndex;
    const proc: ChildProcess = spawn('npx', ['-y', '@memoracompany/orbis', '--port', String(port)], {
      env: { ...process.env, ORBIS_NO_TELEMETRY: '1' },
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    await waitForPort(port);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await use(browser);
    await browser.close();
    proc.kill('SIGTERM');
  }, { scope: 'worker' }],

  page: async ({ orbis }, use) => {
    const page = await orbis.contexts()[0].newPage();
    await use(page);
    await page.close();
  },
});
export { expect } from '@playwright/test';
```

```typescript
// login.spec.ts
import { test, expect } from './fixtures';

test('login form submits', async ({ page }) => {
  await page.goto('https://staging.example.com/login');
  await page.fill('#email', process.env.TEST_USER!);
  await page.fill('#password', process.env.TEST_PASSWORD!);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/dashboard/);
});
```

Keep visual tests (`toHaveScreenshot`) and upload tests in a separate project that runs on real Chromium.

## Debugging

- Set `DEBUG_CDP=1` in the daemon's environment to log every CDP request, response and event to stdout.
- Run Playwright with `DEBUG=pw:protocol` to see the client side.
- When a method you need returns an empty result, check [Implemented CDP methods](#implemented-cdp-methods). Unknown methods do not raise errors.
- Page console output and script errors are visible through `page.on('console')`, or through `memora_console` in MCP mode.

## Known issues

> **Known issue (0.1.0):** `context.newCDPSession(page)` makes Playwright throw `Duplicate target <id>` and terminates the client process. Use a raw WebSocket to `webSocketDebuggerUrl` for `Orbis.*` calls.

> **Known issue (0.1.0):** `context.addCookies()` and `context.cookies()` do nothing (`Network.getCookies` returns an empty list and cookie-setting methods are not implemented).

> **Known issue (0.1.0):** `page.pdf()` fails with a Playwright type error instead of a clear "unsupported" message.

> **Known issue (0.1.0):** The API key (`ORBIS_API_KEY` / `apiKey`) is read but never checked, and `localhost` binds to all interfaces.

See also: [selenium-webdriver.md](./selenium-webdriver.md), [http-api.md](./http-api.md), [limitations.md](./limitations.md), [troubleshooting.md](./troubleshooting.md).
