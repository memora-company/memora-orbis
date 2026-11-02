# Example 03: Selenium over W3C WebDriver

Run standard Selenium code against Orbis. Orbis is the WebDriver server, so you do not install `chromedriver` or Chrome.

## Step 1: Start the Orbis WebDriver server

In a separate terminal:

```bash
npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 9515
```

The banner includes:

```text
  ▶ WebDriver URL:      http://localhost:9515
  ▶ Status:             http://localhost:9515/status
  ▶ Max Sessions:       16
```

There is no `--webdriver` flag: use `serve --protocol webdriver`. The legacy Grid prefix `/wd/hub` is also accepted, so `http://localhost:9515/wd/hub` works too.

## Step 2: Run a client

### Python

```bash
pip install -r requirements.txt
python selenium_demo.py
```

### TypeScript (selenium-webdriver)

```bash
npm install
npm start
```

Both scripts serve a small search page locally and drive it through Orbis. Use `ORBIS_WEBDRIVER_URL` to point at another server. Expected output:

```text
Title:   Docs search
Heading: Documentation
After submit: http://127.0.0.1:18093/search?q=selenium
Results: Orbis guide, WebDriver reference
navigator.webdriver: False
```

(The TypeScript version uses port 18094 and prints `false`.)

## What works and what does not

| Works | Does not work in 0.1.0 |
| :--- | :--- |
| `get`, `title`, `current_url`, back, forward, refresh | Alerts (`switch_to.alert`) |
| `find_element(s)` by CSS, XPath, id, name, tag, link text | Frames (`switch_to.frame` with an id), shadow DOM |
| `send_keys`, `click`, `clear`, form submission | Real screenshots (blank image), `print_page` |
| `execute_script`, `execute_async_script` | Window size and position (fixed 1280x800) |
| Cookies, multiple windows | File upload |

Navigation through WebDriver does not wait for the page's asynchronous work to settle. Use explicit waits (`WebDriverWait`) for content loaded by scripts. Full endpoint list and pytest fixtures: [Selenium / WebDriver](../../docs/selenium-webdriver.md).

## Production notes

- Each session gets its own page. The default limit is 16 concurrent sessions (`--max-sessions`). Sessions idle for 5 minutes are closed automatically.
- Always call `driver.quit()`, ideally in a `finally` block or test fixture.
- The server listens on all network interfaces and has no authentication in 0.1.0. Keep the port private. See [Security](../../docs/security.md).
