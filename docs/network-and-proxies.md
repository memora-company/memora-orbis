# Network, Proxies and robots.txt

This page explains how Orbis makes HTTP requests and how to control them: request headers, the user agent, timeouts, TLS, redirects, proxies (HTTP, HTTPS and SOCKS), `NO_PROXY` rules, robots.txt compliance (RFC 9309) and cookie handling. All options are available as CLI flags and as the `network` option of the TypeScript SDK.

Applies to: Orbis 0.1.0 (`@memoracompany/orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. How requests flow](#1-how-requests-flow)
- [2. NetworkOptions and CLI flags](#2-networkoptions-and-cli-flags)
- [3. Headers and user agent](#3-headers-and-user-agent)
- [4. Timeouts](#4-timeouts)
- [5. TLS](#5-tls)
- [6. Redirects](#6-redirects)
- [7. Proxies](#7-proxies)
- [8. NO_PROXY and proxy bypass rules](#8-no_proxy-and-proxy-bypass-rules)
- [9. robots.txt](#robotstxt)
- [10. Cookies](#10-cookies)
- [11. Chrome engine differences](#11-chrome-engine-differences)
- [12. Recipes](#12-recipes)

---

## 1. How requests flow

In the native engine (used by the SDKs, the CDP daemon, the WebDriver daemon, `fetch`, `--eval`, and MCP when Chrome is not used), every request goes through one `NetworkFetcher` per page and one connection pool per browser:

| Request type | Path | Same proxy, headers, cookies, robots checks? |
| :--- | :--- | :--- |
| Top-level navigation (`goto`, link click via `activate`, form submit) | `NetworkFetcher.request()` | Yes |
| `<script src>` and module imports | `NetworkFetcher.fetchResource()` | Yes, with resource-style headers (`Accept: */*`, `Referer`) |
| Page `fetch()` | `NetworkFetcher.pageFetch()` | Yes (proxy, cookies, extra headers, robots). Redirects are followed automatically. |
| `XMLHttpRequest` | Not available in the native engine (see [limitations.md](./limitations.md)) | — |
| Images, CSS, fonts, media | **Not requested**. The native engine does not render. | — |

Because stylesheets and images are never downloaded, a page load makes far fewer requests than a real browser. Some bot-detection systems notice this (see [stealth.md](./stealth.md)).

## 2. NetworkOptions and CLI flags

All server commands (`orbis`, `orbis serve`) and `orbis fetch` accept the same network flags. In TypeScript, pass `network` to `OrbisBrowser`, `OrbisAgent.launch()`, `NativeEngineAdapter`, `ChromeEngine` or `MCPServer`.

| `NetworkOptions` field | CLI flag | Type / default | Description |
| :--- | :--- | :--- | :--- |
| `proxy` | *(none that works in 0.1.0; see [section 7](#7-proxies))* | `string` | Proxy URL: `http://`, `https://`, `socks5://`, `socks5h://`, `socks://`. Credentials allowed as `user:pass@host`. |
| `proxyBearerToken` | `--proxy-bearer-token <token>` | `string` | Sent as `Proxy-Authorization: Bearer <token>`. HTTP(S) proxies only. |
| `noProxy` | `--proxy-bypass <hosts>` | `string[]` (CLI: comma-separated) | Hosts that skip the proxy |
| `useEnvProxy` | `--use-env-proxy` | `boolean`, `false` | Use `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` when no explicit proxy is set |
| `headers` | `--http-header "Name: Value"` (repeatable) | `Record<string,string>` | Extra headers on every request |
| `userAgent` | `--user-agent <ua>` | `string` | Overrides the `User-Agent` header (also `BrowserOptions.userAgent`) |
| `timeoutMs` | `--http-timeout <ms>` | `number`, fetcher default 15 000 | See [Timeouts](#4-timeouts) and the known issue there |
| `insecureTls` | `--insecure-disable-tls-host-verification` | `boolean`, `false` | Skip TLS certificate verification |
| `obeyRobots` | `--obey-robots` | `boolean`, `false` | Enforce robots.txt on every request |
| `robotsAgent` | `--robots-agent <token>` | `string`, `MemoraBrowser` | Product token matched against robots.txt `User-agent` lines |
| `onChallenge` | `--on-challenge <mode>` | `'report' \| 'stop'`, `'report'` | Unreleased. On a blocking CAPTCHA/bot challenge or 429: load and flag it, or throw `ChallengeDetectedError`. See [challenges.md](./challenges.md) |
| `challengeCooldownSec` | `--challenge-cooldown <sec>` | `number`, `60` | Unreleased. Pause requests to a host after a blocking challenge or 429; `Retry-After` wins; `0` disables |

TypeScript example:

```ts
import { OrbisBrowser } from '@memoracompany/orbis';

const browser = new OrbisBrowser({
  network: {
    proxy: 'http://user:pass@proxy.internal:3128',
    noProxy: ['localhost', '.internal.corp'],
    headers: { 'Accept-Language': 'en-GB,en;q=0.8' },
    userAgent: 'AcmeResearchBot/1.0 (+https://acme.example/bot)',
    obeyRobots: true,
    robotsAgent: 'AcmeResearchBot',
  },
});
const page = browser.newPage();
const { status, url } = await page.goto('https://example.com', { timeoutMs: 10_000 });
```

## 3. Headers and user agent

Navigation requests carry a Chrome 130 on Windows header set by default:

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Language: en-US,en;q=0.9
Sec-Ch-Ua: "Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"
Sec-Ch-Ua-Mobile: ?0
Sec-Ch-Ua-Platform: "Windows"
Sec-Fetch-Dest: document
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: none
Sec-Fetch-User: ?1
Upgrade-Insecure-Requests: 1
```

Script and page-`fetch()` requests send only `User-Agent` and `Accept: */*` (plus `Referer` for scripts).

> **Note:** these headers are sent even with `--no-stealth`. That flag only disables the JavaScript `navigator` patches (see [stealth.md](./stealth.md)). To change the identity Orbis presents, set `--user-agent` and `--http-header`.

**Precedence**, from lowest to highest priority:

1. the default header set,
2. `--user-agent` / `network.userAgent`,
3. headers set by CDP clients (`Network.setExtraHTTPHeaders`, for example Playwright `setExtraHTTPHeaders`),
4. `--http-header` / `network.headers` (CLI headers win over script-set headers),
5. per-request headers (`page.goto(url, { headers })`, form-submission headers, page `fetch()` `init.headers`).

The `Cookie` header is built from the page's cookie jar on every request.

> **Caution:** headers from `--http-header` (for example `Authorization`) are sent to **every** host the page contacts, including third-party scripts and redirect targets. Use them only when all URLs in that process belong to the same trusted service.

## 4. Timeouts

| What | Default | Control |
| :--- | :--- | :--- |
| Navigation request (all redirect hops) | 20 000 ms | `page.goto(url, { timeoutMs })` or `page.goto(url, 10_000)`; MCP `memora_browse` `timeout` |
| Script downloads during a load | The remaining navigation budget | Same as navigation |
| Post-load settle | 5 000 ms (capped by the navigation budget) | `page.settleTimeoutMs`, `page.goto(url, { settleTimeoutMs })` |
| Page `fetch()` | No Orbis timeout. Pages use their own `AbortController`. | — |
| robots.txt download | 10 000 ms | Not configurable |

A timed-out navigation throws `Navigation timeout after <ms>ms: <url>`.

> **Known issue (0.1.0):** `--http-timeout` / `network.timeoutMs` has no effect on navigations, because `page.goto()` always supplies its own timeout (20 000 ms by default). Verified: `orbis fetch <url> --http-timeout 200` still loaded a page that took 1.5 s. Set timeouts per call with `page.goto(url, { timeoutMs })`. `OrbisAgent.goto()` does not take a timeout, so use `agent.page.goto(url, { timeoutMs })` and then `agent.snapshot()`.

## 5. TLS

- Certificates are verified by default using Node.js's CA store. To trust an internal CA, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` before starting Orbis.
- `--insecure-disable-tls-host-verification` disables verification for direct connections and for proxied connections (both the proxy hop and the target). Use it only for staging hosts with self-signed certificates. See [security.md](./security.md#8-tls).
- TLS errors surface as `Request to <url> failed: <reason>`, for example `self-signed certificate` or `unable to verify the first certificate`.

## 6. Redirects

Navigation redirects are followed **manually**, so that cookies set on intermediate hops (typical of login flows) are captured.

- Maximum 20 hops; after that, `Too many redirects (> 20) starting at <url>`.
- `303` always switches to `GET` and drops the body. `301`/`302` switch `POST` to `GET`. `307`/`308` keep the method and body.
- Every hop is checked against robots.txt when `--obey-robots` is on.
- The final URL is reported as `page.url` and in the `goto()` result.

Page `fetch()` calls use automatic redirect following. Cookies set on intermediate hops of a page `fetch()` are not captured; only the final response's `Set-Cookie` headers are stored.

JavaScript navigations (`location.href = ...` during load) are followed up to 5 times per `goto()`.

## 7. Proxies

> **Known issue (0.1.0):** `--http-proxy <url>` is a placeholder for the upcoming Orbis Cloud managed proxy network. In 0.1.0 it prints an "Orbis Cloud (Coming Soon)" notice and **does not configure a proxy**. Requests go out directly. Use one of the two working methods below.

### Method 1: environment variables (CLI, daemon, MCP)

```bash
export HTTPS_PROXY="http://user:pass@proxy.internal:3128"
export HTTP_PROXY="http://user:pass@proxy.internal:3128"
export NO_PROXY="localhost,127.0.0.1,.internal.corp"
```

```bash
orbis --port 9222 --use-env-proxy
```

```bash
orbis fetch https://example.com --use-env-proxy --dump markdown
```

Resolution:
- `https:` targets use `HTTPS_PROXY`, other targets use `HTTP_PROXY`, then `ALL_PROXY` as a fallback.
- Lower-case variable names are also read.
- Environment variables are used **only** with `--use-env-proxy` (`network.useEnvProxy: true`), and only when no explicit `network.proxy` is set.

MCP configuration example:

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/orbis", "--mcp", "--use-env-proxy"],
      "env": {
        "HTTPS_PROXY": "http://proxy.internal:3128",
        "NO_PROXY": "localhost,127.0.0.1",
        "ORBIS_NO_TELEMETRY": "1"
      }
    }
  }
}
```

### Method 2: `network.proxy` in TypeScript

```ts
import { OrbisAgent } from '@memoracompany/orbis';

