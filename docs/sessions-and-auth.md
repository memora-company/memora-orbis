# Sessions and Authentication

This page explains how Orbis stores and restores browser state (cookies, `localStorage`, `sessionStorage`), how to log in once and reuse the session, how to inject tokens, and how to handle expiring sessions safely. It covers the TypeScript SDK, the Python SDK, the REST API, CDP and MCP, and it documents the behaviour of the native engine that affects authentication.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. What a session contains](#1-what-a-session-contains)
- [2. Session file format (version 1)](#2-session-file-format-version-1)
- [3. Saving and loading in every interface](#3-saving-and-loading-in-every-interface)
- [4. Pattern: log in once, reuse many times](#4-pattern-log-in-once-reuse-many-times)
- [5. Injecting tokens and cookies directly](#5-injecting-tokens-and-cookies-directly)
- [6. Detecting expiry and rotating sessions](#6-detecting-expiry-and-rotating-sessions)
- [7. Storing session files securely](#7-storing-session-files-securely)
- [8. Native engine behaviour you must know](#8-native-engine-behaviour-you-must-know)
- [9. Chrome engine differences](#9-chrome-engine-differences)

---

## 1. What a session contains

| Item | Saved | Notes |
| :--- | :--- | :--- |
| Cookies | Yes, in `cookieList` with domain, path, flags and expiry, plus a `cookies` name → value map for the current site | |
| `localStorage` | Yes | The storage of the **current page's origin** |
| `sessionStorage` | Yes | Same as `localStorage` |
| Current URL | Yes (`url`) | Informational only. Loading a session does **not** navigate. |
| Page DOM, history, JS state | No | Use `page.fork()` to copy the current DOM within a process |

## 2. Session file format (version 1)

```json
{
  "version": 1,
  "createdAt": "2026-10-31T09:15:02.118Z",
  "url": "https://app.example.com/dashboard",
  "cookies": {
    "session_id": "s%3AqP1x...redacted",
    "csrftoken": "b1c9...redacted"
  },
  "cookieList": [
    { "name": "session_id", "value": "s%3AqP1x...redacted", "domain": "app.example.com",
      "hostOnly": true, "path": "/", "secure": true, "httpOnly": true, "expires": 1793430000000 },
    { "name": "csrftoken", "value": "b1c9...redacted", "domain": "app.example.com",
      "hostOnly": true, "path": "/", "secure": true, "httpOnly": false }
  ],
  "localStorage": {
    "theme": "dark"
  },
  "sessionStorage": {}
}
```

`cookieList` holds every cookie with its site: `domain`, `hostOnly` (`true` = only that exact host; `false` = the domain and its subdomains), `path`, `secure`, `httpOnly` and `expires` (Unix time in milliseconds; missing for session cookies). When it is present, loading uses it.

Session files from earlier versions only have the `cookies` map. They still load: those cookies are applied to the site in the file's `url`.

Validation when loading (any failure throws):

| Check | Error message |
| :--- | :--- |
| File exists | `Session file not found: <path>` |
| Valid JSON | `Failed to parse session JSON from <path>: <parser message>` |
| `version === 1` | `Unsupported session version: <v>. Expected version 1` |
| `url` is a string | `Invalid session: missing "url" string` |
| `cookies`, `localStorage`, `sessionStorage` are objects | `Invalid session: missing or invalid "<field>" object` |

Saving creates missing parent directories and overwrites an existing file. Files are written as UTF-8 with 2-space indentation and **no encryption**.

## 3. Saving and loading in every interface

### TypeScript (`OrbisAgent`)

```ts
import { OrbisAgent } from '@memoracompany/memora-orbis';

const agent = await OrbisAgent.launch({ cdpPort: 9333 });
// ... log in ...
agent.saveSession('./sessions/app.json');        // write file
const data = agent.dumpSession();                 // in-memory SessionData object
agent.loadSession('./sessions/app.json');         // read file into the current page
agent.page.restoreSession(data);                  // restore from an object (no file)
```

### TypeScript (`OrbisBrowser` / `OrbisPage`)

```ts
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const browser = new OrbisBrowser();
const page = browser.newPage();
page.loadSession('./sessions/app.json');
await page.goto('https://app.example.com/dashboard');
```

Helper functions are exported as well: `saveSessionToFile(path, data)`, `loadSessionFromFile(path)` and `validateSessionData(obj)`.

### Python SDK

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://127.0.0.1:9222")
agent.save_session("app.json")   # on the DAEMON's filesystem, inside its session folder
agent.load_session("app.json")
```

> **Important:** the Python SDK calls the daemon's REST API, so `file_path` is resolved **on the machine of the Orbis daemon**, not where your Python code runs. The daemon only reads and writes `.json` files inside the folder it was started in, or inside `ORBIS_SESSION_DIR` if set; relative paths are resolved against that folder, and other paths are refused with HTTP 403. With Docker, set `ORBIS_SESSION_DIR` to a mounted volume such as `/data/sessions`.

### REST API

| Request | Effect |
| :--- | :--- |
| `GET /orbis/session` | Returns the current `SessionData` JSON (no file involved) |
| `POST /orbis/session` `{"session": { ...SessionData... }}` | Restores from the request body (no file involved) |
| `POST /orbis/session` `{"filePath": "app.json"}` | Restores from a file in the daemon's session folder |
| `POST /orbis/session/save` `{"filePath": "app.json"}` | Writes a file in the daemon's session folder |

All of these accept `?id=<pageId>` and default to the default page. File paths must end in `.json` and lie inside the folder the daemon was started in (or `ORBIS_SESSION_DIR`); other paths return HTTP 403 (`ERR_SESSION_PATH`). Prefer the body-based `GET`/`POST {"session": ...}` pair, so your application keeps custody of the data (see [security.md](./security.md#24-session-file-paths-are-restricted)).

```bash
curl -s http://127.0.0.1:9222/orbis/session > app-session.json
```

```bash
curl -s -X POST http://127.0.0.1:9222/orbis/session -H "Content-Type: application/json" -d "{\"session\": $(cat app-session.json)}"
```

### CDP

Custom domain methods (also available under `Memora.*` and `LP.*`):

```ts
const cdp = await page.context().newCDPSession(page);  // Playwright
await cdp.send('Orbis.saveSession' as any, { filePath: 'app.json' });
await cdp.send('Orbis.loadSession' as any, { filePath: 'app.json' });
```

As with REST and MCP, `filePath` must end in `.json` and lie inside the daemon's session folder (the folder it was started in, or `ORBIS_SESSION_DIR`).

### MCP

The `memora_session` tool takes `{ "action": "save" | "load", "path": "<file>" }`. The path must be a `.json` file inside the folder the MCP server was started in (which depends on how the client launches it), or inside `ORBIS_SESSION_DIR`. Set `ORBIS_SESSION_DIR` in the MCP server's environment so the location is predictable. Other paths return a tool error. See [mcp.md](./mcp.md).

## 4. Pattern: log in once, reuse many times

Log in with credentials from your secret store, verify that it worked, save the session, and reuse it in later jobs. Type the credentials in code, never through an LLM tool call (see [section 7 of security.md](./security.md#7-keeping-secrets-away-from-the-llm)).

```ts
import fs from 'node:fs';
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const SESSION = '/data/sessions/app.json';
const APP = 'https://app.example.com';

async function login(): Promise<void> {
  const browser = new OrbisBrowser();
  const page = browser.newPage();
  try {
    await page.goto(`${APP}/login`, { timeoutMs: 15_000 });
    const res = await page.fillForm({
      fields: {
        'label:Email': process.env.APP_USER!,
        'input[type="password"]': process.env.APP_PASSWORD!,
      },
      submit: 'text=Sign in',
    });
    if (res.skipped.length) throw new Error(`Login form changed, missing: ${res.skipped.join(', ')}`);
    if (page.url.includes('/login')) throw new Error('Login failed (still on the login page)');
    page.saveSession(SESSION);
    fs.chmodSync(SESSION, 0o600);
  } finally {
    browser.close();
  }
}

async function withSession<T>(fn: (page: ReturnType<OrbisBrowser['newPage']>) => Promise<T>): Promise<T> {
  if (!fs.existsSync(SESSION)) await login();
  const browser = new OrbisBrowser();
  const page = browser.newPage();
  try {
    page.loadSession(SESSION);
    await page.goto(`${APP}/dashboard`, { timeoutMs: 15_000 });
    if (page.url.includes('/login')) {          // session expired
      browser.close();
      await login();
      return withSession(fn);
    }
    return await fn(page);
  } finally {
    browser.close();
  }
}

const rows = await withSession(async page => page.extract('table tr', 'text', 100));
```

Notes:

- `fillForm` with `submit: 'text=Sign in'` clicks the button with full browser default actions, so form submission and the resulting navigation happen. See [typescript-sdk.md](./typescript-sdk.md).
- The `withSession` helper retries at most once per call in practice. Add a counter if your login can fail repeatedly.
- This pattern is simplest with **cookie-based** authentication. For token-in-storage applications, see [section 8](#8-native-engine-behaviour-you-must-know).

## 5. Injecting tokens and cookies directly

If you already hold a valid session cookie or token (for example, issued by your own auth service for a test user), inject it instead of driving the login UI.

**Cookie (works across navigations):**

```ts
page.fetcher.setCookie('session_id', token, 'https://app.example.com/');   // the cookie's site
await page.goto('https://app.example.com/dashboard');
```

Cookies are scoped by site, so say which site the cookie belongs to (without a URL, the current page's site is used).

Other interfaces:
- WebDriver: `driver.add_cookie({"name": "session_id", "value": token})` after loading any page on the site.
- MCP: `memora_cookies` with `{"action": "set", "name": "session_id", "value": "..."}` after loading a page on the site (the cookie is set for the current site).
- REST: `POST /orbis/session` `{"session": {"version":1,"createdAt":"","url":"https://app.example.com/","cookies":{"session_id":"..."},"localStorage":{},"sessionStorage":{}}}` (the cookies apply to the site in `url`).

**Authorization header (when the app accepts bearer tokens on page requests):**

```bash
orbis --port 9222 --http-header "Authorization: Bearer $APP_TOKEN"
```

The header is sent to every host the process contacts. Use a dedicated process that only visits that application.

**localStorage token:** restored storage belongs to the origin of the page that is loaded when you restore it, so load a page of the application first:

```ts
await page.goto('https://app.example.com/');
page.restoreSession({
  version: 1, createdAt: new Date().toISOString(), url: page.url,
  cookies: {}, localStorage: { access_token: token }, sessionStorage: {},
});
await page.goto('https://app.example.com/dashboard');   // same origin: the token is still there
```

## 6. Detecting expiry and rotating sessions

- **Detect expiry after loading a session.** Check whether `page.url` redirected to a login page, whether `page.lastStatus` is `401`/`403`, or whether the snapshot contains a sign-in form (`page.resolveElement('input[type="password"]')`).
- **Refresh proactively.** Store `createdAt` (already in the file) and re-login before the application's session lifetime ends.
- **Re-save after each run** if the application rotates cookies on every request, so the file holds the newest values.
- **Invalidate on credential change.** Delete session files when the account password is rotated or the session is revoked server-side.
- **One session per account and per site.** Keep a separate session file for each site and account, so that rotating or revoking one does not affect the others.

## 7. Storing session files securely

Session files are equivalent to logged-in credentials.

- Keep them in a dedicated directory (for example `/data/sessions`), mode `0700`, with files `0600`, owned by the Orbis service user.
- Never commit them. This repository's `.gitignore` already ignores `sessions/`.
- Encrypt them when they leave the host. Store them in your secret manager or on an encrypted volume.
- Prefer the in-memory APIs (`dumpSession()` / `restoreSession()`, `GET`/`POST {"session": ...}`) so your application controls encryption and storage.
- Typed values are hidden in snapshots and diffs (`[FILLED]`, `[filled]`), and a saved session does not contain them either. Reusing sessions still avoids handling the password at all.

## 8. Native engine behaviour you must know

- **Cookies are scoped like a browser:** by domain (host-only, or the domain and its subdomains when `Domain=` is set), path, `Secure` and expiry. A cookie from one site is not sent to other sites, and expired cookies are not sent. Keeping one page or context per credential set is still good practice, so that browsing other sites cannot act on an authenticated session.
- **`localStorage` and `sessionStorage` persist across navigations within the same origin**, per page (tab), and each origin has its own storage. A token kept in `localStorage` therefore survives `goto()`, reloads and link clicks on the same site.
- A saved session contains the storage of the current page's origin, and restoring writes storage into the origin of the page that is loaded at that moment. Load a page of the application before restoring a session that contains storage.

> **Changed in 0.2.0:** earlier versions sent every cookie to every host and reset `localStorage` / `sessionStorage` on every navigation.

Other native-engine details:

- `loadSession()` / `restoreSession()` do not navigate and do not change `page.url`. Call `goto()` afterwards.
- `dumpSession()` returns empty storage objects if the current page never created a JavaScript context (script-free pages).
- `fork()` copies cookies and the current document's storage into the forked page.

## 9. Chrome engine differences

The Chrome engine is used only by the MCP server (`--engine chrome`, or `auto` when Chrome or Edge is installed).

| Aspect | Chrome engine |
| :--- | :--- |
| Cookie scoping | Chrome's normal domain/path/secure scoping |
| Saving | Cookies are exported as `name → value` only (domain, path and expiry are dropped) |
| Restoring cookies | Each cookie is added with domain = the host of the current page, or of the session's `url` when the page is `about:blank`, and path `/` |
| Restoring storage | Written into the current page's origin. Navigate to the application **before** `load`, because writing storage on `about:blank` fails in Chrome. |
| Storage persistence | Persists per origin across navigations |

Recommended MCP sequence for a storage-based application:

1. `memora_browse` to `https://app.example.com/`.
2. `memora_session` with `{"action":"load","path":"app.json"}` (a file in the server's session folder).
3. `memora_reload` or `memora_browse` to the target page.

See also: [security.md](./security.md), [network-and-proxies.md](./network-and-proxies.md#10-cookies), [typescript-sdk.md](./typescript-sdk.md), [python-sdk.md](./python-sdk.md), [http-api.md](./http-api.md), [mcp.md](./mcp.md).
