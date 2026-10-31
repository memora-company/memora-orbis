# Python SDK Reference

The Python SDK (`memora-orbis` on PyPI) is a small HTTP client for a running Orbis daemon. It does not contain a browser engine. Every method sends one HTTP request to the daemon's agent REST API (`/orbis/*`, see [http-api.md](./http-api.md)), and the daemon does the work. This page documents every public class and method, what each one sends and returns, and the operational details you need before you use it in production.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [How the SDK works](#how-the-sdk-works)
- [Installation](#installation)
- [Starting the daemon](#starting-the-daemon)
- [Quick start](#quick-start)
- [API reference](#api-reference)
  - [OrbisAgent](#orbisagent)
  - [OrbisSnapshot](#orbissnapshot)
- [Return value shapes](#return-value-shapes)
- [Error handling](#error-handling)
- [Timeouts](#timeouts)
- [Concurrency, threads and asyncio](#concurrency-threads-and-asyncio)
- [End-to-end examples](#end-to-end-examples)
- [Production checklist](#production-checklist)
- [Known issues](#known-issues)

---

## How the SDK works

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   HTTP (JSON)    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ your Python process  â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¶ â”‚ Orbis daemon (Node.js)         â”‚
â”‚ orbis.OrbisAgent     â”‚ â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚ `orbis --port 9222`            â”‚
â”‚ (urllib, no deps)    â”‚                  â”‚ one shared "default page"      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Key facts, all taken from `python/orbis/agent.py` and `src/cdp/server.ts`:

| Fact | Consequence |
| :--- | :--- |
| The SDK has no third-party dependencies. It uses only `urllib`, `json` and `os` from the standard library. | Works on any Python 3.9+ install. Optional integrations (LangChain, Browser-Use) need their own packages. |
| Every call is a blocking HTTP request. | Calls block the calling thread. Use threads or `asyncio.to_thread` for concurrency (see below). |
| All REST endpoints operate on the daemon's **default page**, which is the first page the daemon created. | Two agents talking to the same daemon share one page, one cookie jar and one history. Run one daemon per concurrent agent. |
| The daemon keeps all state (DOM, cookies, storage). | Nothing is lost if your Python process restarts. All of it is lost if the daemon restarts, unless you saved a session. |
| File paths passed to `save_session` / `load_session` are resolved **on the daemon's machine**. | In Docker or on a remote host, the file is written inside the daemon's container or host, not next to your script. |

## Installation

```bash
pip install memora-orbis
```

Requirements: Python 3.9 or later. The SDK itself needs nothing else.

Optional extras, installed separately:

```bash
pip install langchain        # for OrbisAgent.to_langchain_tools()
pip install browser-use      # for Browser-Use integration (see integrations.md)
```

The import name is `orbis`:

```python
from orbis import OrbisAgent, OrbisSnapshot
```

## Starting the daemon

The SDK needs an Orbis daemon running in CDP mode (the default protocol). Node.js 20 or later is required for the daemon.

```bash
npx -y @memoracompany/memora-orbis --port 9222
```

Or, after a global install:

```bash
npm install -g @memoracompany/memora-orbis
orbis --port 9222
```

Check that it is up:

```bash
curl http://localhost:9222/json/version
```

See [cli-reference.md](./cli-reference.md) for every flag, and [production-deployment.md](./production-deployment.md) for running the daemon under Docker, systemd or Kubernetes.

> The daemon must run with `--protocol cdp` (the default). A daemon started with `--protocol webdriver` does not serve the `/orbis/*` endpoints, and every SDK call will fail with HTTP 404.

## Quick start

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")

snap = agent.goto("https://news.ycombinator.com")
print(snap.title, snap.interactive_count, snap.token_estimate)
print(snap.action_map_text[:1000])   # numbered actions: [@1] [link] "..." ...

result = agent.act("@1")              # click the first interactive element
print(result["success"])

delta = agent.diff()
print(delta["diff"]["summary"])       # what changed since the last snapshot
```

---

## API reference

### OrbisAgent

```python
class OrbisAgent:
    def __init__(self, base_url: str = "http://localhost:9222", api_key: Optional[str] = None)
```

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `base_url` | `str` | `"http://localhost:9222"` | Daemon origin. A trailing `/` is stripped. Use the HTTP origin, not the `ws://` URL. |
| `api_key` | `str \| None` | `None` | Sent as both `x-api-key: <key>` and `Authorization: Bearer <key>` on every request. If omitted, falls back to the `ORBIS_API_KEY` environment variable, then `MEMORA_API_KEY`. |

The constructor does not contact the daemon. Use `connect()` to check that the daemon is reachable.

> **Known issue (0.1.0):** The daemon does not check the API key. `CDPServer` reads it but never calls its authorization check, so every request is accepted with or without a key. Sending a key is harmless and keeps your code ready for a fixed release. Do not rely on it for security. See [security.md](./security.md).

#### `OrbisAgent.connect(base_url="http://localhost:9222", api_key=None)` (classmethod)

Creates an agent and calls `GET /json/version` with a 5-second timeout to check the daemon is reachable.

- **Returns:** `OrbisAgent`
- **Raises:** `urllib.error.URLError` if nothing is listening (for example `ConnectionRefusedError`), `socket.timeout` / `TimeoutError` after 5 s, `ConnectionError` if the daemon answers with a non-200 status.

```python
agent = OrbisAgent.connect("http://orbis.internal:9222", api_key="...")
```

#### `goto(url: str) -> OrbisSnapshot`

Navigates the daemon's default page to `url` and returns the semantic snapshot of the loaded page.

- **HTTP:** `GET /orbis/goto?url=<url>`
- **Behaviour on the daemon:** fetches the URL (following redirects), parses the HTML, runs the page's scripts, waits up to 5 s for the page's async work (fetch/XHR, short timers) to settle, then builds the snapshot. Navigation timeout is 20 s on the daemon.
- **Returns:** an [`OrbisSnapshot`](#orbissnapshot).
- **Raises:** `urllib.error.HTTPError` with status 500 if navigation fails (DNS error, timeout, blocked by `--obey-robots`, etc.). The response body contains `{"error": "..."}`.
- **Challenges (unreleased):** if the page is a CAPTCHA, bot check, block page or 429, `snap.challenge` describes it and `snap.blocked` is `True`. With a daemon started with `--on-challenge stop` it raises `ChallengeDetectedError` (HTTP 409) instead. While the host is in cooldown it raises `ChallengeCooldownError` (HTTP 429). Both are subclasses of `urllib.error.HTTPError`. See [challenges.md](./challenges.md).

The HTTP status of the target page is not exposed. The daemon returns it as a top-level `status` field, but `goto()` keeps only the nested `snapshot` object. A 404 or 500 page from the target site still produces a snapshot. If the status matters, call `agent._get("/orbis/goto", {"url": url})` and read `["status"]`.

```python
snap = agent.goto("https://example.com/pricing")
```

#### `snapshot(focus_selector=None, exclude_selectors=None) -> OrbisSnapshot`

Returns a fresh snapshot of the current page without navigating.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `focus_selector` | `str \| None` | CSS selector. Only that subtree is distilled (for example `"main"`, `"#content"`). If it matches nothing, the whole document is used. |
| `exclude_selectors` | `list[str] \| None` | CSS selectors whose subtrees are dropped (for example `["nav", "footer", ".cookie-banner"]`). Sent comma-joined, so selectors that themselves contain a comma are not supported. |

- **HTTP:** `GET /orbis/snapshot?focus=...&exclude=...`
- **Returns:** `OrbisSnapshot`

> **Important:** action IDs in a *focused* snapshot are numbered from `@1` inside the focused subtree, but `act()` resolves `@N` against the **whole** page. Do not pass `@N` values taken from a focused snapshot to `act()` or `fill_form()`. Use the `selector` field from `snap.actions` instead. See [locators.md](./locators.md).

```python
snap = agent.snapshot(focus_selector="main", exclude_selectors=["aside", ".ads"])
for a in snap.actions:
    print(a["selector"], a["role"], a["text"])
```

#### `markdown() -> str`

Returns the current page as clean Markdown (scripts, styles, hidden elements removed).

- **HTTP:** `GET /orbis/snapshot?format=markdown` (10-second client timeout)
- **Returns:** `str`. Focus and exclude filters are not available through this method. Use `snapshot(...).markdown` for filtered Markdown.

#### `diff() -> dict`

Compares the current page with the previous snapshot taken on the daemon's default page and returns what changed.

- **HTTP:** `GET /orbis/diff`
- **Returns:** `{"diff": PageDiff, "currentSnapshot": SemanticPageSnapshot}`. The shapes are listed in [Return value shapes](#return-value-shapes).
- Every snapshot the daemon takes (including the one inside `goto`, `act` and `fill_form`) becomes the new baseline. `diff()` itself also takes a snapshot, so calling it twice in a row returns "No visual, DOM, or interactive changes detected." the second time.
- Elements are matched by their generated CSS `selector`, not by action ID.

```python
d = agent.diff()["diff"]
if d["urlChanged"]:
    print("navigated to", d["currentUrl"])
for added in d["addedActions"]:
    print("+", added["actionId"], added["text"])
```

#### `act(action_id: str, text: Optional[str] = None) -> dict`

Clicks an element, or types into it when `text` is given.

| Parameter | Description |
| :--- | :--- |
| `action_id` | Any locator: `@3`, `@email`, `text=Sign in`, `label:Email`, `placeholder:Search`, `testid:submit`, `role:button[name="Save"]`, XPath (`//button`), CSS (`#id`). See [locators.md](./locators.md). |
| `text` | If provided, the value is set on the element and `input` and `change` events are dispatched. If the target is a `<select>`, the matching option is selected instead (value first, then exact visible text, then partial text). |

- **HTTP:** `POST /orbis/act` with `{"actionId": ..., "type": "click"|"type", "text": ...}`
- **Returns:** `{"success": bool, "snapshot": SemanticPageSnapshot}`. `success` is `False` when the locator matched nothing. It does not raise.

> **Known issue (0.1.0):** A click through `act()` dispatches a DOM `click` event only. It does **not** perform the browser's default action: it does not follow `<a href>` links and does not submit forms. Page JavaScript that listens for `click` still runs. To follow a link, call `goto()` with the link's `href` (available in `snap.actions[i]["href"]`). To submit a form, use `fill_form(..., submit=...)`, which does perform real submission. The MCP tool `memora_act` and the TypeScript `page.activate()` do perform default actions.

```python
agent.act("label:Email", "ops@example.com")
agent.act("@7")                         # click

# Follow a link reliably
link = next(a for a in agent.snapshot().actions if a["text"] == "Pricing")
agent.goto(link["href"])                # relative hrefs are resolved against the current page
```

#### `select_option(target: str, value_or_text: str) -> dict`

Intended to select a dropdown option.

> **Known issue (0.1.0):** This method posts to `/orbis/select-option`, an endpoint the daemon does not implement. It always raises `urllib.error.HTTPError: HTTP Error 404: Not Found` (verified against the 0.1.0 build). Use `act(target, option)` instead. When the target is a native `<select>`, typing delegates to option selection:
>
> ```python
> agent.act("label:Country", "India")      # selects the <option> whose value or text matches "India"
> agent.act("#country", "IN")              # match on the option value also works
> ```
>
> `fill_form({"label:Country": "India"}, submit=False)` also works. It matches the option `value` exactly, then the exact visible text.

#### `fill_form(fields: dict[str, str], submit: bool = True) -> dict`

Fills several fields in one request and, by default, submits the form.

| Parameter | Description |
| :--- | :--- |
| `fields` | Mapping of locator to value. Locators can be any format from [locators.md](./locators.md). Checkboxes and radios are checked when the value is one of `"true"`, `"1"`, `"yes"`, `"checked"`, `"on"`, and unchecked otherwise. `<select>` elements match the option value, then the exact text. `contenteditable` elements get their text replaced. |
| `submit` | **Defaults to `True`.** `True` submits the form that contains the first filled field (or the first form on the page). `False` fills only. The REST endpoint also accepts a locator string for the button to click, but the Python signature is typed `bool`. Passing a string works at runtime. |

- **HTTP:** `POST /orbis/fill-form` with `{"fields": {...}, "submit": ...}`
- **Returns:** `{"success": true, "filled": [...], "skipped": [...], "fieldsFilled": int, "submitted": bool, "url": str, "title": str, "snapshot": SemanticPageSnapshot}`
- Locators that match nothing are listed in `skipped`. They do not raise. Always check `skipped` in production code.
- Submission performs a real form submission: GET forms navigate with a query string, POST forms send `application/x-www-form-urlencoded`. A page script that calls `event.preventDefault()` on `submit` stops the navigation. File inputs are never submitted.

```python
res = agent.fill_form(
    {"label:Email": "ops@example.com", "label:Password": "test-only-password"},
    submit="text=Sign in",   # click this button instead of auto-submitting
)
if res["skipped"]:
    raise RuntimeError(f"fields not found: {res['skipped']}")
```

> Do not put real production credentials in source code. Load them from a secret store at runtime. See [sessions-and-auth.md](./sessions-and-auth.md).

#### `save_session(file_path: str) -> dict`

Writes the default page's cookies, `localStorage` and `sessionStorage` to a JSON file **on the daemon's filesystem**. Parent directories are created.

- **HTTP:** `POST /orbis/session/save` with `{"filePath": ...}`
- **Returns:** `{"success": true, "filePath": "..."}`

The file contains session cookies in plain text. Treat it as a secret (file permissions, encrypted volume, never commit it).

#### `load_session(file_path: str) -> dict`

Restores a session file **from the daemon's filesystem** into the default page. It does not navigate. Call `goto()` afterwards.

- **HTTP:** `POST /orbis/session` with `{"filePath": ...}`
- **Returns:** `{"success": true, "url": "<current page url>"}`
- **Raises:** `HTTPError 400` if the file is missing or not a valid version-1 session.

If the daemon runs elsewhere, restore by value through the REST API instead of by path. Send `{"session": {...}}` to `POST /orbis/session`. The SDK has no method for this, so call it directly (see the [session vault example](#3-session-vault-that-works-with-a-remote-daemon)).

#### `to_browser_use() -> dict`

Returns `{"cdp_url": base_url, "disable_security": True}` for Browser-Use style configuration. Browser-Use's own API changes between versions, so map these values onto whatever your Browser-Use version expects. See [integrations.md](./integrations.md#browser-use) for the limits of running Browser-Use on Orbis.

#### `to_langchain_tools() -> list`

Returns three LangChain tools built with `langchain.tools.tool`:

| Tool | Arguments | Returns |
| :--- | :--- | :--- |
| `orbis_navigate` | `url: str` | Action map plus the first 4,000 characters of Markdown. |
| `orbis_act` | `action_id: str, text: Optional[str]` | `success` plus the diff summary. |
| `orbis_diff` | none | Diff summary. |

- **Raises:** `ImportError` if `langchain` is not installed.
- There is no form-filling tool in the Python set. The TypeScript set has five tools. See [integrations.md](./integrations.md#langchain).

#### Methods that do not exist

There is no `close()`, `fork()`, `extract()`, `evaluate()` or `back()` in the Python SDK. Pages live on the daemon until it restarts. To drop the current document, navigate to a data URL such as `agent.goto("data:text/html,<title>idle</title>")`. Navigating to `about:blank` fails with "about scheme is not supported". Cookies persist on the page until you restart the daemon. For extraction and JavaScript evaluation, use the MCP server ([mcp.md](./mcp.md)) or the TypeScript SDK ([typescript-sdk.md](./typescript-sdk.md)).

### OrbisSnapshot

A thin wrapper around the snapshot JSON.

| Attribute | Type | Source field | Description |
| :--- | :--- | :--- | :--- |
| `raw` | `dict` | whole object | Full JSON as returned by the daemon. |
| `url` | `str` | `url` | Final URL after redirects. |
| `title` | `str` | `title` | Document title (`"Untitled Page"` if empty). |
| `markdown` | `str` | `markdown` | Distilled Markdown of the page (full length, not truncated). |
| `action_map_text` | `str` | `actionMapText` | LLM-ready numbered action list. |
| `actions` | `list[dict]` | `actions` | One dict per interactive element (see below). |
| `token_estimate` | `int` | `tokenEstimate` | `ceil(len(title + actionMapText + markdown) / 4)`. A rough character-based estimate, not a tokenizer count. |
| `interactive_count` | `int` | `interactiveCount` | Number of entries in `actions`. |
| `challenge` | `dict \| None` | `challenge` | CAPTCHA / bot-check / rate-limit signal of the last navigation (`kind`, `vendor`, `blocking`, `confidence`, `evidence`, `url`, `status`), or `None`. |
| `challenge_cooldown_sec` | `int` | `challengeCooldownSec` | Seconds the host was paused for; set by `goto()` only. |
| `blocked` | `bool` | derived | `True` when `challenge["blocking"]`: the snapshot is the challenge page, not the real page. |

`repr(snap)` prints `<OrbisSnapshot 'Title' actions=N tokens=M>`, with ` challenge=<vendor>/<kind>` appended when a challenge was detected.

---

## Return value shapes

These are the JSON shapes the daemon returns (from `src/types/index.ts`). Keys are camelCase because they come straight from the daemon.

**Action entry** (`snap.actions[i]`):

```json
{
  "actionId": "@3",
  "tag": "input",
  "role": "input",
  "text": "Work email",
  "name": "email",
  "type": "email",
  "value": null,
  "placeholder": "Work email",
  "href": null,
  "selector": "#email",
  "isClickable": false,
  "isInput": true,
  "disabled": false,
  "checked": null,
  "expanded": null,
  "selected": null
}
```

Optional keys are omitted when empty, so use `.get()`.

**Action map line** (`snap.action_map_text`):

```
=== INTERACTIVE ACTION MAP (3 elements) ===
[@1] [link] "Go next" href="/next" (selector: html:nth-of-type(1) > body:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(1))
[@2] [input] "[Untitled input]" (selector: #email)
[@3] [button] "Send" type="submit" (selector: ...)
```

Values you type are written to the element's `value` attribute, so they appear as `value="..."` in later action maps and in diff summaries. That includes passwords. Do not log snapshots or send them to third parties after typing secrets, and redact `value` for `type="password"` fields if you store transcripts.

The text of an action comes from `aria-label`, then `placeholder`, `title`, `value`, then text content. `<label for>` text is **not** used. An input that is only labelled by a `<label>` element shows as `"[Untitled input]"`. Target such fields with `label:...` locators.

**Diff** (`agent.diff()["diff"]`):

```json
{
  "urlChanged": false, "previousUrl": "...", "currentUrl": "...",
  "titleChanged": false, "previousTitle": "...", "currentTitle": "...",
  "addedActions":   [ /* action entries */ ],
  "removedActions": [ /* action entries */ ],
  "mutatedActions": [ { "actionId": "@4", "selector": "...", "role": "...", "text": "...",
                        "changes": { "checked": { "from": null, "to": true } } } ],
  "summary": "=== PAGE STATE DELTA ===\n..."
}
```

Tracked mutations: `text`, `value`, `disabled`, `checked`, `expanded`, `selected`.

---

## Error handling

The SDK does not wrap errors, except for the two challenge errors below, which subclass `HTTPError` so existing `except urllib.error.HTTPError` blocks keep working. You will see standard library exceptions:

| Exception | When |
| :--- | :--- |
| `ChallengeDetectedError` (409) | `--on-challenge stop` and the page is a CAPTCHA / bot check / block page / 429. Attributes: `challenge`, `cooldown_sec`, `body`. |
| `ChallengeCooldownError` (429) | The host is paused after a challenge. Attributes: `host`, `remaining_sec`, `challenge`, `body`; `headers["Retry-After"]`. |
| `urllib.error.URLError` | Daemon not reachable (refused, DNS failure). |
| `TimeoutError` / `socket.timeout` | Client-side timeout expired (see [Timeouts](#timeouts)). |
| `urllib.error.HTTPError` (404) | Unknown endpoint, `select_option()`, or the page id was not found. |
| `urllib.error.HTTPError` (400) | Malformed body, missing `fields`, invalid session file. |
| `urllib.error.HTTPError` (500) | Navigation failed (network error, timeout, robots.txt block). |
| `json.JSONDecodeError` | Response was not JSON (wrong port, a proxy error page). |
| `ConnectionError` | `connect()` received a non-200 status. |

A production wrapper that adds retries, readable errors and a single place to set policy:

```python
import json
import time
import urllib.error
from orbis import OrbisAgent


class OrbisError(RuntimeError):
    pass


def call(fn, *args, retries=2, backoff=1.0, **kwargs):
    """Run an OrbisAgent method with retries on transient failures."""
    for attempt in range(retries + 1):
        try:
            return fn(*args, **kwargs)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            try:
                message = json.loads(body).get("error", body)
            except ValueError:
                message = body
            # 4xx are caller errors: do not retry
            if 400 <= e.code < 500 or attempt == retries:
                raise OrbisError(f"{fn.__name__} failed: HTTP {e.code}: {message}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == retries:
                raise OrbisError(f"{fn.__name__} failed: {e}") from e
        time.sleep(backoff * (2 ** attempt))


agent = OrbisAgent.connect("http://localhost:9222")
snap = call(agent.goto, "https://example.com")
```

Be careful when you retry state-changing calls (`act`, `fill_form`). A retry after a client timeout may run the action twice, because the daemon may have finished the first request after the client gave up.

## Timeouts

Client timeouts are hard-coded in `agent.py`:

| Call | Client timeout |
| :--- | :--- |
| `connect()` | 5 s |
| `markdown()` | 10 s |
| every other call (`goto`, `snapshot`, `diff`, `act`, `fill_form`, sessions) | 15 s |

The daemon's own navigation timeout is 20 s, plus up to 5 s of settle time for page scripts. **A slow page can therefore make `goto()` raise a client timeout while the daemon is still loading.** The daemon finishes the navigation anyway. A later `snapshot()` returns the loaded page.

Options:

1. Treat a `goto()` timeout as "maybe loaded": catch it, then call `snapshot()` and check `snap.url`.
2. Lower the daemon timeout so it fails first: start it with `--http-timeout 12000` (this bounds the HTTP fetch of each navigation).
3. Subclass to raise the limit:

```python
import json, urllib.request
from orbis import OrbisAgent, OrbisSnapshot
import urllib.parse

class PatientAgent(OrbisAgent):
    def goto(self, url: str, timeout: float = 45) -> OrbisSnapshot:
        req = urllib.request.Request(
            f"{self.base_url}/orbis/goto?{urllib.parse.urlencode({'url': url})}",
            headers=self._make_headers(),
        )
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8"))
        return OrbisSnapshot(data.get("snapshot", data))
```

## Concurrency, threads and asyncio

**One daemon equals one page.** Every REST call targets the daemon's default page. If two threads or two workers call `goto()` on the same daemon, they overwrite each other's page, cookies and diff baseline. There is no locking.

Recommended patterns:

| Workload | Pattern |
| :--- | :--- |
| One agent | One daemon, one `OrbisAgent`. |
| N concurrent agents | N daemons on N ports (`--port 9301`, `9302`, ...). Give each worker its own `OrbisAgent`. See [production-deployment.md](./production-deployment.md). |
| One agent with parallel steps | Serialize calls with a `threading.Lock`, or use the TypeScript SDK, which supports many pages in one process. |

Port-per-worker pool:

```python
import queue
from contextlib import contextmanager
from orbis import OrbisAgent

PORTS = [9301, 9302, 9303, 9304]           # one `orbis --port N` per entry
_pool: "queue.Queue[OrbisAgent]" = queue.Queue()
for p in PORTS:
    _pool.put(OrbisAgent.connect(f"http://localhost:{p}"))

@contextmanager
def lease():
    agent = _pool.get()
    try:
        yield agent
    finally:
        agent.goto("data:text/html,<title>idle</title>")  # drop the previous document (about:blank is not supported; cookies remain)
        _pool.put(agent)

with lease() as agent:
    print(agent.goto("https://example.com").title)
```

**asyncio.** The SDK is synchronous. In async applications, run each call in a worker thread so it does not block the event loop:

```python
import asyncio
from orbis import OrbisAgent

async def fetch_title(agent: OrbisAgent, url: str) -> str:
    snap = await asyncio.to_thread(agent.goto, url)
    return snap.title

async def main():
    agents = [OrbisAgent.connect(f"http://localhost:{p}") for p in (9301, 9302)]
    urls = ["https://example.com", "https://example.org"]
    titles = await asyncio.gather(*(fetch_title(a, u) for a, u in zip(agents, urls)))
    print(titles)

asyncio.run(main())
```

Each coroutine above uses its own agent and its own daemon. Never `gather` several calls against one agent.

---

## End-to-end examples

### 1. Research agent loop with an LLM

A minimal observe, decide, act loop. The `decide` function is where your model call goes. A complete Claude tool-use version is in [integrations.md](./integrations.md#anthropic-claude-tool-use).

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")
snap = agent.goto("https://docs.python.org/3/")

observation = snap.action_map_text + "\n\n" + snap.markdown[:3000]
for step in range(8):
    decision = decide(observation)          # your LLM call -> {"op": "goto"|"type"|"click"|"done", ...}
    if decision["op"] == "done":
        print(decision["answer"])
        break
    if decision["op"] == "goto":
        snap = agent.goto(decision["url"])
        observation = snap.action_map_text + "\n\n" + snap.markdown[:3000]
    elif decision["op"] == "type":
        agent.act(decision["target"], decision["text"])
        observation = agent.diff()["diff"]["summary"]
    elif decision["op"] == "click":
        agent.act(decision["target"])
        observation = agent.diff()["diff"]["summary"]
```

Send the action map only after navigation, and send only the diff summary after in-page actions. Note that `action_map_text` repeats a CSS selector on every line. On link-dense pages a full snapshot can be larger than the raw HTML (measured on Hacker News: about 17,800 estimated tokens versus about 8,700). For production prompts, format `snap.actions` yourself without selectors and cap the count (see `compact_actions` in [integrations.md](./integrations.md#anthropic-claude-tool-use)), and use `snapshot(focus_selector="main", exclude_selectors=["nav", "footer"])` where possible.

### 2. Log in once, reuse the session

```python
import os
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")
agent.goto("https://app.example.com/login")
res = agent.fill_form(
    {"label:Email": os.environ["APP_USER"], "label:Password": os.environ["APP_PASSWORD"]},
    submit=True,
)
assert not res["skipped"], res["skipped"]
assert "/login" not in res["url"], "login did not navigate away"

agent.save_session("/var/lib/orbis/sessions/app.json")   # path on the daemon host

# later, possibly after a daemon restart:
agent.load_session("/var/lib/orbis/sessions/app.json")
snap = agent.goto("https://app.example.com/dashboard")
```

### 3. Session vault that works with a remote daemon

When the daemon runs in another container, move the session by value instead of by path:

```python
import json, urllib.request
from orbis import OrbisAgent

def export_session(agent: OrbisAgent) -> dict:
    return agent._get("/orbis/session")                      # GET returns the session JSON

def import_session(agent: OrbisAgent, session: dict) -> None:
    agent._post("/orbis/session", {"session": session})

agent = OrbisAgent.connect("http://orbis:9222")
data = export_session(agent)
# store `data` in your secret manager, then later:
import_session(agent, data)
```

`_get` and `_post` are internal helpers, but they are the simplest way to reach endpoints the SDK does not wrap. Pin the SDK version if you use them.

### 4. Structured extraction from a listing page

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")
snap = agent.goto("https://news.ycombinator.com")

stories = [
    {"title": a["text"], "url": a.get("href")}
    for a in snap.actions
    if a["role"] == "link" and a.get("href", "").startswith("http")
]
print(stories[:10])
```

For arbitrary CSS-based extraction (`table tr`, attribute values), use the MCP tool `memora_extract` or the TypeScript `page.extract()`.

### 5. Multi-step wizard with a dependent dropdown

```python
agent.goto("https://forms.example.com/register")
agent.act("label:Country", "India")              # <select>: selects the option
print(agent.diff()["diff"]["summary"])           # shows the newly revealed State field
agent.act("label:State", "Delhi")
res = agent.fill_form({"label:Full name": "Priya Sharma"}, submit="text=Continue")
```

---

## Production checklist

- [ ] One daemon per concurrent agent or worker. Never share a daemon between parallel jobs.
- [ ] Bind the daemon to a private network only, and put it behind a firewall or an authenticating reverse proxy. The API key is not enforced in 0.1.0 (see [security.md](./security.md)).
- [ ] Handle `goto()` client timeouts (15 s) separately from navigation failures (HTTP 500).
- [ ] Check `fill_form(...)["skipped"]` and `act(...)["success"]`. Neither raises on a missing element.
- [ ] Remember that `act()` clicks do not follow links or submit forms.
- [ ] Do not use `select_option()`. Use `act(target, value)`.
- [ ] Store session files as secrets, and remember the paths are on the daemon host.
- [ ] Do not take `@N` IDs from focused snapshots into `act()`.
- [ ] Re-snapshot before acting if page scripts may have changed the DOM. `@N` numbering is recomputed at action time.
- [ ] Pin both versions: `memora-orbis==0.1.0` in Python and `@memoracompany/memora-orbis@0.1.0` for the daemon.

## Known issues

> **Known issue (0.1.0):** `select_option()` always fails with HTTP 404 because `/orbis/select-option` is not implemented. Use `act(target, value)`.

> **Known issue (0.1.0):** `act()` click does not perform default actions (link navigation, form submission).

> **Known issue (0.1.0):** The API key is sent but not validated by the daemon.

> **Known issue (0.1.0):** `fill_form(submit=...)` is annotated as `bool` but the daemon also accepts a locator string. Type checkers will flag string values.

> **Known issue (0.1.0):** The PyPI package metadata lists an MIT License classifier. The actual license is the Orbis Community & Commercial Evaluation License in [LICENSE.md](../LICENSE.md).

See also: [http-api.md](./http-api.md), [locators.md](./locators.md), [integrations.md](./integrations.md), [troubleshooting.md](./troubleshooting.md), [limitations.md](./limitations.md).