const agent = await OrbisAgent.launch({
  cdpPort: 9333,
  network: { proxy: 'socks5://user:pass@proxy.internal:1080', noProxy: ['localhost'] },
});
```

An invalid proxy URL or unsupported scheme throws when the browser is created, for example `Unsupported proxy protocol "ftp:". Use http://, https:// or socks5://`.

### Supported proxy types

| Scheme | Authentication | Notes |
| :--- | :--- | :--- |
| `http://` | `user:pass@` (Basic) or `--proxy-bearer-token` | HTTPS targets are tunnelled with `CONNECT` |
| `https://` | Same as `http://` | TLS to the proxy itself |
| `socks5://`, `socks5h://`, `socks://` | `user:pass@` | All are sent as SOCKS5. `--proxy-bearer-token` is rejected with `--proxy-bearer-token is only supported with http:// and https:// proxies`. |

Percent-encode special characters in credentials, for example `p%40ss` for `p@ss`.

### Proxy errors

| Message | Meaning |
| :--- | :--- |
| `Request to <url> failed: ... (407) — proxy rejected the credentials (check user:pass in --http-proxy or --proxy-bearer-token)` | Wrong or missing proxy credentials. The hint mentions `--http-proxy`, but in 0.1.0 put credentials in the proxy environment variable or `network.proxy`. |
| `Request to <url> failed: connect ECONNREFUSED ...` | The proxy is unreachable |
| `Navigation timeout after 20000ms: <url>` | The proxy or target is too slow. Raise `timeoutMs` per call. |

