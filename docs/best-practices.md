# Best Practices

This guide is for engineers putting Orbis into production: in LLM agent loops, deterministic automation and scheduled jobs. It covers how to structure an agent loop, keep token cost and secret exposure under control, choose locators that survive redesigns, handle errors and waiting, manage resources and concurrency, test offline, log usefully, and automate responsibly. Every behaviour described was checked against the 0.1.0 source or observed at runtime. The helper code was type-checked and run.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. Designing the agent loop](#1-designing-the-agent-loop)
- [2. Token budgeting](#2-token-budgeting)
- [3. Keeping secrets out of the model's context](#3-keeping-secrets-out-of-the-models-context)
- [4. Locators for deterministic automation](#4-locators-for-deterministic-automation)
- [5. Error handling and retries](#5-error-handling-and-retries)
- [6. Waiting for the page](#6-waiting-for-the-page)
- [7. Resource lifecycle](#7-resource-lifecycle)
- [8. Concurrency](#8-concurrency)
- [9. Testing your agent offline with setContent()](#9-testing-your-agent-offline-with-setcontent)
- [10. Logging and observability](#10-logging-and-observability)
- [Responsible automation](#responsible-automation)
- [Do and don't](#do-and-dont)
- [Related documents](#related-documents)

The examples import this helper file:

```ts
// orbis-helpers.ts Ã¢â‚¬â€ small helpers used throughout this guide
import { OrbisBrowser, type OrbisPage, type SemanticPageSnapshot } from '@memoracompany/memora-orbis';

/** Compact action map for prompts: no CSS selectors, no disabled controls. */
export function compactActionMap(snap: SemanticPageSnapshot, max = 150): string {
  const lines = snap.actions
    .filter(a => !a.disabled)
    .slice(0, max)
    .map(a => `[${a.actionId}] ${a.role}${a.isInput && a.type ? `(${a.type})` : ''} "${a.text}"${a.href ? ` -> ${a.href}` : ''}`);
  const more = snap.actions.length > max ? `\nÃ¢â‚¬Â¦ ${snap.actions.length - max} more (narrow with focusSelector)` : '';
  return lines.join('\n') + more;
}

/** goto() with retries for transient failures; never retries robots.txt blocks, challenges or 4xx. */
export async function gotoWithRetry(page: OrbisPage, url: string, attempts = 3): Promise<{ status: number; url: string }> {
  for (let i = 1; ; i++) {
    try {
      const res = await page.goto(url, { timeoutMs: 20_000 });
      if (res.status >= 500 && i < attempts) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err: any) {
      // ERR_CHALLENGE_* exist in unreleased builds (CAPTCHA / bot check / 429, see challenges.md)
      const final = ['ERR_BLOCKED_BY_ROBOTS', 'ERR_CHALLENGE_DETECTED', 'ERR_CHALLENGE_COOLDOWN'];
      if (final.includes(err.code) || i >= attempts) throw err;
      const delay = 500 * 2 ** (i - 1) + Math.random() * 250; // 0.5 s, 1 s, 2 s Ã¢â‚¬Â¦ plus jitter
      console.warn(`goto ${url} failed (${err.message}); retry ${i}/${attempts - 1} in ${Math.round(delay)} ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/** Page-script errors are the usual reason expected content is missing. */
export function scriptErrors(page: OrbisPage): string[] {
  return page.getLogs().filter(l => l.type === 'error').map(l => l.text);
}
```

## 1. Designing the agent loop

A robust loop has four steps per turn:

1. **Observe.** Take a snapshot (`agent.snapshot()` or the result of `goto()`) and give the model a compact action list plus content.
2. **Decide.** The model picks one action by its `@ID`.
3. **Act.** Run it: `agent.page.activate(id)` for clicks, `agent.act(id, text)` for typing, and `selectOption` / `fillForm` for forms.
4. **Verify.** Check the outcome (`diff().summary`, the URL, the title, or a specific element), then go back to step 1.

Rules that prevent most agent failures:

- **Re-snapshot after every action that can change the page.** Action IDs are reassigned on every snapshot. They are positions in document order of the elements that are currently visible and interactive. When a banner appears or a field is revealed, every ID after it shifts.
- **Never reuse `@IDs` across turns.** Tell the model in the system prompt that IDs are only valid for the latest list. The [use-case 1](use-cases.md#1-llm-research-agent-with-claude-tool-use) prompt shows wording that works.
- **Never act on `@IDs` from a filtered snapshot.** `snapshot({ focusSelector: 'main' })` numbers elements starting from 1 *inside* `main`, and `excludeSelectors` removes elements from the numbering. `act('@3')` and `activate('@3')`, however, resolve `@3` against a fresh **whole-page** snapshot, so a filtered `@3` can be a different element. Show the model IDs from an unfiltered snapshot and apply filters to the Markdown only, or act on the `selector` field of a filtered action:

  ```ts
  const focused = agent.snapshot({ focusSelector: 'main' });
  const target = focused.actions.find(a => a.text === 'Save');
  if (target) await agent.page.activate(target.selector);  // not target.actionId
  ```

- **Use `activate()` for navigation clicks.** `agent.act('@4')` (and `page.click()`) only dispatches a `click` event, so links aren't followed and forms aren't submitted. `await agent.page.activate('@4')` performs the browser's default action and returns `true` when it navigated. In Python and over REST, `act()` has the same limitation (see [python-sdk.md](python-sdk.md)).
- **Verify instead of assuming.** `activate()` returns `false` when nothing navigated. That's correct for a JS-only button, so check the result:

  ```ts
  const navigated = await agent.page.activate('@7');
  const delta = agent.diff();               // compares against the snapshot taken while resolving @7
  if (!navigated && delta.addedActions.length === 0 && delta.mutatedActions.length === 0) {
    // Nothing visible happened: tell the model, and check page script errors
    console.warn(scriptErrors(agent.page));
  }
  ```

- **Bound the loop.** Cap the turns (15Ã¢â‚¬â€œ25 is typical), cap the characters per tool result, and stop on repeated identical actions.
- **Treat page text as untrusted input.** Pages can contain prompt-injection text. Keep tools that have effects outside the browser (sending email, payments, file writes) behind human confirmation.

## 2. Token budgeting

`snapshot.tokenEstimate` is `ceil(characters / 4)` over the title, the full `actionMapText` and the Markdown. It's an estimate, not a tokenizer count.

The full `actionMapText` includes a CSS selector on every line, and on link-dense pages those selectors dominate. Measured on 31 Oct 2026 on real pages:

| Page | Raw HTML | Orbis full snapshot |
| :--- | :--- | :--- |
| Hacker News front page | ~35 KB (~8.7k tokens) | ~17,800 tokens (228 actions) |
| Wikipedia "Web browser" | ~416 KB | ~120,000 tokens (1,230 actions) |

The only published reduction figures (33Ã¢â‚¬â€œ40 % fewer tokens than raw HTML, 37 % on average) come from the four small benchmark fixtures in `tests/benchmark.ts`, measured on one Windows 11 laptop on 30 Oct 2026. Don't assume a fixed saving for real sites. Measure your own pages.

To keep prompts small:

1. **Send a compact action list, not `actionMapText`.** `compactActionMap()` (above) drops selectors and disabled controls and caps the list length. The model only needs the ID, role, label and link target.
2. **Scope the content.** `agent.markdown({ focusSelector: 'main', excludeSelectors: ['nav', 'footer', 'aside', '.cookie-banner'] })` trims the page text. The same options on `snapshot()` also trim the action list, but then its `@IDs` can't be used with `act()`/`activate()` (section 1). To shrink the action list itself, filter `snapshot.actions` in code, for example by dropping actions whose `selector` starts inside `nav`, or cap the list as `compactActionMap()` does.
3. **Truncate Markdown** to a per-turn budget (for example 8Ã¢â‚¬â€œ12k characters) and tell the model it was truncated.
4. **Send `diff().summary` after small actions** (typing, toggling, revealing a field) instead of a new snapshot. It lists only added, removed and changed controls. Send a full view only after navigation.
5. **Prefer `extract()` for known data.** If your code knows the selector (`page.extract('.price', 'text')`), don't make the model read the page.

## 3. Keeping secrets out of the model's context

A value written by `act(id, text)`, `type()` or `fillForm()` is stored as the element's `value` attribute. From then on it appears in:

- the action map: `[@2] [input] "correct-horse" type="password" value="correct-horse"`. When the field has no `aria-label`, `placeholder` or `title`, the typed value also becomes the element's text. And
- the diff summary: `* [@2] [input] "correct-horse" (text: "[Untitled input]" -> "correct-horse", value: undefined -> "correct-horse")`.

So typing a password and then showing the model the page sends the password to the LLM provider. Choose one of these:

- **Fill credentials in code** with `fillForm({ 'label:Email': user, 'label:Password': pass }, 'text=Sign in')`, outside the model's tool loop.
- **Reuse a saved session** (`saveSession` / `loadSession`) so the agent never sees the login form (see [sessions-and-auth.md](sessions-and-auth.md)).
- **Scrub values.** Keep a set of the secret strings you typed and replace them in every tool result, as the [use-case 1](use-cases.md#1-llm-research-agent-with-claude-tool-use) tool layer does. Redacting only `value="Ã¢â‚¬Â¦"` isn't enough, because the value also appears as the element's text.

Also keep session files, `memora_session` paths and debug logs that contain action maps out of version control and out of shared log stores.

## 4. Locators for deterministic automation

`@IDs` are for LLMs reading a fresh snapshot. Scripted automation should use locators that survive layout changes. In order of preference:

| Prefer | Syntax | Why |
| :--- | :--- | :--- |
| 1 | `testid:checkout` | Checks `data-testid`, `data-test-id`, `data-qa`, `data-cy`. Stable by contract |
| 2 | `label:Email` | Follows `<label for>` or a nested control. Matches a substring of the label text, case-insensitive |
| 3 | `#id`, `input[name="email"]` | Plain CSS. Stable when the app uses semantic IDs and names |
| 4 | `text=Sign in`, `role:button[name="Save"]` | Readable, but copy changes break them |
| 5 | `xpath=//table//tr[2]/td[3]` | For structures with no better hook |
| Avoid in scripts | `@3`, `@email` | Positional, or fuzzy (see below) |

Pitfalls observed in 0.1.0 (full rules in [locators.md](locators.md)):

- `@alias` (for example `@email`) returns the **first** action whose name, placeholder, selector or text *contains* the word. A nav link "Email us" can win over `input[name=email]`.
- The `label:` fallback to `aria-label` is case-sensitive against the lower-cased query, so `label:Search` doesn't match `aria-label="Search"`. Use `[aria-label="Search"]` as CSS.
- `role:link` matches only elements with an explicit `role="link"` or a `<link>` tag, not `<a>`. Use `text=Pricing` or CSS such as `a[href="/pricing"]` instead.
- `text=` can match hidden elements and prefers substring matches on interactive elements over an exact match elsewhere. Make the text specific.
- Parenthesised XPath such as `(//a)[2]` needs the `xpath=` prefix. Only expressions starting with `//` are detected automatically.
- The resolver tries strategies in a fixed order and falls back to plain CSS, so a typo can silently match something else. Assert on what you got (`page.resolveElement(sel)?.tagName`) in critical flows.

## 5. Error handling and retries

What fails, and how:

| Situation | Behaviour |
| :--- | :--- |
| DNS failure, refused connection, TLS error, bad port | `goto()` throws `Request to <url> failed: <reason>` |
| Navigation slower than `timeoutMs` (default 20 s) | `goto()` throws `Navigation timeout after <ms>ms: <url>`. TCP connects separately give up after 10 s |
| URL disallowed by robots.txt (with `obeyRobots`) | Throws `RobotsBlockedError`, `err.code === 'ERR_BLOCKED_BY_ROBOTS'` |
| CAPTCHA / bot challenge / block page / 429 (unreleased) | Does not throw by default; `page.challenge()` returns the signal. With `onChallenge: 'stop'` throws `ChallengeDetectedError` (`ERR_CHALLENGE_DETECTED`). Requests to that host then throw `ChallengeCooldownError` (`ERR_CHALLENGE_COOLDOWN`) for 60 s or `Retry-After`. See [challenges.md](challenges.md) |
| `about:blank` or another non-HTTP scheme | `goto()` throws (`data:` URLs work) |
| HTTP 4xx / 5xx | **Does not throw.** Check the `status` returned by `goto()` (also `page.lastStatus`) |
| Locator matches nothing | `act()`, `page.click()`, `page.type()`, `selectOption()` return `false`. `page.activate()` throws `Element "<target>" not found` |
| Form field not found | `fillForm()` succeeds and lists it in `result.skipped` |
| Page script throws or runs longer than 5 s | Doesn't propagate. The error is in `page.getLogs()` |

Guidelines:

- **Retry only transient failures** (network errors, timeouts, 5xx) with exponential backoff and jitter. Never retry robots blocks, 4xx responses, or failures caused by your own selectors. `gotoWithRetry()` above implements this.
- **Treat `false` and `skipped` as errors in scripts.** Throw with context (`fields not found: Ã¢â‚¬Â¦`) so a redesign fails loudly.
- **Read script errors when content is missing.** `scriptErrors(page)` usually explains a missing dropdown or empty list, for example a page using `element.style`, `XMLHttpRequest` or `getComputedStyle`, which the engine doesn't provide (see [limitations.md](limitations.md)).
- **Return errors to the model as tool errors** (`is_error: true`) with the message, so it can choose another path instead of the loop crashing.

## 6. Waiting for the page

Orbis has no rendering loop to wait for. What matters is the page's JavaScript.

- **`goto()` already waits.** After loading the HTML and running scripts, it waits up to `settleTimeoutMs` (default 5,000 ms, never past the navigation timeout) until in-flight `fetch()` calls, their promise chains and short one-shot timers (Ã¢â€°Â¤ 1 s, nesting Ã¢â€°Â¤ 10) have finished. `setInterval` and long timeouts are ignored. Tune it per call (`goto(url, { settleTimeoutMs: 0 })` for metadata-only work) or per page (`page.settleTimeoutMs = 2000`).
- **After an interaction that starts async work**, wait for the result you need:

  ```ts
  page.click('#load-more');
  await page.waitForSelector('.result:nth-of-type(21)', { timeoutMs: 5000 });  // throws on timeout
  ```

  "Visible" means the element itself has no `hidden` attribute, no `aria-hidden="true"` and no inline `display:none`. Hidden ancestors aren't checked. Use `{ state: 'attached' }` to only require existence.
- **`page.waitForIdle(ms)`** resolves `true` when pending fetches and short timers have finished, and `false` on timeout.
- **`page.waitForFunction()`: pass a function**, for example `await page.waitForFunction(() => page.extract('.row').length > 20)`.

> **Known issue (0.1.0):** `page.waitForFunction('<expression string>')` resolves `true` immediately whatever the expression evaluates to, because it checks the evaluation wrapper instead of the value. Pass a function instead.

- **Avoid fixed sleeps** except for politeness delays between requests.

## 7. Resource lifecycle

- **Always close in `finally`.** Use `await agent.close()`, `browser.close()` or `browser.closePage(page.id)`. Closing disposes the page's JS context, its timers and its in-flight requests. Leaked pages keep timers alive and hold memory.
- **Prefer `new OrbisBrowser()` + `new OrbisAgent(browser, page)` in scripts.** `OrbisAgent.launch()` also starts a CDP server on port 9222, which fails with `EADDRINUSE` if two scripts run at once and exposes an unauthenticated port (see [security.md](security.md)). Use `launch()` only when an external CDP client needs to attach.
- **Dispose of forks with `fork.page.close()`.**

> **Known issue (0.1.0):** `agent.fork().close()` closes the shared browser and its connection pool, so the original agent then fails with `The client is closed`. Close only the fork's page.

- **Handle signals in long-running services.** Close browsers on `SIGTERM` so container restarts don't cut off in-flight work abruptly.
- **Recycle long-lived processes.** For services that run for days, restart workers periodically (for example after N tasks) to cap the effects of memory growth from pages you forgot to close.

## 8. Concurrency

The pattern that works:

- **One `OrbisBrowser` per process.** Its pages share a connection pool.
- **One page per task.** Each page has its own DOM, JS context and cookie jar.
- **Bounded parallelism** with a small limiter:

```ts
import { OrbisBrowser } from '@memoracompany/memora-orbis';

/** Run tasks with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const browser = new OrbisBrowser();           // one browser: shared connection pool
try {
  const urls = (process.env.URLS ?? '').split(',');
  const titles = await mapLimit(urls, 4, async url => {
    const page = browser.newPage();           // one page per task: own DOM, JS context, cookie jar
    try {
      await page.goto(url, { timeoutMs: 20_000 });
      return { url, status: page.lastStatus, title: page.title() };
    } catch (err: any) {
      return { url, error: err.message };
    } finally {
      browser.closePage(page.id);             // releases timers and in-flight requests
    }
  });
  console.table(titles);
  console.log('open pages left:', browser.listPages().length);
} finally {
  browser.close();
}
```

Things to know:

- **CPU work blocks the event loop.** HTML parsing, snapshotting and page scripts run synchronously on the Node.js main thread. A single process mostly gives you concurrency while waiting on the network. For CPU-bound throughput, run several worker processes (or containers) and spread URLs across them.
- **Context Isolation for Multi-Agent Fleets (0.1.2):** Use `browser.newContext()` or `agent.newContext()` when running parallel workers. Each context creates an isolated `CookieJar` with domain and path scoping, preventing session leaks between concurrent tasks.
- **Daemons are shared state.** Every CDP, REST or Python client of a daemon sees the same page list, and the Python SDK and REST endpoints act on the daemon's *default page*. Run one daemon per worker. Don't put a single daemon behind a load balancer for unrelated users.
- **Be a good neighbour.** Concurrency against a single host should stay low (2Ã¢â‚¬â€œ4 pages) unless the site owner agrees otherwise.

## 9. Testing your agent offline with setContent()

`page.setContent(html, url)` loads HTML without touching the network and runs its inline scripts. Use it to unit-test prompts, tool layers and selectors in CI, quickly and deterministically:

```ts
// agent.test.ts Ã¢â‚¬â€ offline tests for agent logic with setContent() fixtures
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrbisAgent, OrbisBrowser } from '@memoracompany/memora-orbis';

const LOGIN = `<!DOCTYPE html><html><head><title>Sign in</title></head><body>
  <form action="/session" method="post">
    <input name="email" type="email" placeholder="Work email">
    <input name="password" type="password" placeholder="Password">
    <button type="submit" disabled>Sign in</button>
  </form>
  <script>
    document.querySelector('input[name=password]').addEventListener('input', () =>
      document.querySelector('button').removeAttribute('disabled'));
  </script></body></html>`;

function fixture(html: string) {
  const browser = new OrbisBrowser();
  const page = browser.newPage();
  page.setContent(html, 'https://app.example.test/login'); // no network; inline scripts run
  return { agent: new OrbisAgent(browser, page), close: () => browser.close() };
}

test('login form exposes the fields an agent needs', () => {
  const { agent, close } = fixture(LOGIN);
  try {
    const snap = agent.snapshot();
    assert.equal(snap.title, 'Sign in');
    assert.deepEqual(snap.actions.map(a => a.text), ['Work email', 'Password', 'Sign in']);
    assert.equal(snap.actions[2].disabled, true);
  } finally { close(); }
});

test('typing a password enables the submit button', () => {
  const { agent, close } = fixture(LOGIN);
  try {
    agent.snapshot();                                  // baseline for diff()
    assert.equal(agent.act('placeholder:Password', 'x'), true);
    const diff = agent.diff();
    assert.ok(diff.mutatedActions.some(m => m.changes.disabled?.to === false));
    assert.equal(agent.page.getLogs().filter(l => l.type === 'error').length, 0);
  } finally { close(); }
});
```

Run it with `npx tsx --test agent.test.ts`. Both tests pass on 0.1.0.

Tips:

- Save real pages (`orbis fetch <url> --dump html > fixture.html`) as fixtures, and refresh them when the site changes.
- Assert on `snapshot.actions` fields (`text`, `role`, `disabled`, `href`), not on the full `actionMapText`, which embeds generated selectors.
- `setContent` runs **inline** scripts (classic and module) only. External `<script src>` isn't fetched.
- To test the network layer, start a local `http.createServer` fixture server, as the [use-case](use-cases.md) recipes were tested.

## 10. Logging and observability

Log one structured line per page operation:

```ts
const t0 = performance.now();
const { status } = await page.goto(url, { timeoutMs: 20_000 });
const snap = page.getSemanticSnapshot();
console.log(JSON.stringify({
  event: 'page_loaded', url: page.url, status, ms: Math.round(performance.now() - t0),
  actions: snap.interactiveCount, tokenEstimate: snap.tokenEstimate,
  scriptErrors: page.getLogs().filter(l => l.type === 'error').length,
}));
```

- Track error rate, p95 load time, `tokenEstimate` per turn, and turns per task. Rising script errors on a site usually mean it changed to client-side rendering.
- **Don't log action maps or diffs at info level.** They contain typed values, including passwords (section 3).
- Debug switches: `DEBUG_CDP=1` logs CDP traffic on the daemon, and `DEBUG_WEBDRIVER=1` logs WebDriver requests to stderr.
- Set `ORBIS_NO_TELEMETRY=1` in production and CI. It skips the start-up update check that the CLI sends to `orbis.memora.company`, which matters for air-gapped networks and for MCP (whose protocol uses stdout).
- Robots blocks are written to stderr (`[Memora] blocked by robots.txt: Ã¢â‚¬Â¦`). Route stderr to your log pipeline.

## Responsible automation

- **Terms of service.** Read them. Some sites forbid automated access or reuse of their content, and stealth doesn't change that (see [stealth.md](stealth.md#responsible-use)).
- **robots.txt.** Use `obeyRobots: true` with an honest `robotsAgent` for anything you don't own. Orbis ignores `Crawl-delay`, so add your own delay.
- **Rate limits.** Use 1 request per second per host or slower by default. Back off on 429/503 and honour `Retry-After`.
- **Identify yourself** for crawling and monitoring: a descriptive User-Agent with a contact URL and a `From` header.
- **Personal data.** Collect the minimum, record its source, honour deletion requests, and check GDPR/CCPA obligations before collecting anything about individuals (see [use-case 12](use-cases.md#12-company-contact-page-extraction)).
- **Authentication.** Only automate accounts you're authorised to use, with credentials from a secret manager. Never automate CAPTCHA solving or bypass access controls.

## Do and don't

| Do | Don't |
| :--- | :--- |
| Re-snapshot after every action that can change the page | Reuse `@IDs` from an earlier turn |
| Take IDs from an unfiltered snapshot; filter only the Markdown | Act on `@IDs` from a focused or excluded snapshot |
| `await page.activate(id)` for links and submit buttons | Expect `act(id)` to navigate |
| Send a compact action list plus truncated Markdown | Send `actionMapText` from link-heavy pages |
| Send `diff().summary` after small actions | Send a full snapshot every turn |
| Fill credentials in code, or scrub typed secrets | Let the model see a page after typing a password |
| Use `testid:`, `label:` or CSS IDs in scripts | Use `@alias` in scripts |
| Check `goto()`'s `status`, `false` returns and `skipped` | Assume no exception means success |
| Retry network errors and 5xx with backoff | Retry robots blocks or 4xx |
| Check `page.getLogs()` when content is missing | Add sleeps hoping content appears |
| Close pages in `finally`; close forks with `fork.page.close()` | Call `fork.close()` |
| Use `new OrbisBrowser()` in scripts | Call `OrbisAgent.launch()` when nothing needs the CDP port |
| Run one daemon per worker, firewalled | Share one daemon between tenants |
| Use `obeyRobots`, honest identification and per-host delays | Rely on stealth to get around blocks |

## Related documents

- [use-cases.md](use-cases.md): complete recipes that apply these practices
- [typescript-sdk.md](typescript-sdk.md) and [python-sdk.md](python-sdk.md): API references
- [locators.md](locators.md): locator syntax and matching rules
- [limitations.md](limitations.md): missing browser APIs and engine limits
- [security.md](security.md): hardening and isolation
- [troubleshooting.md](troubleshooting.md): symptoms and fixes
