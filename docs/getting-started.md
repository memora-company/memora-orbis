# Getting Started

This guide takes you from nothing to a working Orbis setup in about five minutes. You will install Orbis, check the installation, load a page from the command line, drive a page from TypeScript and from Python, and connect an existing Playwright or Selenium script. Each section ends with a link to the full reference.

Applies to: Orbis 0.1.1 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

1. [Requirements](#1-requirements)
2. [Install](#2-install)
3. [Verify the installation](#3-verify-the-installation)
4. [Your first page from the command line](#4-your-first-page-from-the-command-line)
5. [Your first agent in TypeScript](#5-your-first-agent-in-typescript)
6. [Your first agent in Python](#6-your-first-agent-in-python)
7. [Use Orbis from Playwright, Puppeteer or Selenium](#7-use-orbis-from-playwright-puppeteer-or-selenium)
8. [Give an AI assistant a browser (MCP)](#8-give-an-ai-assistant-a-browser-mcp)
9. [Before you go to production](#9-before-you-go-to-production)
10. [Next steps](#10-next-steps)

---

## 1. Requirements

| Requirement | Version | Needed for |
| :--- | :--- | :--- |
| Node.js | 20 or newer (22 LTS recommended; CI runs on 20.x and 22.x) | Everything. The engine, CLI and servers run on Node.js |
| npm | Comes with Node.js | Installing the package |
| Python | 3.9 or newer | Only if you use the Python SDK |
| Google Chrome or Microsoft Edge | Any recent version | Optional. Only used by the MCP server when `--engine chrome` or `--engine auto` finds it |

Orbis does not download a browser binary. The default engine is written in TypeScript and runs inside the Node.js process.

## 2. Install

Pick the installation that matches how you will use Orbis.

**As a library in a Node.js project** (gives you the SDK and a local `orbis` binary):

```bash
npm install @memoracompany/memora-orbis
```

**As a global command-line tool:**

```bash
npm install -g @memoracompany/memora-orbis
```

**Without installing** (downloads on first use, good for MCP configs and quick tests):

```bash
npx -y @memoracompany/memora-orbis --help
```

**Python SDK** (an HTTP client; you also need the Node.js daemon from one of the options above):

```bash
pip install memora-orbis
```

The npm package installs three binary names that all run the same program: `orbis`, `memora-orbis` and `memora-browser`. `memora-browser` prints a deprecation warning; use `orbis`.

> **Note:** There is no npm package called `memora-orbis`. `npx memora-orbis` fails with a 404. Always use `npx -y @memoracompany/memora-orbis`.

## 3. Verify the installation

```bash
orbis --version
```

Expected output:

```text
0.1.0
```

If you installed locally instead of globally, use `npx orbis --version`. If you did not install at all, use `npx -y @memoracompany/memora-orbis --version`.

When the CLI starts a server or the `--eval` mode, it makes one request to `https://orbis.memora.company/api/v1/version-check` to check for updates. It has a 1.5-second timeout and never blocks start-up. To turn it off (for example on air-gapped hosts or in CI), set:

```bash
export ORBIS_NO_TELEMETRY=1
```

## 4. Your first page from the command line

`orbis fetch` loads a URL, runs its scripts, and prints the result in a format that is easy for a language model to read.

Print the page as Markdown (the default format):

```bash
orbis fetch https://en.wikipedia.org/wiki/Web_browser
```

Print the numbered action map (every link, button and form field on the page):

```bash
orbis fetch https://en.wikipedia.org/wiki/Web_browser --dump action_map
```

Print the page metadata (title, description, canonical URL, OpenGraph, Twitter card, JSON-LD):

```bash
orbis fetch https://en.wikipedia.org/wiki/Web_browser --dump structured_data
```

Limit output to one part of the page and cap its size:

```bash
orbis fetch https://en.wikipedia.org/wiki/Web_browser --dump-selector "#mw-content-text" --dump-max-bytes 4000
```

The action map looks like this (this one is for a small sign-in page):

```text
# Title: Sign in
URL: https://app.example.test/login
Tokens: ~136 | Actions: 4

=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "Work email" type="email" placeholder="Work email" (selector: input[name="email"])
[@2] [input] "Password" type="password" placeholder="Password" (selector: input[name="password"])
[@3] [button] "Sign in" type="submit" (selector: html:nth-of-type(1) > body:nth-of-type(1) > form:nth-of-type(1) > button:nth-of-type(1))
[@4] [link] "Forgot password?" href="/forgot" (selector: html:nth-of-type(1) > body:nth-of-type(1) > a:nth-of-type(1))
```

Each line is one element you can act on. `@1`, `@2` and so on are action IDs, explained in [Concepts](./concepts.md#action-ids). `Tokens` is an estimate (characters divided by 4), not an exact tokenizer count.

Sites can serve different content to automated clients than to a desktop browser. If a page looks empty or different from what you see in Chrome, read [Troubleshooting](./troubleshooting.md).

All commands and flags: [CLI reference](./cli-reference.md).

## 5. Your first agent in TypeScript

Create a project and install Orbis:

```bash
mkdir orbis-hello && cd orbis-hello
npm init -y
npm install @memoracompany/memora-orbis
npm install -D tsx typescript
```

Create `index.ts`:

```typescript
import { OrbisAgent } from '@memoracompany/memora-orbis';

async function main() {
  // Starts the engine in this process and a CDP server on port 9222.
  const agent = await OrbisAgent.launch({ cdpPort: 9222 });

  try {
    // Load a page. goto() returns the snapshot of the page after it loaded.
    const snapshot = await agent.goto('https://news.ycombinator.com');
    console.log(`${snapshot.title}: ${snapshot.interactiveCount} actions, ~${snapshot.tokenEstimate} tokens`);

    // The action map is what you give to a language model.
    console.log(snapshot.actionMapText.split('\n').slice(0, 10).join('\n'));

    // Clean Markdown of the page content.
    console.log(snapshot.markdown.slice(0, 500));
  } finally {
    // Always close: this stops the CDP server and releases the engine.
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run it:

```bash
npx tsx index.ts
```

### Interacting with a page

The example below uses `setContent()` so it runs offline and gives the same result every time. This is also the best way to write tests for your own agents.

```typescript
import { OrbisAgent } from '@memoracompany/memora-orbis';

const agent = await OrbisAgent.launch({ cdpPort: 9222 });
try {
  agent.page.setContent(`
    <html><head><title>Sign in</title></head><body>
      <h1>Welcome back</h1>
      <form action="/session" method="post">
        <input name="email" type="email" placeholder="Work email">
        <input name="password" type="password" placeholder="Password">
        <button type="submit">Sign in</button>
      </form>
      <a href="/forgot">Forgot password?</a>
    </body></html>`, 'https://app.example.test/login');

  const snap = agent.snapshot();
  console.log(snap.actionMapText);

  // Type into fields by action ID or by any other locator.
  agent.act('@1', 'ada@example.com');
  agent.act('placeholder:Password', 'correct-horse');

  // See exactly what changed since the last snapshot.
  console.log(agent.diff().summary);
} finally {
  await agent.close();
}
```

Output of the last line:

```text
=== PAGE STATE DELTA ===

Mutated (2 elements):
  * [@1] [input] "Work email" (value: undefined -> "ada@example.com")
  * [@2] [input] "Password" (value: undefined -> "correct-horse")
```

Three rules prevent most early mistakes:

1. **`agent.act(target)` without text only fires a click event.** It does not follow links or submit forms. To navigate by clicking, use `await agent.page.activate(target)`, or submit with `fillForm()`. See [TypeScript SDK](./typescript-sdk.md).
2. **`agent.fillForm(fields)` submits the form by default.** Pass `false` as the second argument to fill without submitting.
3. **Typed values appear in later snapshots and diffs** (see the output above). Never send a password or token to a language model through the action map. See [Security](./security.md) and [Best practices](./best-practices.md).

Full API: [TypeScript SDK](./typescript-sdk.md). Locator syntax: [Locators](./locators.md).

## 6. Your first agent in Python

The Python SDK is a small HTTP client. It talks to an Orbis daemon running on Node.js.

Start the daemon in one terminal:

```bash
npx -y @memoracompany/memora-orbis --port 9222
```

You should see a banner that includes:

```text
  â–¶ CDP WebSocket:      ws://localhost:9222/devtools/browser/memora-root
  â–¶ Discovery Endpoint: http://localhost:9222/json/version
  â–¶ Agent Snapshot:     http://localhost:9222/orbis/snapshot (or /memora/snapshot)
```

In another terminal, install the SDK and run this script:

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")

snap = agent.goto("https://news.ycombinator.com")
print(snap.title, snap.interactive_count, snap.token_estimate)
print(snap.action_map_text[:800])

# Click or type by action ID or any locator
agent.act("@1")

# What changed? diff() returns {"diff": {...}, "currentSnapshot": {...}}
print(agent.diff()["diff"]["summary"])
```

Important facts about the Python SDK:

- Every Python client connected to the same daemon shares **one page**. Run one daemon per concurrent agent or worker.
- Session file paths in `save_session()` and `load_session()` are paths on the **daemon's** machine.
- `select_option()` does not work in 0.1.0 (the server has no matching endpoint). Use `agent.act("label:Country", "India")` instead, which selects the option on a `<select>`.

Full API, limits and workarounds: [Python SDK](./python-sdk.md).

## 7. Use Orbis from Playwright, Puppeteer or Selenium

**Playwright or Puppeteer (CDP).** Start the daemon:

```bash
npx -y @memoracompany/memora-orbis --port 9222
```

Then connect:

```typescript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();
await page.goto('https://news.ycombinator.com');
console.log(await page.title());
await browser.close();
```

Orbis does not render pixels. Screenshots return a 1x1 transparent image, and there is no PDF output, file upload, iframe or shadow DOM support. Read [Playwright and Puppeteer](./playwright-puppeteer.md) before you migrate a test suite.

**Selenium (WebDriver).** Start the WebDriver server:

```bash
npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 9515
```

Then connect. No `chromedriver` is needed:

```python
from selenium import webdriver

driver = webdriver.Remote(command_executor="http://localhost:9515", options=webdriver.ChromeOptions())
driver.get("https://news.ycombinator.com")
print(driver.title)
driver.quit()
```

Supported and unsupported commands: [Selenium / WebDriver](./selenium-webdriver.md).

## 8. Give an AI assistant a browser (MCP)

Add Orbis to your MCP client configuration. For Claude Desktop, Cursor, Windsurf and most other clients, the entry is:

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp"]
    }
  }
}
```

For Claude Code:

```bash
claude mcp add orbis -- npx -y @memoracompany/memora-orbis --mcp
```

Restart the client. It gets 15 tools, including `memora_browse`, `memora_act`, `memora_diff` and `memora_fill_form`. By default (`--engine auto`) the MCP server uses Chrome or Edge if one is installed in a standard location, and the built-in engine otherwise.

Per-client steps and every tool: [MCP server](./mcp.md).

## 9. Before you go to production

Orbis 0.1.0 has defaults that are fine on a laptop and unsafe on a server. Read [Security](./security.md) in full. The most important points:

- The CDP, REST and WebDriver servers listen on **all network interfaces** even when you pass `--host localhost`. Block the port with a firewall or a private container network.
- The servers **do not check the API key** in 0.1.0. Anyone who can reach the port can control the browser, run JavaScript and read or write files through the session endpoints. Put an authenticating reverse proxy in front if the port is reachable by anything other than your own process.
- The cookie store does not separate cookies by domain. Do not visit untrusted sites in a session that holds credentials.

Then follow the checklist in [Production deployment](./production-deployment.md).

## 10. Next steps

- Learn the model behind Orbis: [Concepts](./concepts.md)
- Copy a complete solution: [Use cases](./use-cases.md)
- Design a reliable agent loop: [Best practices](./best-practices.md)
- Check that Orbis fits your sites: [Limitations and known issues](./limitations.md)
