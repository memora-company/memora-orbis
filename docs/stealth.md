# Stealth Mode

Orbis ships with a "stealth" profile that makes its HTTP requests and its JavaScript environment look like desktop Chrome 130 on Windows. This page lists what that profile changes and what it doesn't, and it gives guidance on using it responsibly. Read it before you rely on stealth to reach any site. Stealth is a consistency layer, not an anti-bot bypass, and 0.1.0 makes no promise that any particular bot-detection product will let you through.

Applies to: Orbis 0.1.1 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Summary](#summary)
- [Request headers](#request-headers)
- [JavaScript environment](#javascript-environment)
- [What `--no-stealth` actually changes](#what---no-stealth-actually-changes)
- [Overriding the User-Agent](#overriding-the-user-agent)
- [The Chrome engine (MCP only)](#the-chrome-engine-mcp-only)
- [What stealth does not do](#what-stealth-does-not-do)
- [Detectable inconsistencies in 0.1.0](#detectable-inconsistencies-in-010)
- [Responsible use](#responsible-use)
- [Related documents](#related-documents)

## Summary

| Area | Stealth on (default) | `--no-stealth` / `stealth: false` |
| :--- | :--- | :--- |
| Navigation request headers (Chrome 130 profile) | Sent | **Still sent**. The header profile does not depend on the flag |
| `navigator.userAgent`, `webdriver`, `platform`, `languages`, `hardwareConcurrency`, `deviceMemory`, `screen` | Chrome-like values | **Same values**. They're part of the base sandbox |
| `navigator.plugins`, `navigator.mimeTypes` | 5 PDF-viewer plugins, 2 MIME types | `undefined` |
| `navigator.mediaDevices.enumerateDevices()` | One microphone and one camera (fake) | `undefined` |
| `navigator.getBattery()` | Charging, 100 % | `undefined` |
| `window.chrome` (`app`, `runtime`, `loadTimes()`, `csi()`) | Present | `undefined` |
| TLS / HTTP/2 fingerprint | Node.js (undici) defaults | Node.js (undici) defaults |

Stealth is **on by default** for every entry point: the CLI daemon, `orbis fetch`, `orbis --eval`, the WebDriver server, `OrbisBrowser`/`OrbisAgent`, and the native MCP engine. There is no `--stealth` flag. Passing it is an error, so use `--no-stealth` to turn stealth off (see [cli-reference.md](cli-reference.md)).

## Request headers

Every top-level navigation (`goto`, link clicks, form submissions, redirects) carries this header set. Source: `getStealthHeaders()` in `src/stealth/fingerprint.ts`. The values below were captured from a real request on 0.1.0:

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Language: en-US,en;q=0.9
Sec-Ch-Ua: "Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"
Sec-Ch-Ua-Mobile: ?0
Sec-Ch-Ua-Platform: "Windows"
Sec-Fetch-Dest: document
sec-fetch-mode: cors
Sec-Fetch-Site: none
Sec-Fetch-User: ?1
Upgrade-Insecure-Requests: 1
accept-encoding: gzip, deflate
```

The code sets `Sec-Fetch-Mode: navigate`, but the HTTP client (undici `fetch`) overwrites it with `cors` on the wire. `accept-encoding` is also added by the HTTP client.

Subresource requests (classic and module `<script src>`) and `fetch()` calls made by page scripts send only `User-Agent` and `Accept: */*`, plus `Referer` for scripts. Any extra headers you configure (`--http-header`, `network.headers`) are added to every request and override the profile values on conflict. Cookies collected by the page are attached as one `Cookie` header (see [sessions-and-auth.md](sessions-and-auth.md)).

## JavaScript environment

Orbis runs page scripts in a Node.js `vm` context with its own DOM. There is no rendering engine. The base context, which you get whether or not stealth is on, defines:

| Property | Value |
| :--- | :--- |
| `navigator.userAgent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36` |
| `navigator.webdriver` | `false` |
| `navigator.platform` | `Win32` |
| `navigator.language` / `languages` | `en-US` / `['en-US', 'en']` |
| `navigator.hardwareConcurrency` / `deviceMemory` | `8` / `8` |
| `navigator.cookieEnabled` / `onLine` | `true` / `true` |
| `screen` | 1920 Ã— 1080, `availHeight` 1040, 24-bit colour |

When stealth is on, a script from `generateStealthScript()` runs in each new page context before any page script. It:

- redefines `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform` and `languages` as getters, with the same values as above;
- adds `navigator.plugins` (five "PDF Viewer" entries with `item()`, `namedItem()` and `refresh()`) and `navigator.mimeTypes` (`application/pdf`, `text/pdf`);
- adds `navigator.mediaDevices.enumerateDevices()`, which returns one fake audio input and one fake video input;
- adds `navigator.getBattery()`, which resolves to a charging battery at level 1.0;
- adds `window.chrome` with `app`, `runtime`, `loadTimes()` and `csi()`;
- replaces `window.screen` with a 1920 Ã— 1080 object;
- patches `navigator.permissions.query` so it reports `notifications` as `default`. `navigator.permissions` doesn't exist in the native sandbox, so in practice this patch does nothing.

## What `--no-stealth` actually changes

`--no-stealth` (CLI) and `stealth: false` (SDK, `OrbisBrowser` options) only stop the stealth script above from being injected. Here is what we verified on 0.1.0 with stealth off:

- The request headers are unchanged. The Chrome 130 profile is still sent.
- `navigator.userAgent`, `webdriver: false`, `hardwareConcurrency`, `platform` and `screen` are unchanged.
- `navigator.plugins`, `navigator.mimeTypes`, `navigator.mediaDevices`, `navigator.getBattery` and `window.chrome` become `undefined`.

So "stealth off" does **not** produce an honest, self-identifying client. To identify your automation, set your own User-Agent as described next.

## Overriding the User-Agent

`--user-agent "<ua>"` (CLI) or `network: { userAgent }` / `userAgent` (SDK) replaces the `User-Agent` **request header** on navigations, subresources, `fetch()` calls and robots.txt fetches. It doesn't touch the rest of the profile:

| Signal | After `--user-agent "AcmeBot/1.0"` |
| :--- | :--- |
| `User-Agent` header | `AcmeBot/1.0` |
| `Sec-Ch-Ua*` headers | Still Chrome 130 |
| `navigator.userAgent` in page JS | Still the Chrome 130 string |

Sites that compare the header with `navigator.userAgent`, or the UA with the Client Hints, will see the mismatch. If you identify as a bot, that is fine and expected. Just don't expect a custom UA to look like a real browser. Changing the UA also doesn't change which robots.txt group applies. Use `--robots-agent` for that (see [network-and-proxies.md](network-and-proxies.md)).

## The Chrome engine (MCP only)

When the MCP server runs with `--engine chrome`, or `--engine auto` on a machine with Chrome or Edge installed, pages load in real headless Chrome through Playwright. That path does **not** inject the Orbis stealth script. It launches Chrome with `--disable-blink-features=AutomationControlled`, sets a Chrome 130 User-Agent unless you override it, and otherwise has headless Chrome's own fingerprint. See [mcp.md](mcp.md).

## What stealth does not do

- **TLS and HTTP fingerprints.** Requests use Node.js's TLS stack through undici, so JA3/JA4 and HTTP/2 settings are Node's, not Chrome's. Header order and casing also differ from Chrome. Earlier marketing text claimed JA3/JA4 spoofing; the 0.1.0 source does not do this.
- **Canvas, WebGL and audio fingerprinting.** There is no canvas: `HTMLCanvasElement` and `WebGLRenderingContext` are `undefined` in page JS. Scripts that probe these APIs get errors or `undefined`, which is itself a strong signal.
- **Layout, fonts and rendering.** Element sizes are synthetic, there is no font enumeration, and screenshots are a 1Ã—1 placeholder image (see [limitations.md](limitations.md)).
- **CAPTCHAs and challenges.** Orbis doesn't solve CAPTCHAs, Turnstile, hCaptcha or JavaScript proof-of-work challenges. Many challenge pages need APIs the sandbox lacks (`XMLHttpRequest`, `crypto`, `requestAnimationFrame`, workers), so they simply don't complete. Unreleased builds **detect** them, back off, and can hand them to a person in a visible window; see [challenges.md](challenges.md).
- **Guaranteed access.** There is no recorded measurement of Orbis passing Cloudflare, DataDome or similar bot-management checks; earlier "100% passed" claims are not backed by data. Assume that sites with active bot management may block Orbis, and design for that: handle 403/429/503 responses, back off, and stop.
- **Proxy rotation and IP reputation.** Stealth doesn't change your IP address. The managed proxy flags (`--http-proxy`, `--proxy-bearer-token`) are reserved for Orbis Cloud and currently only print a notice (see [network-and-proxies.md](network-and-proxies.md)).

## Detectable inconsistencies in 0.1.0

> **Known issue (0.1.0):** The navigation request declares `Sec-Fetch-Dest: document` but goes out with `sec-fetch-mode: cors` because the HTTP client overrides that header. A real Chrome navigation sends `navigate`.

> **Known issue (0.1.0):** `--user-agent` changes only the request header. `navigator.userAgent` and the `Sec-Ch-Ua` Client Hints keep the Chrome 130 values, so the two disagree.

> **Known issue (0.1.0):** Many standard browser globals are missing in page JS, including `XMLHttpRequest`, `WebSocket`, `requestAnimationFrame`, `getComputedStyle`, `crypto`, `performance`, `Event`, `alert` and `history`. A script that checks for them can tell it isn't running in a real browser, whatever stealth reports.

## Responsible use

Stealth exists so that ordinary, permitted automation (testing your own sites, reading public documentation, agents doing what a user asked) isn't served broken pages just for having an unusual client. It is not a licence to get around access controls.

- **Respect the site's terms and robots.txt.** Use `--obey-robots` with an honest `--robots-agent` token for any crawl of sites you don't own (see [use-cases.md](use-cases.md#10-compliance-friendly-crawling)).
- **Identify yourself for bulk work.** For crawling, monitoring or data collection, set a descriptive User-Agent with a contact URL (`AcmeResearchBot/1.0 (+https://acme.example/bot)`) and a `From:` header. If you do that, you're no longer using stealth for concealment, so say so honestly.
- **Don't evade blocks.** If a site answers with 403, 429, a CAPTCHA or a challenge page, treat it as a "no". Don't rotate identities or proxies to get past it, and don't use CAPTCHA-solving services. Where a person may legitimately pass the check, let them do it themselves ([human handoff](challenges.md#5-human-handoff-mcp)).
- **Never use stealth to reach content behind authentication you aren't authorised to use**, to scrape personal data in breach of GDPR/CCPA or similar laws, or to break technical protection measures. Depending on where you are, that can break computer-misuse and anti-circumvention laws even when the content looks public.
- **Rate-limit.** Orbis is fast enough to put real load on small sites. Add your own per-host delay. Orbis ignores `Crawl-delay`.

## Related documents

- [concepts.md](concepts.md): how the native engine loads pages and runs scripts
- [network-and-proxies.md](network-and-proxies.md): headers, proxies, TLS options, robots.txt
- [challenges.md](challenges.md): CAPTCHA and bot-check detection, cooldown and human handoff
- [limitations.md](limitations.md): APIs and features the engine lacks
- [security.md](security.md): running Orbis safely in production
- [best-practices.md](best-practices.md#responsible-automation): the responsible-automation checklist
