# `memora-orbis` — Python SDK for Orbis

The Python SDK for [Orbis by Memora](https://orbis.memora.company), the lightweight headless browser for AI agents. It is a small HTTP client (standard library only) that talks to an Orbis daemon running on Node.js, and returns pages as a numbered action map plus Markdown.

Applies to: `memora-orbis` 0.1.0. Full reference: [docs/python-sdk.md](../docs/python-sdk.md).

## Install

```bash
pip install memora-orbis
```

Requires Python 3.9 or newer, and Node.js 20 or newer for the daemon.

## Quickstart

Start the daemon (separate terminal):

```bash
npx -y @memoracompany/orbis --port 9222
```

```python
from orbis import OrbisAgent

agent = OrbisAgent.connect("http://localhost:9222")

snap = agent.goto("https://news.ycombinator.com")
print(snap.title, snap.interactive_count, snap.token_estimate)
print(snap.action_map_text[:1000])

# Type into a field, or pick an option in a <select>
agent.act("label:Email", "dev@example.com")
agent.act("label:Country", "India")

# Click (dispatches a click event; to follow a link, goto() its href)
agent.act("text=Submit")

# What changed? -> {"diff": {...}, "currentSnapshot": {...}}
print(agent.diff()["diff"]["summary"])

# Fill several fields and submit (submit=True is the default)
result = agent.fill_form({"label:Email": "dev@example.com", "label:Password": "..."}, submit=True)
print(result["submitted"], result["url"])
```

## API summary

| Method | Returns | Notes |
| :--- | :--- | :--- |
| `OrbisAgent.connect(base_url, api_key=None)` | `OrbisAgent` | Checks `GET /json/version` (5 s timeout) |
| `goto(url)` | `OrbisSnapshot` | Always uses the daemon's default page |
| `snapshot(focus_selector=None, exclude_selectors=None)` | `OrbisSnapshot` | |
| `markdown()` | `str` | |
| `diff()` | `dict` | `{"diff": {...}, "currentSnapshot": {...}}` |
| `act(target, text=None)` | `dict` | `{"success": bool, "snapshot": {...}}` |
| `fill_form(fields, submit=True)` | `dict` | Submits by default |
| `save_session(path)` / `load_session(path)` | `dict` | Paths are on the **daemon's** machine |
| `select_option(target, value)` | — | **Broken in 0.1.0** (HTTP 404). Use `act(target, value)` on the `<select>` |
| `to_browser_use()` / `to_langchain_tools()` | `dict` / list | See [Agent frameworks](../docs/integrations.md) |

`OrbisSnapshot` fields: `url`, `title`, `markdown`, `action_map_text`, `actions`, `token_estimate`, `interactive_count`, `raw`.

## Production notes

- All clients of one daemon share **one page**. Run one daemon per concurrent agent or worker.
- Requests use fixed timeouts (15 s for most calls), while page loads may take up to 20 s. Catch `urllib.error.URLError` / `TimeoutError` and retry.
- The daemon has no enforced authentication in 0.1.0 and listens on all interfaces. Keep it on a private network. See [Security](../docs/security.md).

## License

Commercial & Community Evaluation License. See [LICENSE.md](../LICENSE.md). Production use requires a commercial license: [sales@memora.company](mailto:sales@memora.company).
