# Playwright and Puppeteer over CDP

Orbis serves a subset of the Chrome DevTools Protocol (CDP). Playwright's `chromium.connectOverCDP()` and Puppeteer's `puppeteer.connect()` can attach to it and drive pages through their normal APIs: navigation, selectors, `fill`, `click`, `evaluate`, extra headers. The engine underneath is not Chrome. It is the native Orbis engine, an HTML parser and DOM with a V8 script sandbox and no rendering. Code that depends on pixels, layout, frames or uploads behaves differently. This page shows how to connect, lists exactly which CDP methods are implemented, and records what was verified to work and fail against the 0.1.0 build.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

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
npx -y @memoracompany/memora-orbis --port 9222
```

CDP is the default protocol, so `orbis --port 9222` and `orbis serve --protocol cdp --port 9222` are equivalent. There are no `--cdp`, `--headless` or `--stealth` flags. Orbis is always headless and stealth is on by default (`--no-stealth` turns it off). See [cli-reference.md](./cli-reference.md).

The banner prints the endpoints:

```
  ▶ CDP WebSocket:      ws://localhost:9222/devtools/browser/memora-root
  ▶ Discovery Endpoint: http://localhost:9222/json/version
```

> **Security:** with `--host localhost` (the default) or `--host 127.0.0.1`, the server listens on `127.0.0.1` only. Use `--host 0.0.0.0` only when clients on other machines or containers must connect, and then set `ORBIS_API_KEY`. With a key set, CDP clients must send it, for example in the URL (`http://localhost:9222?apiKey=<key>`) or as an `x-api-key` / `Authorization: Bearer` header (Playwright: `connectOverCDP(url, { headers: { 'x-api-key': key } })`). See [security.md](./security.md).

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
| `context.cookies()`, `context.addCookies()`, `context.clearCookies()` | Works | Read, add and clear the context's cookies. Added cookies are sent on the next requests to their site. |
| `page.screenshot()`, `locator.screenshot()` | Returns a 1×1 transparent PNG | No rendering engine. The call succeeds so tools do not crash, but the image is blank. |
| `page.pdf()` | Fails | Throws a type error inside Playwright (no PDF data returned). |
| `setInputFiles` (file upload) | Fails | `DOM.setFileInputFiles` throws "File uploads are not supported". |
| `setViewportSize`, device emulation, geolocation, timezone, media | No effect | `Emulation.*` returns `{}`. Viewport metrics are fixed. |
| `boundingBox()`, hover/click coordinates | Synthetic | Boxes come from a simplified internal layout, not CSS layout. `boundingBox()` may return `null`. Do not use for visual assertions. |
| iframes | Not loaded | Only the top-level frame exists (`page.frames().length === 1`). |
| Shadow DOM | Not supported | |
| `page.route()` / request interception | Works | `fulfill`, `continue` and `abort` work for navigations, scripts and page `fetch()` requests (CDP `Fetch` domain). |
| `page.selectOption()` | Works | `<select>` value, `selectedIndex` and `options` behave like a browser. |
| `page.on('console')` | Works | Console messages from page scripts are delivered as console events. |
| `page.on('request' / 'response')` | Partial | Events fire for the main document only, not for subresources. |
| `context.newCDPSession(page)` | Works | Use it to call `Orbis.*` methods (see below). |
| `browser.close()` | Closes only your pages | Calls `Browser.close`, which closes the pages this client created (`Target.createTarget`). Other clients' pages stay open, and the daemon keeps serving. |
| Tracing, video, HAR recording | Not supported | Need rendering or the `Tracing` domain. |

General rules:

- **Orbis fits server-rendered pages.** Test suites against client-rendered single-page apps (React, Vue, Angular) will likely fail. The native engine's page runtime covers the common DOM APIs (including `XMLHttpRequest` (async only), `history`, event constructors, `element.style`, `getComputedStyle` and `requestAnimationFrame`), but has no `WebSocket`, `Worker`, `crypto`, `indexedDB`, `customElements` or `document.cookie`, and the observers (`MutationObserver`, `IntersectionObserver`, `ResizeObserver`) are stubs. When a CDP client attaches, Orbis installs a compatibility layer that adds some DOM properties and classes Playwright needs. That layer is not a full browser runtime. See [limitations.md](./limitations.md) for the complete table.
- Anything visual (screenshots, PDFs, layout, pixel coordinates, CSS computed styles) is out of scope. Run those tests on real Chrome.
- DOM-level automation (navigate, find, fill, click, read text, evaluate) is the supported surface.
- See [limitations.md](./limitations.md) for engine-wide limits such as JavaScript support.

## Using Orbis features from a CDP client

Orbis adds a custom CDP domain, `Orbis` (aliases `Memora` and `LP`), with the agent features. From Playwright, the simplest way is a CDP session:

```typescript
const cdp = await context.newCDPSession(page);
const snap = await cdp.send('Orbis.getSemanticSnapshot' as any, { excludeSelectors: ['nav', 'footer'] });
console.log((snap as any).actionMapText);
```

From any other client, call it over a raw WebSocket on the page target:

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
| `Orbis.fillForm` | `fields`, `submit?` (defaults to `false`), `submitActionId?`, `steps?` | `FormFillResult` plus `snapshot` |
| `Orbis.saveSession` | `filePath?` | With `filePath`: writes the file on the daemon host (a `.json` path inside the session folder). Without it: `{ success, session }` |
| `Orbis.loadSession` | `filePath` or `session` | `{ success, url }` |
| `Orbis.act` | `actionId`, `type` (`"click"` / `"type"`), `text?` | `{ success }`. A click follows links and submits forms, like a real click. |

