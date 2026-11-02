# Orbis Examples

Runnable projects that show how to use Orbis from each interface. Every example was run against the published `@memoracompany/memora-orbis` 0.1.2 package (and `memora-orbis` 0.1.2 on PyPI). Most of them serve their own small local web page, so the output is the same every time and no internet access is needed.

| Folder | Interface | What it shows | Needs a running daemon? |
| :--- | :--- | :--- | :--- |
| [`01-autonomous-agent`](./01-autonomous-agent/) | TypeScript SDK | Snapshot, compact action map, `fillForm`, `diff`, `fork`, session save and restore against a local login app | No (in-process) |
| [`02-playwright-cdp`](./02-playwright-cdp/) | Playwright over CDP | Navigation, locators, fill, click, form submit, `evaluate`, what screenshots return | Yes: `orbis --port 9222` |
| [`03-selenium-webdriver`](./03-selenium-webdriver/) | Selenium (Python and TypeScript) | W3C WebDriver with no chromedriver | Yes: `orbis serve --protocol webdriver --port 9515` |
| [`04-dynamic-dropdown-wizard`](./04-dynamic-dropdown-wizard/) | TypeScript SDK | Dependent dropdowns, shifting action IDs, stable locators, diffs | No (in-process) |
| [`05-browser-use-ai`](./05-browser-use-ai/) | Python SDK + Claude | A complete tool-use agent loop; Browser-Use compatibility notes | Yes: `orbis --port 9222` |
| [`06-mcp-server`](./06-mcp-server/) | MCP | Client configs for Claude Desktop, Claude Code, Cursor, Antigravity; a raw JSON-RPC client | No (the client starts `orbis --mcp`) |

## Running an example

Each folder is a standalone project:

```bash
cd examples/01-autonomous-agent
npm install
npm start
```

Python examples use `pip install -r requirements.txt` and `python <script>.py`.

From the repository root you can also run the in-process examples with:

```bash
npm install
npm run example:agent
npm run example:dropdown
```

For the daemon-based examples, start the daemon in a separate terminal first (`npm run orbis:cdp` or `npm run orbis:webdriver` from the root), then run `npm run example:playwright` or `npm run example:selenium`.

## Ports used

| Port | Used by |
| :--- | :--- |
| 9222 | Orbis CDP daemon (examples 02 and 05) |
| 9515 | Orbis WebDriver daemon (example 03) |
| 18091–18095 | Local demo web pages served by the examples |
| 19222–19224 | CDP servers started by the in-process SDK examples |

## Where to go next

- [Getting started](../docs/getting-started.md)
- [Use cases](../docs/use-cases.md) for complete production-style recipes
- [Best practices](../docs/best-practices.md)
