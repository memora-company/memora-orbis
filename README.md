<div align="center">

<img src="https://orbis.memora.company/orbis-logo.svg" alt="Orbis Logo" width="120" height="120" />

# Orbis by Memora

### A lightweight headless browser built for AI agents

**Pages become a numbered action map plus clean Markdown. Drive them from TypeScript, Python, REST, Playwright, Puppeteer, Selenium or MCP.**

[![npm version](https://img.shields.io/npm/v/@memoracompany/orbis.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/@memoracompany/orbis)
[![PyPI](https://img.shields.io/pypi/v/memora-orbis.svg?style=flat-square&color=brightgreen)](https://pypi.org/project/memora-orbis/)
[![Changelog](https://img.shields.io/badge/Changelog-v0.1.1-blue.svg?style=flat-square)](./CHANGELOG.md)
[![License: Evaluation & Commercial](https://img.shields.io/badge/License-Community%20Evaluation-orange.svg?style=flat-square)](./LICENSE.md)
[![CDP](https://img.shields.io/badge/CDP-Supported-blueviolet.svg?style=flat-square)](./docs/playwright-puppeteer.md)
[![WebDriver](https://img.shields.io/badge/WebDriver-Supported-orange.svg?style=flat-square)](./docs/selenium-webdriver.md)
[![MCP](https://img.shields.io/badge/MCP-15%20tools-teal.svg?style=flat-square)](./docs/mcp.md)

<br/>

<a href="./docs/README.md"><b>Documentation</b></a> •
<a href="./docs/getting-started.md"><b>Getting started</b></a> •
<a href="./CHANGELOG.md"><b>Changelog</b></a> •
<a href="./docs/use-cases.md"><b>Use cases</b></a> •
<a href="./docs/production-deployment.md"><b>Production</b></a> •
<a href="./examples/"><b>Examples</b></a> •
<a href="https://orbis.memora.company"><b>Website</b></a>

</div>

---

## What is Orbis?

Orbis is a headless browser that skips layout and painting. It downloads a page, builds the DOM, runs the page's JavaScript in a sandbox, and gives you a compact text view of the page that a language model can act on:

```text
=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "Work email" type="email" placeholder="Work email" (selector: input[name="email"])
[@2] [input] "Password" type="password" placeholder="Password" (selector: input[name="password"])
[@3] [button] "Sign in" type="submit" (selector: html:nth-of-type(1) > body:nth-of-type(1) > form:nth-of-type(1) > button:nth-of-type(1))
[@4] [link] "Forgot password?" href="/forgot" (selector: html:nth-of-type(1) > body:nth-of-type(1) > a:nth-of-type(1))
```

Your agent reads the map and acts with `@1`, `@2`, `label:Email`, `text=Sign in` or any CSS/XPath selector. Orbis then tells it exactly what changed.

**Main features**

- **Action map and Markdown.** Every link, button and field gets a numbered action ID; page content becomes Markdown. Options to focus on one region or strip navigation, footers and banners.
- **Multi-Tab & Worker Concurrency.** Open dozens of parallel background tabs in a single lightweight process without memory leaks. Create isolated browser contexts (`agent.newContext()`) with separate cookie jars for multi-agent workflows.
- **Challenge & CAPTCHA detection.** Early detection of Cloudflare Turnstile, reCAPTCHA v2/v3, AWS WAF, and 429 rate limits with typed signals and stop policies.
- **Ten locator strategies.** Action IDs, semantic aliases (`@email`), `text=`, `label:`, `placeholder:`, `testid:`, `role:`, XPath, CSS and bare names. See [Locators](./docs/locators.md).
- **State diffs.** `diff()` reports added, removed and changed elements plus URL and title changes since the last snapshot.
- **Forks.** Copy a page (DOM, cookies, storage) into an independent page to try several paths from one starting point.
- **Sessions.** Save and restore cookies, `localStorage` and `sessionStorage` as JSON.
- **Many interfaces.** In-process TypeScript SDK, Python SDK, REST API, Chrome DevTools Protocol, W3C WebDriver, MCP over stdio and a one-shot CLI.
- **Network control.** Proxies (HTTP, HTTPS, SOCKS5) through the SDK or environment variables, custom headers and user agent, TLS options, and opt-in robots.txt compliance (RFC 9309).
- **Stealth profile.** A consistent Chrome-on-Windows header profile and common automation-signal patches, on by default. See [Stealth](./docs/stealth.md) for exactly what it does and does not do.

**Know the trade-offs.** Orbis does not render. There are no real screenshots, no PDF, no iframes, no shadow DOM, no file uploads, and page scripts get a subset of the browser API. It is excellent on server-rendered HTML and may not work on heavy client-rendered apps. Read [Limitations and known issues](./docs/limitations.md) before you commit.

---

## Measured performance

Measured by the Orbis team on one Windows 11 laptop (Node.js 22), October 2026. Measure on your own pages before you size anything.

| Measurement | Headless Chrome | Orbis |
| :--- | :--- | :--- |
| Time to load 200 local test pages in one tab (median of 3, after start-up) | 3.4 s | **0.31 s** |
| Memory with 10 tabs open | 1,154 MB | **107 MB** |

On the four HTML fixtures in the Orbis benchmark, the distilled output used 33–40% fewer tokens than the raw HTML (37% on average), and parsing plus building the action map and Markdown took about 4 ms per page.

Token savings are not automatic on real sites. Each action line includes a CSS selector, and on link-dense pages those selectors can make the full snapshot larger than the HTML (for example, about 17,800 estimated tokens for the Hacker News front page, which is about 35 KB of HTML). Use `focusSelector`, `excludeSelectors`, or a compact map built from `snapshot.actions`, as described in [Best practices](./docs/best-practices.md).

---

## Quickstart

### Install

```bash
# Node.js SDK and CLI
npm install @memoracompany/orbis

# Or a global CLI
npm install -g @memoracompany/orbis

# Python SDK (talks to an Orbis daemon over HTTP)
pip install memora-orbis
```

Requires Node.js 20 or newer. Python 3.9 or newer for the Python SDK. `npx memora-orbis` does not exist on npm; use `npx -y @memoracompany/orbis`.

### Command line

```bash
orbis fetch https://en.wikipedia.org/wiki/Web_browser                       # Markdown
orbis fetch https://en.wikipedia.org/wiki/Web_browser --dump action_map     # numbered actions
orbis fetch https://en.wikipedia.org/wiki/Web_browser --dump structured_data # metadata, JSON-LD
```

### TypeScript

```typescript
import { OrbisAgent } from '@memoracompany/orbis';

const agent = await OrbisAgent.launch({ cdpPort: 9222 }); // stealth is on by default
try {
  const snapshot = await agent.goto('https://news.ycombinator.com');
  console.log(`${snapshot.title}: ${snapshot.interactiveCount} actions, ~${snapshot.tokenEstimate} tokens`);
  console.log(snapshot.actionMapText);

  // Follow a link. act() only fires a click event; activate() also follows links and submits forms.
  await agent.page.activate('text=new');

  // What changed since the last snapshot?
  console.log(agent.diff().summary);
} finally {
  await agent.close();
}
```

On a page with a form, fill and submit it in one call. `fillForm` submits by default; pass `false` as the second argument to fill only. Fields that are not found are reported in `skipped`.

```typescript
const result = await agent.fillForm({
  'label:Email Address': 'alex@example.com',
  'placeholder:Password': process.env.APP_PASSWORD ?? '',
}, 'text=Sign In');
console.log(result.filled, result.skipped, result.submitted, result.url);
```

#### Parallel Tabs & Worker Concurrency

Open parallel background tabs or isolated contexts within the same lightweight process:

```typescript
// Open a secondary background tab without loading a separate browser
const searchTab = await agent.newTab('https://news.ycombinator.com/newest', { switch: false });
console.log(`Open tabs: ${agent.tabs.length}`); // 2 tabs, shared memory footprint

// Create an isolated context with its own cookie jar for a separate account
const isolatedContext = agent.newContext();
const workerPage = isolatedContext.newPage();
await workerPage.goto('https://example.com/dashboard');

// Cleanly close tabs when finished (aborts in-flight network requests automatically)
agent.closeTab(searchTab.id);
```

### Python

```bash
npx -y @memoracompany/orbis --port 9222   # start the daemon in another terminal
```

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")
snap = agent.goto("https://news.ycombinator.com")
print(snap.title, snap.interactive_count)
print(snap.action_map_text)

agent.act("label:Country", "India")          # type into a field or pick a <select> option
print(agent.diff()["diff"]["summary"])
```

### Playwright or Puppeteer (CDP)

```bash
npx -y @memoracompany/orbis --port 9222
```

```typescript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();
await page.goto('https://news.ycombinator.com');
console.log(await page.title());
await browser.close();
```

### Selenium (W3C WebDriver)

```bash
npx -y @memoracompany/orbis serve --protocol webdriver --port 9515
```

```python
from selenium import webdriver

driver = webdriver.Remote(command_executor="http://localhost:9515", options=webdriver.ChromeOptions())
driver.get("https://news.ycombinator.com")
print(driver.title)
driver.quit()
```

### MCP (Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity)

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/orbis", "--mcp"]
    }
  }
}
```

Claude Code: `claude mcp add orbis -- npx -y @memoracompany/orbis --mcp`. See [MCP server](./docs/mcp.md) for all 15 tools.

---

## Locators

| Strategy | Example | Best for |
| :--- | :--- | :--- |
| Action ID | `@1`, `@42` | LLM agent loops. Positional: take a fresh snapshot before using one |
| Semantic alias | `@email`, `@submit` | Readable shorthand matched against name, placeholder, text or selector |
| Text | `text=Sign In`, `text="Add to cart"` | Buttons and links by visible text (case-insensitive) |
| Label | `label:Email Address` | Form fields with a `<label>` or `aria-label` |
| Placeholder | `placeholder:Search` | Inputs without labels |
| Test ID | `testid:checkout-btn` | `data-testid`, `data-test-id`, `data-qa`, `data-cy` |
| Role | `role:button[name="Submit"]` | ARIA roles and accessible names |
| XPath | `//button[contains(text(), "Pay")]`, `xpath=...` | Complex traversal, Selenium migrations |
| CSS | `#submit`, `.card > input` | Standard selectors |
| Bare name | `username` | Matches `#username`, then `[name="username"]`, then `[data-testid="username"]` |

Resolution order, matching rules and pitfalls: [Locators](./docs/locators.md).

---

## CLI at a glance

```bash
orbis                                          # CDP + REST server on localhost:9222 (same as `orbis serve`)
orbis --port 9333                              # another port
orbis serve --protocol webdriver --port 9515   # W3C WebDriver server for Selenium
orbis --mcp                                    # MCP server over stdio
orbis --mcp --engine native                    # force the built-in engine (default: auto prefers installed Chrome)
orbis --eval https://example.com               # one-shot: print action map and Markdown
orbis fetch <url> --dump markdown|html|structured_data|action_map
orbis --no-stealth                             # turn stealth off (it is on by default)
orbis --obey-robots --robots-agent MyCrawler   # respect robots.txt
```

There are no `--cdp`, `--webdriver`, `--stealth` or `--headless` flags. Full list: [CLI reference](./docs/cli-reference.md).

---

## Before you deploy

Orbis servers are built for trusted networks. Read [Security](./docs/security.md) and [Production deployment](./docs/production-deployment.md). In short:

- Page JavaScript runs in a Node.js `vm` context, which is not a security boundary: a hostile page can reach the host process. Run Orbis in an isolated container with no secrets when it visits sites you do not control.
- The servers listen on all interfaces even with `--host localhost`. Firewall the port.
- The API key is stored but should be reinforced by an authenticating proxy in front of any public port.
- Multi-Tab & Multi-Agent Concurrency (0.1.1): Use `agent.newContext()` or `agent.newTab({ isolated: true })` for isolated cookie jars and distinct storage per agent persona.
- The cookie jar (0.1.1) provides domain, path, and secure scoping per context.
- Typed values (including passwords) appear in later action maps and diffs. Do not send them to a model.
- Production use requires a commercial license. See [License](#license).

---

## Documentation

| | |
| :--- | :--- |
| [Getting started](./docs/getting-started.md) | Install, verify, first scripts in every interface |
| [Changelog](./CHANGELOG.md) | Version-wise release history and detailed feature changes |
| [Concepts](./docs/concepts.md) | Page lifecycle, action map, action IDs, diffs, forks, sessions, engines |
| [Use cases](./docs/use-cases.md) | Complete, real-world recipes |
| [Best practices](./docs/best-practices.md) | Reliable agent loops, waiting, retries, concurrency |
| [CLI](./docs/cli-reference.md) · [TypeScript SDK](./docs/typescript-sdk.md) · [Python SDK](./docs/python-sdk.md) · [HTTP API](./docs/http-api.md) · [Locators](./docs/locators.md) | Reference |
| [MCP](./docs/mcp.md) · [Playwright/Puppeteer](./docs/playwright-puppeteer.md) · [Selenium](./docs/selenium-webdriver.md) · [Agent frameworks](./docs/integrations.md) | Integrations |
| [Production](./docs/production-deployment.md) · [Security](./docs/security.md) · [Network](./docs/network-and-proxies.md) · [Stealth](./docs/stealth.md) · [Sessions](./docs/sessions-and-auth.md) | Operations |
| [Troubleshooting](./docs/troubleshooting.md) · [Limitations](./docs/limitations.md) | When things go wrong |

## Examples

Runnable projects in [`examples/`](./examples/):

- [`01-autonomous-agent`](./examples/01-autonomous-agent/) — snapshot, act, diff, fork and sessions with the TypeScript SDK
- [`02-playwright-cdp`](./examples/02-playwright-cdp/) — an existing Playwright script connected over CDP
- [`03-selenium-webdriver`](./examples/03-selenium-webdriver/) — Selenium in Python and TypeScript with no chromedriver
- [`04-dynamic-dropdown-wizard`](./examples/04-dynamic-dropdown-wizard/) — dependent dropdowns (country to state) with stable locators and diffs
- [`05-browser-use-ai`](./examples/05-browser-use-ai/) — Browser-Use over CDP (experimental)
- [`06-mcp-server`](./examples/06-mcp-server/) — MCP configs and a raw JSON-RPC client

---

## Contributing

Contributions are welcome. Read the [Contributing guide](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md). Report bugs with the [bug template](./.github/ISSUE_TEMPLATE/bug_report.md) and request features with the [feature template](./.github/ISSUE_TEMPLATE/feature_request.md). Report security issues privately as described in [SECURITY.md](./SECURITY.md).

## About Memora

**[Memora](https://memora.company/)** is an AI organizational memory and knowledge management platform that stops teams from losing what they know. It connects Slack, GitHub, Jira, Confluence, Linear, Notion, Google Drive and meeting transcripts into one searchable, cited memory:

- **[Organizational Memory](https://memora.company/solutions/organizational-memory)** — captures the reasoning behind decisions as they happen.
- **[Enterprise Knowledge Search](https://memora.company/solutions/enterprise-knowledge-search)** — one natural-language search across your tools, with citations.
- **[AI Meeting Notes](https://memora.company/solutions/ai-meeting-notes)** — links meeting decisions and action items to the code and tickets they affect.
- **[Orbis](https://orbis.memora.company)** — the lightweight, agent-first headless browser in this repository.

## License

Orbis is available under the [Commercial & Community Evaluation License](./LICENSE.md). Evaluation, development, proof-of-concept and personal educational use are free. Production deployments, multi-agent fleets, SLAs and commercial embedding require a commercial license from Memora: [sales@memora.company](mailto:sales@memora.company).

---

<div align="center">
  <sub>Built by the <a href="https://memora.company">Memora</a> engineering team.</sub>
</div>
