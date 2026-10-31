# CAPTCHAs, Bot Checks and Rate Limits

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

Orbis **detects** CAPTCHAs, bot-management interstitials, WAF block pages and rate limits, tells your code or agent about them, and backs off. It can also hand a check to a **person** in a visible Chrome window (MCP only). It does **not** solve challenges, inject solver tokens, transcribe audio challenges, or retry through other proxies or identities, and none of that is planned. See [Responsible use](./stealth.md#responsible-use).

## Contents

- [1. What is detected](#1-what-is-detected)
- [2. What happens on a challenge](#2-what-happens-on-a-challenge)
- [3. Per-host cooldown](#3-per-host-cooldown)
- [4. Stop mode](#4-stop-mode)
- [5. Human handoff (MCP)](#5-human-handoff-mcp)
- [6. TypeScript SDK](#6-typescript-sdk)
- [7. Errors by interface](#7-errors-by-interface)
- [8. Accuracy and limits](#8-accuracy-and-limits)

---

## 1. What is detected

Every navigation response (status, headers, HTML) is checked. The result is a `ChallengeSignal`:

```ts
interface ChallengeSignal {
  kind: 'interstitial' | 'captcha' | 'passive' | 'blocked' | 'rate_limited';
  vendor: 'cloudflare' | 'turnstile' | 'recaptcha' | 'hcaptcha' | 'aws-waf' | 'datadome'
        | 'perimeterx' | 'akamai' | 'imperva' | 'arkose' | 'geetest' | 'unknown';
  blocking: boolean;            // true: the loaded document is not the real page
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];           // e.g. ['header cf-mitigated=challenge', 'title "Just a moment..."']
  url: string;
  status: number;
  retryAfterSec?: number;       // from Retry-After
}
```

| Kind | Blocking | Meaning | Examples |
| :--- | :--- | :--- | :--- |
| `interstitial` | yes | The whole page is a challenge | Cloudflare "Just a moment...", AWS WAF CAPTCHA/challenge, DataDome, HUMAN (PerimeterX) |
| `blocked` | yes | A denial page with no challenge offered | Cloudflare 1020, Imperva incident page, Akamai "Access Denied" |
| `rate_limited` | yes | HTTP 429 | Any site |
| `captcha` | no | A widget inside a real page. The page is readable, but submitting the protected form needs a person | reCAPTCHA v2, hCaptcha, Turnstile, Arkose, GeeTest |
| `passive` | no | A score-only script; informational | reCAPTCHA v3 |

Signals that are deliberately **not** treated as challenges, because they also appear on normal pages:

- the Cloudflare beacon script `/cdn-cgi/challenge-platform/scripts/jsd/main.js`,
- reCAPTCHA v3 loaded on every page (reported as `passive` only),
- a plain 403 or 503 without vendor markers (your app's own auth or maintenance page),
- pages that only *mention* Cloudflare or "Just a moment" in their text.

## 2. What happens on a challenge

Default behaviour (`onChallenge: 'report'`):

| | Blocking challenge | Embedded `captcha` | `passive` |
| :--- | :--- | :--- | :--- |
| Navigation | Resolves normally with the challenge page's status | Normal | Normal |
| Native engine page scripts | **Not run** (they need APIs the sandbox lacks and would only burn the navigation timeout) | Run | Run |
| Host cooldown | Yes (see below) | No | No |
| MCP `memora_browse` / `act` / `fill_form` / `reload` | Returns a `CHALLENGE DETECTED` block **instead of** page content | Page output with a `CHALLENGE ON PAGE` header | Page output with a one-line note |
| `orbis fetch` / `--eval` | Challenge block on stderr, page output on stdout, exit 0 | Normal | Normal |

MCP output for a blocking challenge:

```
# CHALLENGE DETECTED â€” page content not available
Vendor: cloudflare | Kind: interstitial | Confidence: high
Evidence: header cf-mitigated=challenge; title "Just a moment..."
URL: https://example.com/ [HTTP 403]
Next steps: stop, or try again later. Requests to this host are paused for 60s. Orbis does not solve or bypass challenges.
A person can complete it in a visible browser window: call memora_handoff with action "start".
```

## 3. Per-host cooldown

After a blocking challenge, requests to that **hostname** fail fast without being sent:

- duration: the site's `Retry-After` (seconds or HTTP-date) if present, otherwise `--challenge-cooldown` / `network.challengeCooldownSec` (default **60**), capped at 3600 seconds,
- scope: every request the engine makes to that host: navigations, redirect hops, `<script src>` and page `fetch()`. Other hosts are unaffected,
- the paused request throws `ChallengeCooldownError` (`code: 'ERR_CHALLENGE_COOLDOWN'`, `host`, `remainingSec`, `signal`),
- `0` disables the cooldown,
- the cooldown is held in memory per browser (native) or per Chrome engine instance, and is lost on restart.

## 4. Stop mode

`--on-challenge stop` (CLI) or `network: { onChallenge: 'stop' }` (SDK) makes navigation **throw** on a blocking challenge instead of resolving:

- error: `ChallengeDetectedError` with `code: 'ERR_CHALLENGE_DETECTED'`, `signal` and `cooldownSec`; the message is the same `CHALLENGE DETECTED` text block,
- the challenge page is still loaded and `page.challenge()` still returns the signal,
- embedded widgets and passive scripts never throw.

Use it in scripts, crawlers and CI so that challenge pages are never processed as content.

## 5. Human handoff (MCP)

The `memora_handoff` tool lets a person complete a check, then the agent continues in the same browser.

| Action | What it does |
| :--- | :--- |
| `start` | Opens a **visible** Chrome/Edge window at `url`, or by default at the page where the last challenge was detected. Returns immediately. |
| `status` | Non-blocking. Inspects the window once and returns `waiting`, `resolved`, `expired`, `cancelled`, `unavailable` or `idle`. |
| `cancel` | Closes the window. |

Flow:

1. `memora_browse` reports a challenge.
2. The agent calls `memora_handoff` `start` and asks the user to complete the check in the window.
3. The agent polls `status`. The agent's tools cannot reach the window while it is `waiting`.
4. On `resolved`, the **active engine switches to that Chrome window** and the previous engine is closed. The host cooldown is cleared, and later tool calls run in the visible window.

When is it "resolved"?

- Blocking challenge: once the page on screen is no longer a blocking challenge.
- Embedded widget (for example a login form with reCAPTCHA): only after the person submitted and the page navigated, and the new page is not the same widget page again.

Details and limits:

- **Timeout:** `--handoff-timeout <sec>` (default 300, minimum 10). On expiry the window closes and the state becomes `expired`. Closing the window by hand gives `cancelled`.
- **Needs a display and Chrome/Edge.** On Linux without `DISPLAY`/`WAYLAND_DISPLAY` (servers, containers), or without Chrome/Edge at the [known paths](./mcp.md#engine-selection), `start` returns `unavailable` with the reason.
- **The session stays in Chrome.** Cookies are not copied between the window and the native engine. Clearance cookies are tied to the browser that earned them, and the native cookie jar is not domain-scoped (see [limitations.md](./limitations.md)). After a handoff from the native engine, earlier native-engine cookies are no longer used.
- **User-Agent:** the handoff window uses the installed browser's own User-Agent, not the Chrome 130 UA the headless engines send, because a mismatched UA makes checks fail for the person.
- **One handoff at a time** per MCP server.
- **The person does the check.** Orbis does not click, type or solve anything in the handoff window.

## 6. TypeScript SDK

```ts
import { OrbisBrowser, ChallengeDetectedError, ChallengeCooldownError } from '@memoracompany/memora-orbis';

const browser = new OrbisBrowser({ network: { onChallenge: 'stop', challengeCooldownSec: 120 } });
const page = browser.newPage();

try {
  await page.goto('https://example.com/');
  const ch = page.challenge();              // ChallengeSignal | null
  if (ch?.kind === 'captcha') console.warn('Form on this page needs a person:', ch.vendor);
} catch (err) {
  if (err instanceof ChallengeDetectedError) console.warn(err.signal.vendor, err.signal.kind, err.cooldownSec);
  else if (err instanceof ChallengeCooldownError) console.warn(`paused ${err.remainingSec}s for ${err.host}`);
  else throw err;
}
```

| API | Description |
| :--- | :--- |
| `page.challenge()` / `page.lastChallenge` | Signal of the last navigation, or `null` |
| `page.lastChallengeCooldownSec` | Seconds the host was paused for (0 if none) |
| `agent.challenge()` | Same, on `OrbisAgent` |
| `network.onChallenge` | `'report'` (default) or `'stop'` |
| `network.challengeCooldownSec` | Default cooldown in seconds; `0` disables |
| `detectChallenge({ url, status, headers, html })` | The detector as a pure function |
| `formatChallenge(signal, cooldownSec?)` | The text block used by MCP and the CLI |
| `HumanHandoff` | The handoff state machine (`start`, `status`, `cancel`, `take`, `close`) used by the MCP server, for embedding in your own tools |

`OrbisAgent` has no handoff method: it drives the native page, which cannot take over a Chrome window.

## 7. Errors by interface

| Interface | Stop mode (blocking challenge) | Host in cooldown |
| :--- | :--- | :--- |
| SDK | throws `ChallengeDetectedError` | throws `ChallengeCooldownError` |
| CDP `Page.navigate` | `errorText: "net::ERR_BLOCKED_BY_RESPONSE"` | `errorText: "net::ERR_BLOCKED_BY_CLIENT"` |
| WebDriver | `unknown error`: `Navigation failed: â€¦` | `unknown error`: `Navigation failed: â€¦` |
| MCP | `isError: true`, challenge block plus handoff hint | `isError: true`, cooldown message plus handoff hint |
| REST (`/orbis/goto`, `/orbis/fill-form`) | `409`, `code: "ERR_CHALLENGE_DETECTED"` | `429` with `Retry-After`, `code: "ERR_CHALLENGE_COOLDOWN"` |
| Python SDK | raises `ChallengeDetectedError` (subclass of `HTTPError`) | raises `ChallengeCooldownError` (subclass of `HTTPError`) |

In report mode, REST responses carry a `challenge` field and Python snapshots have `snap.challenge` / `snap.blocked`; see [http-api.md](./http-api.md) and [python-sdk.md](./python-sdk.md).
| `orbis fetch` | `Fetch error: â€¦` on stderr, exit 1 | `Fetch error: â€¦` on stderr, exit 1 |

## 8. Accuracy and limits

- **Not measured on real sites.** The detector is tested against synthetic fixtures modelled on each vendor's markers (`memora-browser/tests/test-challenge.ts`), including negative cases. There is no recorded precision/recall on live pages. Vendors change their markup, so expect misses and the occasional false positive. `evidence` shows why a page was flagged.
- Detection looks at the first 256 KB of HTML.
- In the Chrome engine, detection runs once the DOM is loaded. A non-interactive check that would pass by itself a few seconds later is still reported at that moment.
- WebDriver has no dedicated error code for challenges (see the table above).
- Detection does not make challenges pass. Sites with active bot management may still block Orbis; see [stealth.md](./stealth.md#what-stealth-does-not-do).

## Related documents

- [stealth.md](./stealth.md): what the stealth profile does and does not do
- [mcp.md](./mcp.md): MCP tools, including `memora_handoff`
- [cli-reference.md](./cli-reference.md): `--on-challenge`, `--challenge-cooldown`, `--handoff-timeout`
- [best-practices.md](./best-practices.md): retries and responsible automation