Orbis redacts proxy credentials in its startup banner.

## 8. NO_PROXY and proxy bypass rules

Bypass entries come from `--proxy-bypass` / `network.noProxy`, plus `NO_PROXY` when `--use-env-proxy` is active and no explicit proxy is set. Matching is case-insensitive:

| Rule | Matches |
| :--- | :--- |
| `*` | Every host |
| `example.com` | `example.com` and every subdomain (`a.example.com`) |
| `.example.com` or `*.example.com` | Subdomains of `example.com` and `example.com` itself |
| `example.com:8080` | That host (and subdomains) on port 8080 only |
| `10.0.0.5` | That exact IP. CIDR ranges are not supported. |
| `[::1]` | IPv6 literal |

## robots.txt

Enable robots.txt compliance for crawling and research workloads:

```bash
orbis fetch https://example.com/docs --obey-robots --robots-agent AcmeResearchBot --user-agent "AcmeResearchBot/1.0 (+https://acme.example/bot)"
```

```ts
const browser = new OrbisBrowser({ network: { obeyRobots: true, robotsAgent: 'AcmeResearchBot' } });
```

Behaviour (RFC 9309):

| Aspect | Behaviour |
| :--- | :--- |
| Scope | Every request is checked: navigations, **every redirect hop**, script downloads and page `fetch()` |
| Fetch | One `/robots.txt` per origin (scheme + host + port), shared by all pages of the browser. Concurrent requests share one download. Redirects on `robots.txt` itself are followed. |
| Cache | 24 hours per origin, per browser |
| Size | The first 500 KiB are parsed |
| Download timeout | 10 seconds |
| `2xx` | Rules are parsed |
| `4xx` (including 404) | Everything allowed |
| `5xx` or network error/timeout | **Everything disallowed** for that origin, cached for 24 hours |
| Agent matching | Groups whose `User-agent` equals the product token (case-insensitive) are used. Otherwise the `*` groups. Matching groups are combined. |
| Rule precedence | Longest matching path pattern wins; on a tie, `Allow` wins. `*` and `$` wildcards are supported, and paths are percent-encoding-normalised. |
| `/robots.txt` itself | Always allowed |
| Token format | `--robots-agent` must contain only letters, `_` and `-`, otherwise the CLI exits with `Invalid --robots-agent ... (RFC 9309)` |
| Default token | `MemoraBrowser` |

