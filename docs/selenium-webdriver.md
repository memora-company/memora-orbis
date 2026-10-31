# Selenium and W3C WebDriver

Orbis can serve the W3C WebDriver protocol, so Selenium (Python, Java, JavaScript, C#, Ruby), WebdriverIO and other WebDriver clients can drive it through `webdriver.Remote(...)`. You do not need to install a browser or a `chromedriver` binary. Each WebDriver session gets its own isolated Orbis browser running on the native engine. This page covers starting the server, connecting from each language, the complete list of implemented endpoints, what is not supported, and how to run test suites in parallel.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Start the WebDriver server](#start-the-webdriver-server)
- [Connect from your language](#connect-from-your-language)
- [Capabilities](#capabilities)
- [Sessions, limits and timeouts](#sessions-limits-and-timeouts)
- [Supported endpoints](#supported-endpoints)
- [Not supported](#not-supported)
- [Behavioural differences from Chrome](#behavioural-differences-from-chrome)
- [pytest fixture](#pytest-fixture)
- [Selenium Grid](#selenium-grid)
- [Debugging](#debugging)
- [Known issues](#known-issues)

---

## Start the WebDriver server

```bash
npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 9515
```

- `--protocol webdriver` is required. Without it the server speaks CDP.
- The default port is `9222` for every protocol. Port `9515` is used here only by convention (it is chromedriver's default).
- There is no `--webdriver` flag.
- Useful options: `--max-sessions <n>` (default `16`), `--no-stealth`, and all network flags ([cli-reference.md](./cli-reference.md), [network-and-proxies.md](./network-and-proxies.md)).

Health check:

```bash
curl http://localhost:9515/status
# {"value":{"ready":true,"message":"Memora WebDriver is ready","build":{"version":"0.1.0","engine":"memora-native"}}}
```

`ready` turns `false` when the session limit is reached.

> **Security:** with `--host localhost` (the default) the server listens on `0.0.0.0`. The WebDriver endpoint has no authentication. Anyone who can reach it can start sessions and run JavaScript that makes network requests from your host. Restrict the port with a firewall or a private network ([security.md](./security.md)).

The legacy Grid prefix `/wd/hub` is accepted, so `http://localhost:9515/wd/hub` and `http://localhost:9515` both work.

## Connect from your language

The browser name you request does not matter. Orbis accepts any capabilities and echoes `browserName` back. Using `ChromeOptions` is the simplest choice, because most client code already does.

### Python

```bash
pip install selenium
```

```python
from selenium import webdriver
from selenium.webdriver.common.by import By

options = webdriver.ChromeOptions()
driver = webdriver.Remote(command_executor="http://localhost:9515", options=options)
try:
    driver.get("https://example.com")
    print(driver.title)                                    # Example Domain
    print(driver.find_element(By.TAG_NAME, "h1").text)
finally:
    driver.quit()                                           # always quit: sessions count against --max-sessions
```

### Java

```java
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.remote.RemoteWebDriver;
import java.net.URL;

public class OrbisSmokeTest {
    public static void main(String[] args) throws Exception {
        WebDriver driver = new RemoteWebDriver(new URL("http://localhost:9515"), new ChromeOptions());
        try {
            driver.get("https://example.com");
            System.out.println(driver.getTitle());
            System.out.println(driver.findElement(By.tagName("h1")).getText());
        } finally {
            driver.quit();
        }
    }
}
```

### JavaScript / TypeScript (selenium-webdriver)

```bash
npm install selenium-webdriver
```

```typescript
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const driver = await new Builder()
  .usingServer('http://localhost:9515')
  .forBrowser('chrome')
  .setChromeOptions(new chrome.Options())
  .build();
try {
  await driver.get('https://example.com');
  console.log(await driver.getTitle());
} finally {
  await driver.quit();
}
```

### C#

```csharp
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Remote;

var driver = new RemoteWebDriver(new Uri("http://localhost:9515"), new ChromeOptions());
try
{
    driver.Navigate().GoToUrl("https://example.com");
    Console.WriteLine(driver.Title);
}
finally
{
    driver.Quit();
}
```

### WebdriverIO

```typescript
// wdio.conf.ts (excerpt)
export const config = {
  hostname: 'localhost',
  port: 9515,
  path: '/',
  capabilities: [{ browserName: 'chrome' }],
};
```

Runnable Python and TypeScript examples are in [`examples/03-selenium-webdriver`](../examples/03-selenium-webdriver/).

---

## Capabilities

Orbis merges `alwaysMatch` with the **first** `firstMatch` entry. It never rejects a session for unknown capabilities. These capabilities have an effect:

| Capability | Effect |
| :--- | :--- |
| `acceptInsecureCerts: true` | Skips TLS certificate verification for this session. |
| `proxy` with `proxyType: "manual"` | `httpProxy` / `sslProxy` (HTTP proxy) or `socksProxy` (with `socksUsername` / `socksPassword`), plus `noProxy` (array or comma-separated string). Applied to this session only. |
| `proxy` with `proxyType: "direct"` | No proxy, and environment proxies are ignored. |
| `proxy` with `proxyType: "system"` | Uses `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`. |
| `proxy` with `proxyType: "pac"` or `"autodetect"` | Session creation fails ("not supported"). |
| `timeouts` | `implicit`, `pageLoad`, `script` in ms. |
| `pageLoadStrategy` | Echoed back only. Navigation always waits for the document and its scripts. |
| `browserName` | Echoed back. Defaults to `memora` if not sent. |

Everything else (`goog:chromeOptions` arguments, extensions, window size, mobile emulation) is ignored.

Returned capabilities include `"memora:engine": "native"`, `setWindowRect: false` and `unhandledPromptBehavior: "dismiss and notify"`.

Example: a per-session proxy from Python:

```python
from selenium.webdriver.common.proxy import Proxy, ProxyType

options = webdriver.ChromeOptions()
options.proxy = Proxy({"proxyType": ProxyType.MANUAL, "httpProxy": "proxy.internal:3128", "sslProxy": "proxy.internal:3128"})
options.accept_insecure_certs = False
driver = webdriver.Remote("http://localhost:9515", options=options)
```

## Sessions, limits and timeouts

| Setting | Default | How to change |
| :--- | :--- | :--- |
| Maximum concurrent sessions | 16 | `--max-sessions <n>` |
| Idle session reaper | Sessions unused for **5 minutes** are closed (checked every 5 s) | Not configurable from the CLI |
| Implicit wait | 0 ms | `driver.implicitly_wait(...)` or the `timeouts` capability |
| Page load timeout | 300,000 ms | `driver.set_page_load_timeout(...)` |
| Script timeout | 30,000 ms | `driver.set_script_timeout(...)` |

- Each session has its own Orbis browser: separate cookies, storage, windows and history. Sessions never share state.
- When the limit is reached, `POST /session` fails with `session not created: Maximum number of sessions (16) reached. Call driver.quit() after each test or raise --max-sessions.`. Leaked sessions (tests that crash before `quit()`) free their slot only after the 5-minute idle reaper runs.
- A session whose last window is closed (`DELETE /window`) is deleted.
- Page loads through WebDriver do not wait for the page's async work to settle after scripts run (the settle phase is disabled). If content arrives by `fetch` after load, wait for it explicitly with `WebDriverWait`.

## Supported endpoints

All paths below are relative to `/session/{sessionId}` unless marked as global. The source is `src/webdriver/server.ts`.

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/status` (global) | Readiness and build info. |
| POST | `/session` (global) | New session. |
| DELETE | `` (the session itself) | Quit. |
| GET / POST | `/timeouts` | |
| POST | `/url` | Navigate. `about:blank` is handled locally. |
| GET | `/url` | Current URL. |
| POST | `/back`, `/forward`, `/refresh` | |
| GET | `/title` | |
| GET | `/source` | Serialized DOM (`<!DOCTYPE html>` plus `<html>...`). |
| GET | `/window` | Current handle (the page id). |
| GET | `/window/handles` | |
| POST | `/window` | Switch window. |
| DELETE | `/window` | Close the current window. Returns the remaining handles. |
| POST | `/window/new` | New tab or window. |
| GET / POST | `/window/rect`, `/window/maximize`, `/window/minimize`, `/window/fullscreen` | Always return `{x:0, y:0, width:1280, height:800}`. Resizing has no effect. |
| POST | `/frame` | Only `{"id": null}` (top-level) is accepted. Any other frame raises `no such frame`. |
| POST | `/frame/parent` | No-op. |
| POST | `/element`, `/elements` | Strategies: `css selector`, `tag name`, `link text`, `partial link text`, `xpath`. Selenium clients translate `By.ID`, `By.NAME` and `By.CLASS_NAME` to CSS. |
| POST | `/element/{id}/element`, `/element/{id}/elements` | Scoped search. |
| GET | `/element/active` | Focused element. |
| GET | `/element/{id}/selected`, `/enabled`, `/displayed` | Computed from markup and inline styles only. |
| GET | `/element/{id}/attribute/{name}` | |
| GET | `/element/{id}/property/{name}` | |
| GET | `/element/{id}/css/{name}` | **Inline `style` attribute only.** Stylesheets are not applied, so values are `""` unless set inline. |
| GET | `/element/{id}/text` | Visible text. |
| GET | `/element/{id}/name` | Tag name. |
| GET | `/element/{id}/rect` | From a simplified internal layout, not real CSS layout. |
| GET | `/element/{id}/computedrole` | The `role` attribute only (implicit ARIA roles are not computed). |
| GET | `/element/{id}/computedlabel` | `aria-label`, else the visible text. |
| POST | `/element/{id}/click` | Focuses, then performs the default action (follows links, submits forms, toggles checkboxes, selects options). Raises `element not interactable` if not displayed. |
| POST | `/element/{id}/clear` | |
| POST | `/element/{id}/value` | Send keys. On `<select>`, picks the first option whose text starts with the keys. `ENTER` / `RETURN` submit. |
| GET | `/element/{id}/screenshot` | Blank PNG. |
| POST | `/execute/sync`, `/execute/async` | Runs in the page's V8 sandbox. Element references in arguments and results are supported. A script that assigns `window.location` triggers navigation. |
| GET | `/cookie`, `/cookie/{name}` | Cookies are reported with the current host as `domain`, `path: "/"` and `secure`/`httpOnly` false (the engine stores name and value only). |
| POST | `/cookie` | Requires an `http(s)` page to be loaded first. |
| DELETE | `/cookie/{name}`, `/cookie` | |
| POST / DELETE | `/actions` | Key sources (`keyDown` types into the active element) and pointer sources (`pointerMove` to an element, `pointerDown`/`pointerUp` â†’ click, button 2 â†’ `contextmenu`). `pause` is honoured. Wheel actions are ignored. |
| GET | `/screenshot` | Blank PNG. |
| POST | `/alert/*`, GET `/alert/text` | Always `no such alert`. |
| POST | `/print` | `unsupported operation`. |
| GET | `/element/{id}/shadow` | `no such shadow root`. |

Error responses follow the W3C format: `{"value": {"error": "<code>", "message": "...", "stacktrace": ""}}` with the matching HTTP status (400, 404 or 500).

## Not supported

| Feature | Result | Workaround |
| :--- | :--- | :--- |
| Alerts, confirms, prompts | `no such alert`. `window.alert` is not even defined in page scripts, so calling it throws a script error. | Test dialog logic on real Chrome. |
| iframes | `switch_to.frame(...)` raises `no such frame`. Frame content is not loaded. | Navigate to the frame's `src` URL directly. |
| Shadow DOM | `no such shadow root`. | None. |
| Screenshots | Blank 1Ã—1 PNG. Calls succeed. | Use real Chrome for visual checks. |
| Print to PDF | `unsupported operation`. | |
| Window size and position | Fixed at 1280Ã—800 and cannot be changed. | |
| File upload | `send_keys("/path/file.pdf")` on `<input type=file>` stores only the file **name** in the input's value. No file content is sent on submit. | Upload through your application's API in test setup. |
| CSS computed styles | Only inline `style` values. | Assert on classes or attributes instead. |
| Visibility from stylesheets | An element hidden by a CSS class (not inline style, not `hidden`) is reported as displayed and is clickable. | Assert visibility through classes or ARIA attributes. |
| Client-rendered SPAs | Pages that depend on `XMLHttpRequest`, `WebSocket`, `requestAnimationFrame`, `IntersectionObserver`, `history` and similar APIs usually do not render, because the native runtime does not provide them. | Use Orbis for server-rendered pages. See [limitations.md](./limitations.md). |
| BiDi (`webSocketUrl: true`), CDP-over-Selenium (`execute_cdp_cmd`) | Not available. | |

## Behavioural differences from Chrome

- **No layout.** `rect`, element location and pointer coordinates come from a simplified model. Tests that compare positions or sizes will not match Chrome.
- **Typing is not keystroke-by-keystroke.** `send_keys` sets the value and dispatches `input` and `change` events. Listeners on `keydown` and `keypress` for individual characters may not fire as they do in Chrome.
- **Navigation is fetch-based.** The engine fetches the HTML, runs classic and module scripts, then reports the page loaded. Lazy content that appears after load needs explicit waits.
- **Stealth is on by default.** Requests carry Chrome 130 on Windows headers, and `navigator.webdriver` is `false` ([stealth.md](./stealth.md)). Use `--no-stealth` if your application under test should see an honest client.

## pytest fixture

```python
# conftest.py
import os
import subprocess
import time
import urllib.request

import pytest
from selenium import webdriver

ORBIS_PORT = int(os.environ.get("ORBIS_PORT", "9515"))


def _wait_ready(port: int, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1) as r:
                if r.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"Orbis WebDriver did not start on port {port}")


@pytest.fixture(scope="session")
def orbis_server():
    # One server per pytest-xdist worker: gw0 -> 9515, gw1 -> 9516, ...
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")
    port = ORBIS_PORT + (int(worker_id[2:]) if worker_id.startswith("gw") else 0)
    proc = subprocess.Popen(
        ["npx", "-y", "@memoracompany/memora-orbis", "serve", "--protocol", "webdriver",
         "--port", str(port), "--max-sessions", "4"],
        env={**os.environ, "ORBIS_NO_TELEMETRY": "1"},
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        shell=(os.name == "nt"),
    )
    try:
        _wait_ready(port)
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@pytest.fixture
def driver(orbis_server):
    d = webdriver.Remote(command_executor=orbis_server, options=webdriver.ChromeOptions())
    d.implicitly_wait(2)
    yield d
    d.quit()
```

```python
# test_login.py
from selenium.webdriver.common.by import By

def test_login(driver):
    driver.get("https://staging.example.com/login")
    driver.find_element(By.ID, "email").send_keys("qa@example.com")
    driver.find_element(By.ID, "password").send_keys("test-only-password")
    driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
    assert "/dashboard" in driver.current_url
```

`pytest-xdist` sets `PYTEST_XDIST_WORKER` (`gw0`, `gw1`, ...) in each worker process. Without xdist, a single server on `ORBIS_PORT` is used. Install `pytest-xdist` and run `pytest -n 4` for parallel workers, each with its own server.

## Selenium Grid

Orbis is a WebDriver endpoint, not a Grid node, and it does not register itself with a Grid hub. Options:

1. **Point tests directly at Orbis** (recommended). Run one Orbis server per CI job or per worker, as in the fixture above.
2. **Grid relay.** Selenium Grid 4 can forward sessions for a given stereotype to an external WebDriver endpoint through the node's relay configuration (`[relay] url = "http://orbis:9515"` with a `configs` stereotype such as `{"browserName": "chrome", "platformName": "linux"}`). Requests that match the stereotype are relayed to Orbis. The Grid's own features (video, live view) do not apply.

In both cases, size `--max-sessions` to the parallelism you route to each server. Monitor `/status` from your orchestrator: `ready: false` means the server is full.

## Debugging

- Set `DEBUG_WEBDRIVER=1` on the server to log every request (`[WebDriver] METHOD /path body...`) to stderr.
- `driver.page_source` shows the DOM as Orbis sees it after scripts ran. Use it to check whether client-side rendering happened.
- Use `driver.execute_script("return document.readyState")` and similar probes to inspect page state.

## Known issues

> **Known issue (0.1.0):** The idle-session timeout (5 minutes) cannot be changed from the CLI. Crashed tests that skip `quit()` hold a session slot until it expires.

> **Known issue (0.1.0):** `localhost` binds to all interfaces, and there is no authentication on the WebDriver endpoint.

See also: [playwright-puppeteer.md](./playwright-puppeteer.md), [limitations.md](./limitations.md), [production-deployment.md](./production-deployment.md), [troubleshooting.md](./troubleshooting.md).
