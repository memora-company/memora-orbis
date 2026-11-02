# Orbis Documentation

This is the complete documentation for Orbis by Memora: a lightweight headless browser for AI agents and automation. It turns web pages into a compact, numbered action map plus clean Markdown, and it can be driven through a TypeScript SDK, a Python SDK, a REST API, the Chrome DevTools Protocol (Playwright and Puppeteer), W3C WebDriver (Selenium) and the Model Context Protocol (MCP).

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

Every behaviour described in these pages was checked against the Orbis 0.2.0 source code, and the important ones were also run against the published build. Where Orbis has a known bug or limitation, the docs say so in a callout that starts with **Known issue**. Read those before you deploy.

---

## Start here

| If you want to... | Read |
| :--- | :--- |
| Install Orbis and run your first page in five minutes | [Getting started](./getting-started.md) |
| Review version history and latest features | [Changelog](../CHANGELOG.md) |
| Move to a newer version | [Upgrading](./upgrading.md) |
| Understand how Orbis works and what the action map, diff, multi-tab contexts and fork are | [Concepts](./concepts.md) |
| See complete, real-world examples you can adapt | [Use cases (cookbook)](./use-cases.md) |
| Put Orbis into production safely | [Production deployment](./production-deployment.md) and [Security](./security.md) |
| Know what Orbis cannot do before you commit to it | [Limitations and known issues](./limitations.md) |

## Reference

| Document | What it covers |
| :--- | :--- |
| [CLI reference](./cli-reference.md) | Every command (`orbis`, `orbis serve`, `orbis fetch`), every flag, defaults, environment variables and exit codes |
| [TypeScript SDK](./typescript-sdk.md) | `OrbisAgent`, `OrbisBrowser`, `OrbisPage`, every method and every exported type |
| [Python SDK](./python-sdk.md) | `OrbisAgent` for Python, its HTTP model, timeouts and limits |
| [Locators](./locators.md) | The 10 locator strategies (`@1`, `@email`, `text=`, `label:`, `placeholder:`, `testid:`, `role:`, XPath, CSS, bare names), resolution order and pitfalls |
| [HTTP API](./http-api.md) | The REST agent endpoints (`/orbis/*`) and CDP discovery endpoints (`/json/*`) |

## Integrations

| Document | What it covers |
| :--- | :--- |
| [MCP server](./mcp.md) | Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity, VS Code; all 15 tools (16 with `memora_handoff` from 0.1.2, 17 with `memora_firewall` from 0.2.0) |
| [Playwright and Puppeteer](./playwright-puppeteer.md) | Connecting over CDP, supported CDP methods, the custom `Orbis.*` CDP domain |
| [Selenium / WebDriver](./selenium-webdriver.md) | W3C WebDriver server, supported and unsupported commands, pytest setup |
| [Agent frameworks](./integrations.md) | LangChain, Browser-Use, Stagehand, CrewAI, OpenAI and Claude tool use |

## Operating Orbis

| Document | What it covers |
| :--- | :--- |
| [Production deployment](./production-deployment.md) | Architecture choices, capacity, Docker, Kubernetes, systemd, timeouts, observability, launch checklist |
| [Security](./security.md) | Threat model, network exposure, authentication, file access, cookie handling, hardening checklist |
| [Prompt injection firewall](./prompt-injection-firewall.md) | Stop web pages from steering your agent: approvals for risky actions, allowed and blocked sites, activity log (0.2.0+) |
| [Network and proxies](./network-and-proxies.md) | Proxies, headers, TLS, redirects, cookies, robots.txt |
| [Stealth](./stealth.md) | Exactly what the stealth profile changes, and what it does not |
| [CAPTCHAs, bot checks and rate limits](./challenges.md) | Detection, per-host cooldown, stop mode, human handoff (0.1.2+) |
| [Sessions and authentication](./sessions-and-auth.md) | Saving and restoring logins, session file format, token injection |
| [Best practices](./best-practices.md) | Agent loop design, locator choice, waiting, retries, concurrency, responsible automation |
| [Troubleshooting and FAQ](./troubleshooting.md) | Symptom, cause and fix for common problems |
| [Limitations and known issues](./limitations.md) | What Orbis 0.1.0 does not do, and every known issue with its workaround |

---

## Package names at a glance

Orbis is published under several names. Use these exact names:

| What | Name | Command |
| :--- | :--- | :--- |
| npm package (SDK and CLI) | `@memoracompany/memora-orbis` | `npm install @memoracompany/memora-orbis` |
| Run the CLI without installing | `@memoracompany/memora-orbis` | `npx -y @memoracompany/memora-orbis --help` |
| CLI binaries installed by the npm package | `orbis`, `memora-orbis`, `memora-browser` (deprecated) | `orbis --help` |
| Python SDK on PyPI | `memora-orbis` | `pip install memora-orbis` |
| Python import | `orbis` | `from orbis import OrbisAgent` |

> **Note:** `memora-orbis` is a CLI *binary name* inside the npm package, not an npm package of its own. `npx memora-orbis` fails with a 404. Always use `npx -y @memoracompany/memora-orbis`.

## Interfaces at a glance

| Interface | Start it with | Talks to it | Best for |
| :--- | :--- | :--- | :--- |
| TypeScript SDK (in-process) | `OrbisAgent.launch()` | Direct method calls | Node.js agents and pipelines |
| REST API | `orbis --port 9222` | HTTP + JSON on `/orbis/*` | Python SDK, any language, quick scripts |
| CDP | `orbis --port 9222` | WebSocket at `ws://host:port/devtools/browser/memora-root` | Playwright, Puppeteer, Stagehand, Browser-Use |
| WebDriver | `orbis serve --protocol webdriver --port 9515` | W3C WebDriver HTTP | Selenium, WebdriverIO |
| MCP | `orbis --mcp` | JSON-RPC over stdio | Claude Desktop, Claude Code, Cursor, other AI assistants |
| One-shot CLI | `orbis fetch <url>` | stdout | Shell scripts, cron jobs, RAG ingestion |

## Getting help

- Bugs and feature requests: open an issue using the templates in [`.github/ISSUE_TEMPLATE`](../.github/ISSUE_TEMPLATE/).
- Security vulnerabilities: follow [SECURITY.md](../SECURITY.md). Do not open a public issue.
- Commercial licensing and enterprise support: [sales@memora.company](mailto:sales@memora.company).
- Product site: [orbis.memora.company](https://orbis.memora.company).
