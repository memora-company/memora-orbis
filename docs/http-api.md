# HTTP API Reference

Every Orbis CDP server (started with `orbis`, `orbis serve`, or `OrbisAgent.launch()`) also exposes a small JSON-over-HTTP API next to the Chrome DevTools Protocol WebSocket. The **agent endpoints** (`/orbis/*`) let any language navigate, read the action map, click, type, fill forms, diff and manage sessions with plain HTTP calls; the Python SDK is a thin client over them. The **discovery endpoints** (`/json/*`) are the standard Chrome endpoints that Playwright, Puppeteer and other CDP clients call. This page documents every endpoint, parameter, response and status code, with responses captured from a running 0.1.0 server.

Applies to: Orbis 0.1.1 (`@memoracompany/orbis` on npm, `memora-orbis` on PyPI)

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
  - [GET /orbis/session and POST /orbis/session](#get-orbissession-and-post-orbissession)
  - [POST /orbis/session/save](#post-orbissessionsave)
- [CDP discovery endpoints](#cdp-discovery-endpoints)
- [WebSocket endpoints](#websocket-endpoints)
- [End-to-end examples](#end-to-end-examples)
- [Endpoints that do not exist](#endpoints-that-do-not-exist)
- [Known issues](#known-issues)

---

## Before you start: security

> **Known issue (0.1.0):** the HTTP API and the CDP WebSocket have **no authentication**. An API key configured with `ORBIS_API_KEY`, `MEMORA_API_KEY` or `apiKey` is stored but never checked, so every request is accepted. In addition, `--host localhost` (the default) and `--host 127.0.0.1` bind to `0.0.0.0` (all interfaces), every response carries `Access-Control-Allow-Origin: *`, and the session endpoints read and write **arbitrary file paths on the server**.
>
> Treat the port as full remote control of the process: never expose it to the internet or an untrusted network. Run it on a private network, inside a container network, or behind a reverse proxy that authenticates requests. See [security.md](./security.md) and [production-deployment.md](./production-deployment.md).

---

## Base URL, conventions and errors

```text
http://<host>:<port>          default http://localhost:9222
```

- Every agent path has an alias under `/memora/` (`/memora/snapshot` = `/orbis/snapshot`, etc.). Use `/orbis/`.
- Trailing slashes are ignored.
- Request bodies are JSON. The `Content-Type` header is not checked, but send `application/json`.
- Responses are JSON (`Content-Type: application/json`) except `GET /orbis/snapshot?format=markdown` (`text/markdown; charset=utf-8`).
- CORS: every response has `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`. `OPTIONS` on any path returns `204`. This means any web page open in a browser on a machine that can reach the server can call the API.
- Navigation (`/orbis/goto`, form submission) is asynchronous; snapshot, diff, act and session calls are synchronous computations on the in-memory DOM. Concurrent requests against the **same page** are not serialized for you; send one request at a time per page.

Error format and status codes:

| Status | Body | When |
| :--- | :--- | :--- |
| `200` | endpoint-specific | Success. Note that `success: false` inside a 200 response means "element not found" for `/orbis/act`. |
| `400` | `{"error":"Invalid JSON body: ..."}` | Body is not valid JSON. |
| `400` | `{"error":"Missing ..."}` | Required field missing (see each endpoint). |
| `404` | `{"error":"Page not found"}` | `?id=` / `"id"` does not match an open page. |
| `404` | `{"error":"Not found"}` | Unknown path **or wrong HTTP method** (e.g. `GET /orbis/act`). |
| `409` | `{"error":"# CHALLENGE DETECTED ...","code":"ERR_CHALLENGE_DETECTED","challenge":{...},"cooldownSec":60}` | Unreleased. The page is a CAPTCHA / bot check / block page / 429 and the daemon runs with `--on-challenge stop`. `/orbis/goto` and `/orbis/fill-form`. |
| `429` | `{"error":"Requests to <host> are paused ...","code":"ERR_CHALLENGE_COOLDOWN","host":"...","remainingSec":42,"challenge":{...}}`, header `Retry-After: <remainingSec>` | Unreleased. The host is in cooldown after a challenge. `/orbis/goto` and `/orbis/fill-form`. |
| `500` | `{"error":"Error: Request to ... failed: ..."}` | Navigation failed (DNS, TLS, timeout, robots.txt block) or form fill threw. |

HTTP errors of the *target website* (404, 500) are not errors of the API: `/orbis/goto` returns `200` with `"status": 404` in the body.

In unreleased builds, `/orbis/goto`, `/orbis/fill-form` and the JSON form of `/orbis/snapshot` also return a `challenge` field: `null`, or the CAPTCHA / bot-check signal of the last navigation (`kind`, `vendor`, `blocking`, `confidence`, `evidence`, `url`, `status`, `retryAfterSec`). When `challenge.blocking` is `true`, the snapshot is the challenge page, not the real page. See [challenges.md](./challenges.md).

---

## Which page does an endpoint use?

A server can hold many pages (tabs), created by `OrbisAgent.launch()`, by Playwright/Puppeteer over CDP, or by `/json/new`. Each has an `id` (a UUID, listed by `/json/list`).

| Endpoint | Page used |
| :--- | :--- |
| `/orbis/goto` | **Always** the default page. `id` is not supported. |
| `/orbis/snapshot`, `/orbis/diff`, `GET`/`POST /orbis/session` | `?id=<page id>` query parameter, otherwise the default page. |
| `/orbis/act`, `/orbis/fill-form`, `/orbis/session/save` | `"id"` in the JSON body or `?id=` in the query, otherwise the default page. |

The **default page** is the oldest page that is still open; if none is open, a new blank page is created on the fly. With `OrbisAgent.launch()` it is the agent's own page (`agent.page`).

Because all clients that omit `id` share the default page, **one REST client per server** is the safe production pattern. Running several agents against one daemon makes them navigate and click on the same page and see each other's cookies. The Python SDK never sends `id`. See [production-deployment.md](./production-deployment.md) for scaling patterns.

---

## Agent endpoints

### GET /orbis/goto

Navigate the default page and return the new snapshot.

| Parameter | In | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | query | yes | Absolute URL (URL-encode it). Relative URLs are resolved against the page's current URL. |

Any HTTP method is accepted. Navigation follows redirects, runs scripts and waits up to 5 s for the page to settle; it times out after 20 s.

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

Unreleased builds add `"challenge"` (signal or `null`) and `"challengeCooldownSec"` (seconds the host is now paused, `0` if none) next to `status`. They can also return `409` (stop mode) and `429` (host in cooldown); see the error table above.

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

Use `@n` IDs from an unfocused snapshot only; IDs from a `focus`/`exclude` snapshot are not valid for `/orbis/act` (see [locators.md](./locators.md#action-ids-n)). The `format=markdown` variant does not update the diff baseline; the JSON variant does.

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

Typing sets the value and fires `input` and `change`. Clicking **dispatches a click event only**: it does **not** follow links or submit forms (same as `agent.act()` in the SDK). To follow a link, call `/orbis/goto` with its `href` (available in `snapshot.actions[n].href`). To submit a form, use `/orbis/fill-form` with `submit`, which performs a real click.

```bash
# Type
curl -s -X POST http://localhost:9222/orbis/act \
  -H "Content-Type: application/json" \
  -d '{"actionId":"placeholder:User","type":"type","text":"ada"}'

# Click (fires JS click handlers)
curl -s -X POST http://localhost:9222/orbis/act \
  -H "Content-Type: application/json" \
  -d '{"actionId":"@2"}'
```

Response `200`:

```json
{
  "success": true,
  "snapshot": { "...": "snapshot after the action (value now shows \"ada\")" }
}
```

`success: false` means the locator did not resolve; the request still returns `200`. Errors: `400 {"error":"Missing actionId or target"}`, `404 Page not found`.

### POST /orbis/fill-form

Fill several fields in one call and, **by default, submit the form**.

| Body field | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `fields` | yes | | Object mapping [locators](./locators.md) to string values. Checkboxes: `"true"`/`"1"`/`"yes"`/`"checked"`/`"on"` check, anything else unchecks. |
| `submit` | no | **`true`** | `true`: submit the form of the first filled field. `false`: only fill. A locator string: real click on that element (follows links, submits). |
| `submitActionId` | no | | Used when `submit` is absent. |
| `steps` | no | | Array of `{ fields, submit }` objects executed in order (multi-step wizard). When present, top-level `fields` is still required by validation but ignored. |
| `id` | no | | Page id (or `?id=`). |

```bash
# Fill and submit (default)
curl -s -X POST http://localhost:9222/orbis/fill-form \
  -H "Content-Type: application/json" \
  -d '{"fields":{"placeholder:User":"bob"}}'

# Fill only, do not submit
curl -s -X POST http://localhost:9222/orbis/fill-form \
  -H "Content-Type: application/json" \
  -d '{"fields":{"label:Email":"ada@example.com","input[name=\"terms\"]":"true"},"submit":false}'

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

`success` is always `true`; check `skipped` (locators that did not resolve) and `submitted`. Errors: `400 {"error":"Missing or invalid \"fields\" object"}`, `404 Page not found`, `500 {"error":"..."}` if submission navigation failed.

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
  "localStorage": {},
  "sessionStorage": {}
}
```

`POST` restores state into the page, from a file path **on the server** or from an inline object:

```bash
# From a file on the server's filesystem
curl -s -X POST http://localhost:9222/orbis/session \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/data/sessions/app.json"}'

# Inline (recommended: keeps files off the server)
curl -s -X POST http://localhost:9222/orbis/session \
  -H "Content-Type: application/json" \
  -d '{"session":{"version":1,"createdAt":"2026-10-30T19:26:05.355Z","url":"https://app.example.com/","cookies":{"sid":"..."},"localStorage":{},"sessionStorage":{}}}'
```

Response `200`: `{"success":true,"url":"<current page url>"}`. Restoring merges cookies into the jar and replaces storage; it does **not** navigate (the `url` in the body is ignored, and the response reports the page's current URL). Call `/orbis/goto` afterwards.

Errors (all `400`): `{"error":"Expected \"filePath\" or \"session\" in request body"}`, `{"error":"Session file not found: <path>"}`, `{"error":"Unsupported session version: ..."}`, `{"error":"Invalid session: missing ..."}`, or a JSON parse error for a malformed file. Page selection: `?id=` only.

The response body of `GET` contains authentication cookies in clear text. See [sessions-and-auth.md](./sessions-and-auth.md).

### POST /orbis/session/save

Write the page's session to a file **on the server**.

```bash
curl -s -X POST http://localhost:9222/orbis/session/save \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/data/sessions/app.json"}'
```

Response `200`: `{"success":true,"filePath":"/data/sessions/app.json"}`. Parent directories are created. Errors: `400 {"error":"Missing \"filePath\""}`, `404 Page not found`.

Paths are not restricted: any client can write a file anywhere the server process has permission (and read any JSON file through `POST /orbis/session`). Run the server as an unprivileged user with a read-only filesystem except for a dedicated sessions directory, or prefer `GET /orbis/session` + inline restore so that no files are written at all.

---

## CDP discovery endpoints

These mirror Chrome's `/json` endpoints so CDP clients can discover the server. See [playwright-puppeteer.md](./playwright-puppeteer.md).

| Endpoint | Method | Response |
| :--- | :--- | :--- |
| `/json/version` | any | Browser identity and the browser WebSocket URL. Use it as the **health check**. |
| `/json/list`, `/json` | any | Array of page targets. |
| `/json/new` | any | Creates a blank page and returns its target. The `?url=` parameter supported by Chrome is **ignored** (the page stays `about:blank`; navigate it afterwards). |
| `/json/close/<id>` | any | Closes the page. `{"success":true}`, or `{"success":false}` for an unknown id (still `200`). |

`/json/version` response (abridged):

```json
{
  "Browser": "Chrome/130.0.0.0",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  "V8-Version": "12.8.0",
  "WebKit-Version": "537.36",
  "product": "Orbis/0.1.0",
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

Use a client timeout of at least 30 s for `/orbis/goto` and `/orbis/fill-form`: a navigation may take up to 20 s plus the settle phase. The [Python SDK](./python-sdk.md) wraps these calls.

---

## Endpoints that do not exist

These are referenced in older material or expected by analogy, but return `404 {"error":"Not found"}` in 0.1.0:

| Path | Use instead |
| :--- | :--- |
| `POST /orbis/select-option` | `POST /orbis/act` with `{"actionId":"#country","type":"type","text":"India"}` (typing into a `<select>` selects the matching option by value or text), or `/orbis/fill-form` with the option's exact value/text. The Python SDK's `select_option()` calls this missing endpoint and fails with HTTP 404. |
| `/orbis/markdown` | `GET /orbis/snapshot?format=markdown` |
| `/orbis/back`, `/orbis/reload`, `/orbis/eval`, `/orbis/extract`, `/orbis/metadata` | Not available over REST. Use CDP, the TypeScript SDK, or the MCP tools ([mcp.md](./mcp.md)). |
| `/json/activate/<id>`, `/json/protocol` | Not implemented. |
| `GET /orbis/act`, `GET /orbis/fill-form` | These endpoints are POST-only. |

---

## Known issues

| Issue | Impact | Workaround |
| :--- | :--- | :--- |
| No authentication; API key ignored | Anyone who can reach the port controls the browser | Network isolation or an authenticating reverse proxy ([security.md](./security.md)) |
| `localhost` binds `0.0.0.0` | Port reachable from the network | Firewall, container network, or `--host ::1` / a specific interface IP |
| Session endpoints accept arbitrary server paths | Arbitrary JSON file write/read by any client | Unprivileged user, read-only filesystem, inline sessions |
| `/orbis/act` click does not navigate | Links and submit buttons appear to "do nothing" | `/orbis/goto` with `href`, or `/orbis/fill-form` with `submit` |
| `/orbis/fill-form` submits by default | Unintended submissions | Send `"submit": false` |
| `/orbis/goto` ignores `id` | Cannot navigate secondary tabs over REST | Use CDP, or one server per agent |
| A method other than GET/POST on `/orbis/session` never gets a response | Client hangs until its timeout | Use GET or POST only; always set client timeouts |
| `/json/new?url=` ignored | New tab stays blank | Navigate after creating it |

See also: [python-sdk.md](./python-sdk.md), [typescript-sdk.md](./typescript-sdk.md), [troubleshooting.md](./troubleshooting.md).