The same features are also available over plain HTTP. See [http-api.md](./http-api.md).

A raw WebSocket opened alongside Playwright on the same page is fine.

## Implemented CDP methods

From `src/cdp/dispatcher.ts`. Any method in an unlisted domain returns `{}` without error. Any unlisted method in a listed domain also returns `{}` unless noted.

| Domain | Methods with behaviour |
| :--- | :--- |
| `Target` | `getTargets`, `createTarget`, `closeTarget`, `attachToTarget`, `detachFromTarget`, `setAutoAttach`, `setDiscoverTargets`, `getTargetInfo`, `createBrowserContext`, `getBrowserContexts`, `disposeBrowserContext` |
| `Page` | `enable`, `getFrameTree`, `getResourceTree`, `addScriptToEvaluateOnNewDocument`, `removeScriptToEvaluateOnNewDocument`, `setLifecycleEventsEnabled`, `createIsolatedWorld`, `navigate`, `reload`, `stopLoading`, `getNavigationHistory`, `navigateToHistoryEntry`, `getLayoutMetrics` (fixed viewport), `captureScreenshot` (1×1 PNG) |
| `Runtime` | `enable`, `evaluate` (`returnByValue`, `awaitPromise`), `callFunctionOn`, `getProperties`, `releaseObject`, `releaseObjectGroup`, `runIfWaitingForDebugger` |
| `DOM` | `enable`, `disable`, `getDocument`, `querySelector`, `querySelectorAll`, `getOuterHTML`, `describeNode`, `resolveNode`, `requestNode`, `scrollIntoViewIfNeeded`, `getContentQuads`, `getBoxModel` (synthetic layout), `focus`, `setFileInputFiles` (throws) |
| `Network` | `enable`, `setExtraHTTPHeaders`, `getCookies`, `getAllCookies`, `setCookie`, `setCookies`, `deleteCookies`, `clearBrowserCookies`, `getResponseBody` (main document only) |
| `Storage` | `getCookies`, `setCookies`, `clearCookies` (per browser context) |
| `Fetch` | `enable`, `disable`, `continueRequest`, `fulfillRequest`, `failRequest` (navigations, scripts and page `fetch()`) |
| `Input` | `dispatchMouseEvent`, `dispatchKeyEvent`, `insertText` |
| `Browser` | `getVersion`, `close` (closes the pages this client created) |
| `Emulation` | all methods are no-ops |
| `Orbis` / `Memora` / `LP` | see [above](#using-orbis-features-from-a-cdp-client) |

Events emitted: `Target.targetCreated`, `Target.targetDestroyed`, `Target.attachedToTarget`, `Target.detachedFromTarget`, `Page.frameNavigated`, `Page.frameStartedLoading`, `Page.frameStoppedLoading`, `Page.frameRequestedNavigation`, `Page.domContentEventFired`, `Page.loadEventFired`, `Page.lifecycleEvent`, `Runtime.executionContextCreated`, `Runtime.executionContextsCleared`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`.

`Browser.getVersion` reports `product: "MemoraEngine/<version>"` (for example `MemoraEngine/0.2.0`), while `/json/version` reports `Browser: "Chrome/130.0.0.0"` for client compatibility.

## Discovery endpoints

| Endpoint | Description |
| :--- | :--- |
| `GET /json/version` | Browser info and `webSocketDebuggerUrl` (`ws://<host>:<port>/devtools/browser/memora-root`). |
| `GET /json` or `/json/list` | All pages, each with `id`, `url`, `title` and `webSocketDebuggerUrl` (`/devtools/page/<id>`). |
| `GET /json/new` | Creates a page and returns its target. `/json/new?<url>` (or `?url=<encoded url>`) opens that URL in the new page. |
| `GET /json/close/<id>` | Closes a page. |

The `webSocketDebuggerUrl` uses the `--host` value. If clients connect from another machine, start the daemon with `--host <reachable-name-or-ip>` so the advertised URLs are reachable. With `--host` set to a specific address, the server binds only to that address.

The same port also serves the agent REST API (`/orbis/*`). See [http-api.md](./http-api.md).

---

## Concurrency and isolation

- **Cookies are shared within a context.** Pages in the same browser context share one cookie jar, like tabs in a browser: a login in one page is visible in another page of that context.
- **Cookies are scoped by site.** Within a page's jar, a cookie is only sent to the site it belongs to (domain, path, `Secure` and expiry are honoured).
- **Contexts isolate cookies.** `browser.newContext()` creates a separate cookie jar; pages in different contexts don't see each other's cookies. Storage is kept per page (tab) and origin.
- **`browser.close()` affects only your pages.** It closes the pages your client created; pages other clients are using stay open.
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
    const proc: ChildProcess = spawn('npx', ['-y', '@memoracompany/memora-orbis', '--port', String(port)], {
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

> **Known issue (0.1.0):** `page.pdf()` fails with a Playwright type error instead of a clear "unsupported" message.

See also: [selenium-webdriver.md](./selenium-webdriver.md), [http-api.md](./http-api.md), [limitations.md](./limitations.md), [troubleshooting.md](./troubleshooting.md).
