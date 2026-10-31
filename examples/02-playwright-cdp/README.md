# Example 02: Playwright over CDP

Connect an existing [Playwright](https://playwright.dev/) script to Orbis with `chromium.connectOverCDP()`. The same approach works for Puppeteer (`puppeteer.connect({ browserURL })`).

## Step 1: Start the Orbis daemon

In a separate terminal:

```bash
npx -y @memoracompany/memora-orbis --port 9222
```

The banner includes:

```text
  â–¶ CDP WebSocket:      ws://localhost:9222/devtools/browser/memora-root
  â–¶ Discovery Endpoint: http://localhost:9222/json/version
```

Stealth is on by default. There are no `--cdp` or `--stealth` flags; `--port` sets the CDP port and `--no-stealth` turns stealth off.

## Step 2: Run the script

```bash
npm install
npm start
```

The script serves a small search page on `127.0.0.1:18092`, then drives it through Orbis. Use `ORBIS_CDP_URL` to point at a different daemon.

Expected output:

```text
Title:   Docs search
Heading: Documentation
After submit: http://127.0.0.1:18092/search?q=webdriver
Results: Orbis guide, CDP reference
navigator.webdriver: false
navigator.userAgent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36
Screenshot bytes: 68 (placeholder image; Orbis has no renderer)
```

## What works and what does not

| Works | Does not work in 0.1.0 |
| :--- | :--- |
| `page.goto`, `page.title`, `page.url`, `waitForURL` | Real screenshots (you get a 1x1 transparent PNG) and `page.pdf()` |
| Locators, `textContent`, `allTextContents` | `boundingBox()` (returns `null`), visual layout |
| `fill`, `click`, keyboard input, form submission | iframes, shadow DOM, file uploads |
| `page.evaluate` | `context.cookies()` / `addCookies()` (cookies are per page, not per context) |
| Multiple pages | Request interception (`page.route`) |

Page scripts get a subset of the browser API, so large client-rendered apps may not render. Read [Playwright and Puppeteer](../../docs/playwright-puppeteer.md) and [Limitations](../../docs/limitations.md) before moving a test suite.

## Production notes

- `browser.close()` sends `Browser.close`, which closes **every** page on the daemon, including pages of other clients. Use one daemon per test worker or agent.
- The daemon listens on all network interfaces and does not enforce an API key in 0.1.0. Keep port 9222 private. See [Security](../../docs/security.md).