When a request is blocked:
- `[Memora] blocked by robots.txt: <url>` is written to stderr,
- the request throws `RobotsBlockedError` (`name: 'RobotsBlockedError'`, `code: 'ERR_BLOCKED_BY_ROBOTS'`, `url`, `robotsUrl`) with the message `Blocked by robots.txt: <url> (rules from <origin>/robots.txt)`,
- a blocked script is skipped, and the error is logged to the page console.

```ts
try {
  await page.goto(url);
} catch (err: any) {
  if (err?.code === 'ERR_BLOCKED_BY_ROBOTS') {
    // record and skip this URL
  } else throw err;
}
```

> **Note:** the token in `--robots-agent` is only used for robots.txt matching. The `User-Agent` header remains the Chrome default unless you also set `--user-agent`. Responsible crawlers should set both so that site owners can identify and contact them.

## 10. Cookies

Native engine behaviour:

- Each page has its own cookie jar. Pages created by the same `OrbisBrowser` do **not** share cookies. A forked page starts with a copy.
- `Set-Cookie` is processed on navigations, on every redirect hop, and on the final response of page `fetch()`.
- The jar is a flat `name → value` map. **Domain, Path, Secure, HttpOnly, SameSite and expiry are ignored.** A cookie is removed only by `Max-Age=0` or an `Expires` date before 1980.
- Every cookie is sent to every host, including subresources and redirect targets.
- `document.cookie` is not available to page scripts in the native SDK engine.
- Manage cookies with `page.fetcher.setCookie(name, value)`, `deleteCookie(name)`, `clearCookies()` and `dumpCookies()`, with WebDriver `add_cookie`/`get_cookies`/`delete_cookie`, CDP `Network.getCookies`, or MCP `memora_cookies`.

> **Known issue (0.1.0):** because cookies are not scoped, a session cookie from one site is sent to every other site the page visits (verified). See [security.md](./security.md#25-cookies-are-not-scoped-to-a-site) and [sessions-and-auth.md](./sessions-and-auth.md).

## 11. Chrome engine differences

The Chrome engine is only used by the MCP server (`--engine chrome`, or `--engine auto` when Chrome or Edge is installed).

| Option | Chrome engine behaviour |
| :--- | :--- |
| Proxy | `network.proxy` or the environment variables (with `--use-env-proxy`) are passed to Chrome. SOCKS is sent as `socks5`. Credentials are passed as username/password. |
| `--proxy-bearer-token` | Ignored, with a stderr notice. Use `user:pass@` in the proxy URL. |
| Bypass | `noProxy` entries are passed as Chrome's proxy bypass list |
| Headers / user agent | Applied to the browser context (`extraHTTPHeaders`, `userAgent`) |
| TLS | `insecureTls` maps to `ignoreHTTPSErrors` |
| robots.txt | Enforced on every http(s) request, including subresources, with the same rules |
| Cookies | Chrome's normal, correctly scoped cookie store |

## 12. Recipes

**Corporate proxy with internal sites bypassed**

```bash
HTTPS_PROXY=http://proxy.corp:8080 NO_PROXY=".corp,localhost" orbis --port 9222 --use-env-proxy
```

**Authenticated internal API** (only if every URL in the process belongs to that service)

```bash
orbis fetch https://intranet.corp/reports --http-header "Authorization: Bearer $INTRANET_TOKEN" --dump markdown
```

**Self-signed staging certificate (preferred over disabling TLS)**

```bash
NODE_EXTRA_CA_CERTS=./staging-ca.pem orbis fetch https://staging.corp --dump action_map
```

**Polite research crawler**

```ts
const browser = new OrbisBrowser({
  network: {
    obeyRobots: true,
    robotsAgent: 'AcmeResearchBot',
    userAgent: 'AcmeResearchBot/1.0 (+https://acme.example/bot; bots@acme.example)',
  },
});
const page = browser.newPage();
for (const url of urls) {
  try {
    await page.goto(url, { timeoutMs: 15_000 });
    // ... extract ...
  } catch (e: any) {
    if (e?.code !== 'ERR_BLOCKED_BY_ROBOTS') console.error(url, e.message);
  }
  await new Promise(r => setTimeout(r, 1000)); // rate limit
}
browser.close();
```

See also: [cli-reference.md](./cli-reference.md), [stealth.md](./stealth.md), [security.md](./security.md), [production-deployment.md](./production-deployment.md).
