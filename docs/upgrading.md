# Upgrading Orbis

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

This page explains how to move to a newer Orbis version and what changes between versions. The full list of changes is in the [changelog](../CHANGELOG.md).

## Contents

- [Which version do I have?](#which-version-do-i-have)
- [How to upgrade](#how-to-upgrade)
- [0.1.2 → 0.2.0](#012--020)
- [From 0.1.0 or 0.1.1](#from-010-or-011)
- [From the old package name (`@memoracompany/orbis`)](#from-the-old-package-name-memoracompanyorbis)
- [Renamed and deprecated names](#renamed-and-deprecated-names)
- [How Orbis versions work](#how-orbis-versions-work)

---

## Which version do I have?

| Where | Command | Shows |
| :--- | :--- | :--- |
| CLI | `npx @memoracompany/memora-orbis --version` | `0.2.0` |
| npm project | `npm ls @memoracompany/memora-orbis` | the installed version |
| Running server | `curl http://localhost:9222/json/version` | `"product": "Orbis/0.2.0"` |
| Python | `pip show memora-orbis` or `python -c "import orbis; print(orbis.__version__)"` | `0.2.0` |

## How to upgrade

**MCP clients** (Claude Desktop, Claude Code, Cursor, Windsurf, …): put the version in the package name, then restart your AI tool.

```json
"args": ["-y", "@memoracompany/memora-orbis@0.2.0", "--mcp"]
```

Without a version, `npx` can keep running an older copy it saved earlier. Writing the version (or `@latest`) makes sure you get the one you expect. A fixed version is the safer choice: you decide when to move to the next one.

**npm project:**

```bash
npm install @memoracompany/memora-orbis@0.2.0
```

**Global install:**

```bash
npm install -g @memoracompany/memora-orbis@0.2.0
```

**Python:**

```bash
pip install --upgrade memora-orbis==0.2.0
```

**Python and the server go together.** The Python package talks to a running Orbis server. Upgrade both to the same version. An older Python package still works with a newer server, but it won't recognise the firewall's error (it raises a plain `HTTPError` instead of `FirewallBlockedError`).

After upgrading, run `npx @memoracompany/memora-orbis@0.2.0 --eval https://example.com` once. If you see the page title and the action map, you're done.

---

## 0.1.2 → 0.2.0

**Upgrade soon.** 0.2.0 fixes several security problems of 0.1.x: a web page could make Orbis read files from the computer it runs on, page scripts could reach the host process, the API key was not checked, the server listened on every network interface, and cookies were sent to every site.

0.2.0 also fixes all known issues listed in 0.1.x's [limitations](./limitations.md#10-issues-fixed-in-020). Some of those fixes change behaviour you may rely on. Go through the table below.

### Changes that may need action

| Change | Who notices | What to do |
| :--- | :--- | :--- |
| **`page.click()` and `agent.act()` are now async** and follow links / submit forms | TypeScript code | Add `await`: `await agent.act('@3')`, `await page.click('#go')`. `agent.actAsync()` still works. |
| **`fillForm()` no longer submits by default** | Code that relied on the old default | Pass `true` (or the submit button): `agent.fillForm(fields, true)`, Python `fill_form(fields, submit=True)`, REST `"submit": true`. |
| **`OrbisAgent.connect(url)` returns a `RemoteOrbisAgent`** that drives the daemon; every method is async | TypeScript code that used `connect()` | `await` its methods (`await agent.snapshot()`). Before, `connect()` silently ran a local browser instead of using the daemon. |
| **The server listens on `127.0.0.1` only** when `--host` is `localhost` (the default) | Docker, Kubernetes, other machines connecting | Start it with `--host 0.0.0.0` and protect it (API key, firewall rules). |
| **The API key is checked** when `ORBIS_API_KEY` is set | Clients that set a key on the server but not in the client | Send `x-api-key`, `Authorization: Bearer` or `?apiKey=`. Python and TypeScript clients do this when given the key. |
| **Requests from web pages in a browser are refused** (no CORS) | Browser-based dashboards calling the daemon directly | Call it from a server, not from browser JavaScript. |
| **Session files** (`/orbis/session*`, MCP `memora_session`) must be `.json` files inside the server's folder | Scripts saving sessions elsewhere | Save inside the folder, or set `ORBIS_SESSION_DIR`. |
| **Cookies are kept per site** | Flows that relied on one site's cookie being sent to another | Set the cookie on the site that needs it. Old session files still load: their cookies are applied to the site in the file's `url`. |
| **Typed text is hidden from action maps** (`[FILLED]` instead of `value="..."`; passwords never shown) | Agents that read typed values back from the map | Read values from `snapshot.actions[n].value` in code, or with `extract()`. |
| **`orbis fetch` and `--eval` exit with code 1** on HTTP 4xx/5xx or failure | Scripts that expect 0 | Check the exit code, or ignore it in your script if you only want the output. |
| **`--obey-robots` honours `Crawl-delay`** (up to 60 s between requests to a site) | Crawlers using `--obey-robots` | Nothing; expect slower crawls of sites that set it. |
| **Python SDK waits 60 s** per call (was 15 s) | Code with its own short timeouts | Pass `OrbisAgent(url, timeout=...)` to change it. |
| **`--http-proxy` now sends traffic through the proxy** | Anyone who passed it (it used to do nothing) | Make sure the proxy is the one you want. |
| Page scripts can't load modules from a computed path (`import("./" + name)`) | Almost nobody: this only "worked" by reading local files | Nothing. The page's console shows the error. |
| The MCP server lists one more tool, `memora_firewall`, and runs tool calls one at a time | Setups that check the exact tool list | Update the list. |
| Newer MCP clients now get protocol version `2025-11-25` | Nobody, unless you test the handshake | Nothing. |
| **MCP `memora_eval` returns plain values** (strings as-is, other values as JSON) and awaits promises (up to 10 s), with the native engine too; errors are tool errors | Code that parsed the old `{type, value}` output | Read the result directly instead of its `value` field. |
| **`fillForm()` `success` can be `false`** when a field was not found or a requested submit did not happen | Code that treated every fill as a success | Check `success` and the `skipped` list. |
| **The WebDriver server requires the API key** when `ORBIS_API_KEY` is set (HTTP 401 without it) | Selenium and other WebDriver clients | Put the key in the URL: `http://orbis:KEY@host:port`, or send `x-api-key` / `Authorization: Bearer`. |

### New, and off until you turn it on

- **Prompt injection firewall:** `--firewall standard`. When it's on, page content reaches the model inside "untrusted content" tags, and some tools ask for your approval. If you parse MCP output yourself, expect the extra lines. See [prompt-injection-firewall.md](./prompt-injection-firewall.md).
- **Site rules:** `--allow-domain`, `--block-domain`, `--block-sensitive-domains`.
- **Activity log:** `--audit-log <file>`, checked with `orbis firewall verify`.

### Checklist

1. Upgrade the npm package and the Python package to 0.2.0.
2. Put `@0.2.0` in your MCP configuration and restart the AI tool.
3. TypeScript: add `await` to `act()`, `click()` and any `connect()` agent calls; pass `true` to `fillForm()` where you want a submit.
4. Servers in containers: add `--host 0.0.0.0`; if you use an API key, check every client sends it.
5. Optional: try the firewall in monitor mode first: `--firewall standard --firewall-mode monitor --audit-log ./orbis-activity.jsonl`.

---

## From 0.1.0 or 0.1.1

Everything in [0.1.2 → 0.2.0](#012--020) applies, plus these changes that arrived in 0.1.2:

| Change | Who notices | What to do |
| :--- | :--- | :--- |
| **The npm package was renamed** from `@memoracompany/orbis` to `@memoracompany/memora-orbis` | Everyone on npm | See [below](#from-the-old-package-name-memoracompanyorbis). |
| **CAPTCHA and bot-check pages are reported, not returned as content.** When a site answers with a challenge, a block page or HTTP 429, MCP tools return a short `# CHALLENGE DETECTED` message instead of the page. | Agents and scripts that visit protected sites | Nothing, usually. Your agent can tell the user, wait, or use `memora_handoff`. See [challenges.md](./challenges.md). |
| **Requests to that site pause for 60 seconds** after a challenge or a 429 (or as long as the site's `Retry-After` says). During the pause, requests to that site fail straight away. | Scrapers that retry quickly | To turn the pause off: `--challenge-cooldown 0` (TypeScript: `network: { challengeCooldownSec: 0 }`). |
| New errors for challenges | Code that catches errors | Python: `ChallengeCooldownError`, `ChallengeDetectedError`. HTTP API: `429` with `Retry-After`, or `409` with `--on-challenge stop`. TypeScript: the same class names. |
| New MCP tool `memora_handoff` | Setups that check the exact tool list | Update the list. |

---

## From the old package name (`@memoracompany/orbis`)

Versions up to 0.1.1 were published on npm as `@memoracompany/orbis`. From 0.1.2 the package is `@memoracompany/memora-orbis`. The old name gets no updates.

```bash
npm uninstall @memoracompany/orbis
npm install @memoracompany/memora-orbis@0.2.0
```

Then change your imports:

```diff
- import { OrbisAgent } from '@memoracompany/orbis';
+ import { OrbisAgent } from '@memoracompany/memora-orbis';
```

…and the MCP configuration: `"@memoracompany/orbis"` → `"@memoracompany/memora-orbis@0.2.0"`. The Python package was always `memora-orbis`.

## Renamed and deprecated names

These still work, but switch to the new name when you can:

| Old name | Use instead | Status |
| :--- | :--- | :--- |
| `memora-browser` command | `orbis` | Prints a warning; will be removed in 2.0 |
| `MemoraAgent` | `OrbisAgent` | Deprecated alias |
| `MemoraBrowser` | `OrbisBrowser` | Deprecated alias |
| `orbis_*` MCP tool names (`orbis_browse`, …) | `memora_*` (`memora_browse`, …) | Both work; `memora_*` is what the server lists |

## How Orbis versions work

Orbis follows [Semantic Versioning](https://semver.org) for versions below 1.0:

- **Patch** (0.2.0 → 0.2.1): fixes only. Safe to take.
- **Minor** (0.1.x → 0.2.0): new features, and default behaviour may change. Each minor version gets a section on this page.
- Anything removed is first marked deprecated, with a warning, in an earlier version.

Fix the version you use (`@0.2.0`, `memora-orbis==0.2.0`), read this page before moving to the next minor version, and watch the [changelog](../CHANGELOG.md).
