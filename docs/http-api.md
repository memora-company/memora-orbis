# HTTP API Reference

Every Orbis CDP server (started with `orbis`, `orbis serve`, or `OrbisAgent.launch()`) also exposes a small JSON-over-HTTP API next to the Chrome DevTools Protocol WebSocket. The **agent endpoints** (`/orbis/*`) let any language navigate, read the action map, click, type, fill forms, diff and manage sessions with plain HTTP calls; the Python SDK is a thin client over them. The **discovery endpoints** (`/json/*`) are the standard Chrome endpoints that Playwright, Puppeteer and other CDP clients call. This page documents every endpoint, parameter, response and status code, with responses captured from a running server.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Before you start: security](#before-you-start-security)
- [Base URL, conventions and errors](#base-url-conventions-and-errors)
- [Which page does an endpoint use?](#which-page-does-an-endpoint-use)
- [Agent endpoints](#agent-endpoints)
  - [GET /orbis/goto](#get-orbisgoto)
  - [GET /orbis/snapshot](#get-orbissnapshot)
  - [GET /orbis/diff and POST /orbis/diff](#get-orbisdiff-and-post-orbisdiff)
  - [POST /orbis/act](#post-orbisact)
  - [POST /orbis/fill-form](#post-orbisfill-form)
  - [POST /orbis/select-option](#post-orbisselect-option)
  - [GET /orbis/session and POST /orbis/session](#get-orbissession-and-post-orbissession)
  - [POST /orbis/session/save](#post-orbissessionsave)
- [CDP discovery endpoints](#cdp-discovery-endpoints)
- [WebSocket endpoints](#websocket-endpoints)
- [End-to-end examples](#end-to-end-examples)
- [Endpoints that do not exist](#endpoints-that-do-not-exist)
- [Known issues](#known-issues)

---

## Before you start: security

The port gives full control of the browser, so protect it:

- **Bind address.** `--host localhost` (the default) and `--host 127.0.0.1` listen on `127.0.0.1` only. Pass `--host 0.0.0.0` only when other machines or containers must connect.
- **API key.** When `ORBIS_API_KEY` (or `MEMORA_API_KEY`, or the `apiKey` option) is set, every HTTP request and every CDP WebSocket connection must send the key as `x-api-key: <key>`, `Authorization: Bearer <key>` or `?apiKey=<key>`. Otherwise the server answers `401`. Set a key whenever the port is reachable by anything other than your own process.
- **Web pages are refused.** Requests made by a web page open in someone's browser (cross-site requests) are refused with `403` and `ERR_FORBIDDEN_ORIGIN`. The server sends no CORS headers.
- **Session files.** The session endpoints only read and write `.json` files inside the folder the server was started in, or inside `ORBIS_SESSION_DIR` if set.

Never expose the port to the internet. See [security.md](./security.md) and [production-deployment.md](./production-deployment.md).

> **Changed in 0.2.0:** earlier versions did not check the API key, listened on all interfaces for `--host localhost`, sent `Access-Control-Allow-Origin: *`, and let the session endpoints use any file path. If your clients relied on any of these, update them.

---

## Base URL, conventions and errors

```text
http://<host>:<port>          default http://localhost:9222
```

- Every agent path has an alias under `/memora/` (`/memora/snapshot` = `/orbis/snapshot`, etc.). Use `/orbis/`.
- Trailing slashes are ignored.
- Request bodies are JSON. The `Content-Type` header is not checked, but send `application/json`.
- Responses are JSON (`Content-Type: application/json`) except `GET /orbis/snapshot?format=markdown` (`text/markdown; charset=utf-8`).
- No CORS: responses carry no `Access-Control-*` headers, and requests sent by web pages in a browser are refused with `403`. Call the API from your own code or scripts, not from a web page.
- Authentication: when an API key is configured, send it on every request (`x-api-key`, `Authorization: Bearer` or `?apiKey=`).
- Navigation (`/orbis/goto`, form submission) is asynchronous; snapshot, diff, act and session calls are synchronous computations on the in-memory DOM. Concurrent requests against the **same page** are not serialized for you; send one request at a time per page.

Error format and status codes:

| Status | Body | When |
| :--- | :--- | :--- |
| `200` | endpoint-specific | Success. Note that `success: false` inside a 200 response means "element not found" for `/orbis/act`. |
| `400` | `{"error":"Invalid JSON body: ..."}` | Body is not valid JSON. |
| `400` | `{"error":"Missing ..."}` | Required field missing (see each endpoint). |
| `401` | `{"error":"Missing or wrong API key ...","code":"ERR_UNAUTHORIZED"}` | An API key is configured and the request did not send it (or sent a wrong one). |
| `403` | `{"error":"Requests from web pages are not allowed","code":"ERR_FORBIDDEN_ORIGIN"}` | The request came from a web page in a browser (cross-site). |
| `403` | `{"error":"Session files must ...","code":"ERR_SESSION_PATH"}` | A session file path is outside the allowed folder or does not end in `.json`. |
| `404` | `{"error":"Page not found"}` | `?id=` / `"id"` does not match an open page. |
| `404` | `{"error":"Not found"}` | Unknown path. |
| `405` | `{"error":"Method not allowed","code":"ERR_METHOD_NOT_ALLOWED"}`, header `Allow: <methods>` | Known path, wrong HTTP method (e.g. `GET /orbis/act`). The `Allow` header lists the methods the path accepts. |
| `409` | `{"error":"# CHALLENGE DETECTED ...","code":"ERR_CHALLENGE_DETECTED","challenge":{...},"cooldownSec":60}` | Added in 0.1.2. The page is a CAPTCHA / bot check / block page / 429 and the daemon runs with `--on-challenge stop`. `/orbis/goto` and `/orbis/fill-form`. |
| `429` | `{"error":"Requests to <host> are paused ...","code":"ERR_CHALLENGE_COOLDOWN","host":"...","remainingSec":42,"challenge":{...}}`, header `Retry-After: <remainingSec>` | Added in 0.1.2. The host is in cooldown after a challenge. `/orbis/goto` and `/orbis/fill-form`. |
| `500` | `{"error":"Error: Request to ... failed: ..."}` | Navigation failed (DNS, TLS, timeout, robots.txt block) or form fill threw. |

HTTP errors of the *target website* (404, 500) are not errors of the API: `/orbis/goto` returns `200` with `"status": 404` in the body.

From 0.1.2, `/orbis/goto`, `/orbis/fill-form` and the JSON form of `/orbis/snapshot` also return a `challenge` field: `null`, or the CAPTCHA / bot-check signal of the last navigation (`kind`, `vendor`, `blocking`, `confidence`, `evidence`, `url`, `status`, `retryAfterSec`). When `challenge.blocking` is `true`, the snapshot is the challenge page, not the real page. See [challenges.md](./challenges.md).

---

## Which page does an endpoint use?

A server can hold many pages (tabs), created by `OrbisAgent.launch()`, by Playwright/Puppeteer over CDP, or by `/json/new`. Each has an `id` (a UUID, listed by `/json/list`).

| Endpoint | Page used |
| :--- | :--- |
| `/orbis/goto`, `/orbis/snapshot`, `/orbis/diff`, `GET`/`POST /orbis/session` | `?id=<page id>` query parameter, otherwise the default page. |
| `/orbis/act`, `/orbis/fill-form`, `/orbis/select-option`, `/orbis/session/save` | `"id"` in the JSON body or `?id=` in the query, otherwise the default page. |

The **default page** is the oldest page that is still open; if none is open, a new blank page is created on the fly. With `OrbisAgent.launch()` it is the agent's own page (`agent.page`).

Because all clients that omit `id` share the default page, **one REST client per server** is the safe production pattern. Running several agents against one daemon makes them navigate and click on the same page and see each other's cookies. The Python SDK never sends `id`. See [production-deployment.md](./production-deployment.md) for scaling patterns.

---

## Agent endpoints

### GET /orbis/goto

Navigate a page (the default page unless you pass `id`) and return the new snapshot.

| Parameter | In | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | query | yes | Absolute URL (URL-encode it). Relative URLs are resolved against the page's current URL. |
| `id` | query | no | Page id to navigate (from `/json/list`). Default: the default page. |

Any HTTP method is accepted. Navigation follows redirects, runs scripts and waits up to 5 s for the page to settle; it times out after 20 s by default (change it with the server's `--http-timeout <ms>` flag).

```bash
curl -s "http://localhost:9222/orbis/goto?url=https%3A%2F%2Fexample.com"
```

Response `200`:

```json
{
  "status": 200,
  "url": "http://127.0.0.1:18091/",
  "snapshot": {
    "url": "http://127.0.0.1:18091/",
    "title": "Login",
    "tokenEstimate": 64,
    "interactiveCount": 2,
    "actions": [
      {
        "actionId": "@1",
        "tag": "input",
        "role": "input",
        "text": "User",
        "name": "user",
        "placeholder": "User",
        "selector": "input[name=\"user\"]",
        "isClickable": false,
        "isInput": true,
        "disabled": false
      },
      {
        "actionId": "@2",
        "tag": "button",
        "role": "button",
        "text": "Go",
        "type": "submit",
        "selector": "html:nth-of-type(1) > body:nth-of-type(1) > form:nth-of-type(1) > button:nth-of-type(1)",
        "isClickable": true,
        "isInput": false,
        "disabled": false
      }
    ],
    "actionMapText": "=== INTERACTIVE ACTION MAP (2 elements) ===\n[@1] [input] \"User\" placeholder=\"User\" (selector: input[name=\"user\"])\n[@2] [button] \"Go\" type=\"submit\" (selector: ...)",
    "markdown": "Go"
  }
}
```

Fields of `snapshot` are documented in [typescript-sdk.md](./typescript-sdk.md#semanticpagesnapshot). Errors: `400 {"error":"Missing url parameter"}`; `500 {"error":"Error: Request to <url> failed: <reason>"}`.

From 0.1.2, responses add `"challenge"` (signal or `null`) and `"challengeCooldownSec"` (seconds the host is now paused, `0` if none) next to `status`. They can also return `409` (stop mode) and `429` (host in cooldown); see the error table above.

### GET /orbis/snapshot

Distill the current page without navigating.

| Parameter | In | Description |
| :--- | :--- | :--- |
| `id` | query | Page id (optional). |
| `focus` or `focusSelector` | query | CSS selector; only that subtree is distilled. |
| `exclude` or `excludeSelectors` | query | Comma-separated CSS selectors to skip (e.g. `nav,footer,.cookie-banner`). |
| `format` | query | `markdown` returns only the Markdown as `text/markdown`. Anything else returns the JSON snapshot. |

```bash
# JSON snapshot (also becomes the baseline for the next diff)
curl -s "http://localhost:9222/orbis/snapshot"

# Only the main article as Markdown, without navigation and footer
curl -s "http://localhost:9222/orbis/snapshot?format=markdown&focus=main&exclude=nav,footer"

# A specific tab
curl -s "http://localhost:9222/orbis/snapshot?id=0e220c65-8d0f-418b-b24c-49cafb106e3e"
```

Response `200` (JSON): a [`SemanticPageSnapshot`](./typescript-sdk.md#semanticpagesnapshot) object. Errors: `404 Page not found`.

`@n` IDs from a `focus`/`exclude` snapshot resolve to the elements shown in that snapshot (see [locators.md](./locators.md#action-ids-n)). The `format=markdown` variant does not update the diff baseline; the JSON variant does.

### GET /orbis/diff and POST /orbis/diff

Take a new snapshot and compare it with the previous one.

GET parameters: `id`, `focus`/`focusSelector`, `exclude`/`excludeSelectors` (as for snapshot).

POST body (all optional):

```json
{
  "previousSnapshot": { "...": "a snapshot object you stored earlier" },
  "focusSelector": "main",
  "excludeSelectors": ["nav", "footer"]
}
```

`id` for POST is read from the query string only.

```bash
curl -s "http://localhost:9222/orbis/diff"
```

Response `200`:

```json
{
  "diff": {
    "urlChanged": false,
    "previousUrl": "http://127.0.0.1:18091/",
    "currentUrl": "http://127.0.0.1:18091/",
    "titleChanged": false,
    "previousTitle": "Login",
    "currentTitle": "Login",
    "addedActions": [],
    "removedActions": [],
    "mutatedActions": [],
    "summary": "=== PAGE STATE DELTA ===\nNo visual, DOM, or interactive changes detected."
  },
  "currentSnapshot": { "...": "the new snapshot, which is now the baseline" }
}
```

For LLM prompts, send only `diff.summary`; its format is documented in [typescript-sdk.md](./typescript-sdk.md#diff-summary).

### POST /orbis/act

Click or type into one element.

| Body field | Required | Description |
| :--- | :--- | :--- |
| `actionId` (or `target`) | yes | Any [locator](./locators.md): `@3`, `text=Sign in`, `label:Email`, CSS, XPath... |
| `type` | no | `"type"` to type; anything else (or omitted) clicks. |
| `text` | with `type: "type"` | Text to set. If `type` is `"type"` but `text` is missing, the request **clicks** instead. |
| `id` | no | Page id (or `?id=`). |

Typing sets the value and fires `input` and `change`. Clicking works like a real click: it runs JavaScript click handlers, follows links and submits forms (same as `agent.act()` in the SDK). When the click navigates, the request returns after the new page has loaded.

```bash
# Type
curl -s -X POST http://localhost:9222/orbis/act \
  -H "Content-Type: application/json" \
  -d '{"actionId":"placeholder:User","type":"type","text":"ada"}'

# Click (runs click handlers, follows links, submits forms)
curl -s -X POST http://localhost:9222/orbis/act \
  -H "Content-Type: application/json" \
  -d '{"actionId":"@2"}'
```

Response `200`:

```json
{
  "success": true,
  "url": "<page url after the action>",
  "snapshot": { "...": "snapshot after the action (the filled field shows [FILLED])" }
}
```

The returned snapshot does not move the diff baseline, so a following `GET /orbis/diff` shows what the action changed. `success: false` means the locator did not resolve; the request still returns `200`. Errors: `400 {"error":"Missing actionId or target"}`, `404 Page not found`.

> **Changed in 0.2.0:** clicks now follow links and submit forms, and the call no longer resets the diff baseline. Earlier versions only ran click handlers and made the next diff compare against the post-action state.

### POST /orbis/fill-form

Fill several fields in one call and, if you ask for it, submit the form.

> **Changed in 0.2.0:** `submit` defaults to `false`, so the form is only filled. Earlier versions submitted by default. Send `"submit": true` or a submit button locator to submit.

| Body field | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `fields` | yes | | Object mapping [locators](./locators.md) to string values. Checkboxes: `"true"`/`"1"`/`"yes"`/`"checked"`/`"on"` check, anything else unchecks. |
| `submit` | no | `false` | `true`: submit the form of the first filled field. `false`: only fill. A locator string: real click on that element (follows links, submits). |
| `submitActionId` | no | | Used when `submit` is absent. |
| `steps` | no | | Array of `{ fields, submit }` objects executed in order (multi-step wizard). When present, top-level `fields` is still required by validation but ignored. |
| `id` | no | | Page id (or `?id=`). |

```bash
# Fill and submit
curl -s -X POST http://localhost:9222/orbis/fill-form \
  -H "Content-Type: application/json" \
  -d '{"fields":{"placeholder:User":"bob"},"submit":true}'

# Fill only, do not submit (default)
curl -s -X POST http://localhost:9222/orbis/fill-form \
  -H "Content-Type: application/json" \
  -d '{"fields":{"label:Email":"ada@example.com","input[name=\"terms\"]":"true"}}'

# Fill and click a specific button
curl -s -X POST http://localhost:9222/orbis/fill-form \
  -H "Content-Type: application/json" \
  -d '{"fields":{"label:Email":"ada@example.com","label:Password":"..."},"submit":"text=Sign in"}'
```

Response `200` (verified, after a GET form submission):

```json
{
  "success": true,
  "filled": ["placeholder:User"],
  "skipped": [],
  "fieldsFilled": 1,
  "submitted": true,
  "url": "http://127.0.0.1:18091/done?user=bob",
  "title": "Done",
  "snapshot": { "...": "snapshot of the page after submission" }
}
```

`success` is `true` only if every field was filled and, when you asked for a submit, the submit happened. Otherwise it is `false` (the status is still `200`); `skipped` lists the locators that did not resolve, and `submitted` tells you whether the form was submitted. Errors: `400 {"error":"Missing or invalid \"fields\" object"}`, `404 Page not found`, `500 {"error":"..."}` if submission navigation failed.

> **Changed in 0.2.0:** in 0.1.x `success` was always `true`, even when fields were skipped.

### POST /orbis/select-option

Choose an option in a `<select>` element.

| Body field | Required | Description |
| :--- | :--- | :--- |
| `target` | yes | Any [locator](./locators.md) of the `<select>`. |
| `value` | yes | The option's value or visible text. |
| `id` | no | Page id (or `?id=`). |

```bash
curl -s -X POST http://localhost:9222/orbis/select-option \
  -H "Content-Type: application/json" \
  -d '{"target":"label:Country","value":"India"}'
```

Response `200`: `{"success":true,"url":"...","snapshot":{...}}`. When the select or the option is not found, the response is `404` with `"success": false`. Errors: `400 {"error":"Expected \"target\" and \"value\""}`, `404 Page not found`. The Python SDK's `select_option()` uses this endpoint.

### GET /orbis/session and POST /orbis/session

`GET` returns the page's session state:

```bash
curl -s http://localhost:9222/orbis/session
```

```json
{
  "version": 1,
  "createdAt": "2026-10-30T19:26:05.355Z",
  "url": "http://127.0.0.1:18091/done?user=bob",
  "cookies": {},
  "cookieList": [],
  "localStorage": {},
  "sessionStorage": {}
}
```

`cookieList` holds each cookie with its site (domain, path and flags). Older session files without it still load: their `cookies` map is applied to the site in the file's `url`.

`POST` restores state into the page, from a file **on the server** or from an inline object:

```bash
# From a file in the server's session folder
curl -s -X POST http://localhost:9222/orbis/session \
  -H "Content-Type: application/json" \
  -d '{"filePath":"app.json"}'

# Inline (recommended: keeps files off the server)
curl -s -X POST http://localhost:9222/orbis/session \
  -H "Content-Type: application/json" \
  -d '{"session":{"version":1,"createdAt":"2026-10-30T19:26:05.355Z","url":"https://app.example.com/","cookies":{"sid":"..."},"localStorage":{},"sessionStorage":{}}}'
```

Response `200`: `{"success":true,"url":"<current page url>"}`. Restoring merges cookies into the jar and replaces storage; it does **not** navigate (the `url` in the body is ignored, and the response reports the page's current URL). Call `/orbis/goto` afterwards.

Errors (all `400`): `{"error":"Expected \"filePath\" or \"session\" in request body"}`, `{"error":"Session file not found: <path>"}`, `{"error":"Unsupported session version: ..."}`, `{"error":"Invalid session: missing ..."}`, or a JSON parse error for a malformed file. A path outside the session folder, or one that does not end in `.json`, returns `403` (`ERR_SESSION_PATH`). Page selection: `?id=` only.

The response body of `GET` contains authentication cookies in clear text. See [sessions-and-auth.md](./sessions-and-auth.md).

### POST /orbis/session/save

Write the page's session to a file **on the server**.

```bash
curl -s -X POST http://localhost:9222/orbis/session/save \
  -H "Content-Type: application/json" \
  -d '{"filePath":"app.json"}'
```

Response `200`: `{"success":true,"filePath":"app.json"}`. Parent directories are created. Errors: `400 {"error":"Missing \"filePath\""}`, `403` (`ERR_SESSION_PATH`) for a path outside the session folder or not ending in `.json`, `404 Page not found`.

Session files can only be read and written inside the folder the server was started in, or inside `ORBIS_SESSION_DIR` if it is set. Relative paths are resolved against that folder. To keep files off the server entirely, use `GET /orbis/session` and an inline restore.

---

## CDP discovery endpoints

These mirror Chrome's `/json` endpoints so CDP clients can discover the server. See [playwright-puppeteer.md](./playwright-puppeteer.md).

| Endpoint | Method | Response |
| :--- | :--- | :--- |
| `/json/version` | any | Browser identity and the browser WebSocket URL. Use it as the **health check**. |
| `/json/list`, `/json` | any | Array of page targets. |
| `/json/new` | any | Creates a page and returns its target. Without a URL the page is `about:blank`. With `/json/new?<url>` or `/json/new?url=<encoded url>` (GET or PUT, as in Chrome), the new page opens that URL and the returned target shows its `url` and `title`. |
| `/json/close/<id>` | any | Closes the page. `{"success":true}`, or `{"success":false}` for an unknown id (still `200`). |

`/json/version` response (abridged):

```json
{
  "Browser": "Chrome/130.0.0.0",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  "V8-Version": "12.8.0",
  "WebKit-Version": "537.36",
  "product": "Orbis/0.2.0",
  "engine": "Memora Browser Engine (MBE)",
  "website": "https://orbis.memora.company",
  "company": "https://memora.company",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/memora-root"
}
```

The `Browser`/`V8-Version` fields are a compatibility identity for CDP clients; Orbis does not run Chrome. Check `product` to detect Orbis.

Target object (from `/json/list` or `/json/new`):

```json
{
  "description": "",
  "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:19340/devtools/page/0e220c65-8d0f-418b-b24c-49cafb106e3e",
  "id": "0e220c65-8d0f-418b-b24c-49cafb106e3e",
  "title": "Memora Empty Page",
  "type": "page",
  "url": "about:blank",
  "webSocketDebuggerUrl": "ws://localhost:19340/devtools/page/0e220c65-8d0f-418b-b24c-49cafb106e3e"
}
```

Use these ids as `?id=` / `"id"` on the agent endpoints to work on a page other than the default one. Forked pages (`agent.fork()`) are not listed. The `devtoolsFrontendUrl` is informational: there is no DevTools UI.

Health check examples:

```bash
curl -fsS http://localhost:9222/json/version > /dev/null && echo up
```

```yaml
# Kubernetes probe
livenessProbe:
  httpGet: { path: /json/version, port: 9222 }
  periodSeconds: 15
```

---

## WebSocket endpoints

| URL | Purpose |
| :--- | :--- |
| `ws://<host>:<port>/devtools/browser/<anything>` | Browser-level CDP connection (`.../memora-root` is what `/json/version` advertises). Commands without a `sessionId` go to the default page. |
| `ws://<host>:<port>/devtools/page/<id>` | Page-level CDP connection. Unknown ids fall back to the default page. |

Upgrade requests to any other path are rejected. Supported CDP domains are listed in [playwright-puppeteer.md](./playwright-puppeteer.md). Set `DEBUG_CDP=1` to log traffic ([cli-reference.md](./cli-reference.md#environment-variables)).

---

## End-to-end examples

### Shell: log in and read a dashboard

```bash
BASE=http://localhost:9222
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }

curl -s "$BASE/orbis/goto?url=$(enc https://app.example.com/login)" | jq -r .snapshot.actionMapText

curl -s -X POST "$BASE/orbis/fill-form" -H 'Content-Type: application/json' \
  -d "{\"fields\":{\"label:Email\":\"$APP_USER\",\"label:Password\":\"$APP_PASS\"},\"submit\":\"text=Sign in\"}" \
  | jq '{submitted, skipped, url, title}'

curl -s "$BASE/orbis/goto?url=$(enc https://app.example.com/reports)" > /dev/null
curl -s "$BASE/orbis/snapshot?format=markdown&focus=main"
```

### Node.js (any HTTP client)

```js
const BASE = 'http://localhost:9222';
const post = (path, body) =>
  fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json());

const nav = await fetch(`${BASE}/orbis/goto?url=${encodeURIComponent('https://example.com/search')}`).then(r => r.json());
if (nav.error) throw new Error(nav.error);
await post('/orbis/fill-form', { fields: { 'input[name="q"]': 'orbis' }, submit: true });
const { diff } = await fetch(`${BASE}/orbis/diff`).then(r => r.json());
console.log(diff.summary);
```

### Python (without the SDK)

```python
import json, urllib.parse, urllib.request

BASE = "http://localhost:9222"

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.load(r)

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

snap = get("/orbis/goto?url=" + urllib.parse.quote("https://example.com", safe=""))["snapshot"]
print(snap["actionMapText"])
print(post("/orbis/act", {"actionId": "@1"})["success"])
```

Use a client timeout of at least 30 s for `/orbis/goto` and `/orbis/fill-form`: a navigation may take up to 20 s (or the server's `--http-timeout`) plus the settle phase. The [Python SDK](./python-sdk.md) wraps these calls.

---

## Endpoints that do not exist

These are referenced in older material or expected by analogy, but return `404 {"error":"Not found"}` (or `405` for a wrong method on a path that exists):

| Path | Use instead |
| :--- | :--- |
| `/orbis/markdown` | `GET /orbis/snapshot?format=markdown` |
| `/orbis/back`, `/orbis/reload`, `/orbis/eval`, `/orbis/extract`, `/orbis/metadata` | Not available over REST. Use CDP, the TypeScript SDK, or the MCP tools ([mcp.md](./mcp.md)). |
| `/json/activate/<id>`, `/json/protocol` | Not implemented. |
| `GET /orbis/act`, `GET /orbis/fill-form` | These endpoints are POST-only. A `GET` returns `405` with `Allow: POST`. |

---

## Known issues

There are no REST-specific known issues in 0.2.0.

> **Changed in 0.2.0:** a wrong HTTP method now gets `405` with an `Allow` header. In 0.1.x, POST-only paths answered `404`, and a method other than GET or POST on `/orbis/session` never got a response. `/json/new?url=` also used to be ignored.

See also: [python-sdk.md](./python-sdk.md), [typescript-sdk.md](./typescript-sdk.md), [troubleshooting.md](./troubleshooting.md).
