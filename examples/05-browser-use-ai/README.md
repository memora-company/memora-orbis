# Example 05: A Python AI Browsing Agent (and Browser-Use Notes)

A complete Python agent that browses with Orbis and reasons with Claude. The model gets three tools (`browse`, `act`, `page_changes`) backed by an Orbis daemon through the [Python SDK](../../docs/python-sdk.md). The example uses a plain tool-use loop you can adapt to any framework.

## Run it

Requirements: Node.js 20+ (for the daemon) and Python 3.10+ (the current `anthropic` SDK needs 3.10).

```bash
# 1. Start Orbis (separate terminal)
npx -y @memoracompany/memora-orbis --port 9222

# 2. Install and run
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...          # or run `ant auth login` once
python agent_demo.py "Open https://news.ycombinator.com and tell me the top 3 story titles"
```

Try the tools without calling a model (no API key needed, good for CI):

```bash
python agent_demo.py --dry-run
```

## How it works

| Piece | What it does | Why |
| :--- | :--- | :--- |
| `compact_map()` | Sends `[@id] role "text" -> absolute href` lines, at most 120 | Full `actionMapText` includes long CSS selectors; on link-heavy pages it can be larger than the raw HTML |
| `browse(url)` | `orbis.goto()` then compact map + first 3,000 characters of Markdown | Gives the model both "what can I do" and "what does the page say" |
| `act(target, text)` | `orbis.act()`: types when `text` is set, otherwise dispatches a click | The REST act endpoint does not follow plain links, so the tool description tells the model to `browse` an href instead |
| `page_changes()` | `orbis.diff()` summary | Cheap follow-up context after an action |
| Loop | Returns all tool results in one message, reports failures with `is_error`, stops on `refusal`, `max_tokens` or after 15 turns | Predictable cost and clean failure modes |
| Fallbacks | `fallbacks="default"` with the `server-side-fallback-2026-07-01` beta | If the model declines, the API retries on a fallback model in the same call. Remove both lines to opt out |
| System prompt | Tells the model that page content is data, not instructions | Basic protection against prompt injection from web pages |

## Production notes

- **One daemon per concurrent agent.** All Python clients of a daemon share its single default page.
- **Never let the model type secrets.** Typed values appear in later action maps and diffs. Log in from code or restore a saved session. See [Sessions and authentication](../../docs/sessions-and-auth.md).
- **Isolate the browser.** Page JavaScript runs in a Node.js `vm` context, which is not a security boundary. When the agent can visit arbitrary URLs, run the daemon in a container without secrets. See [Security](../../docs/security.md).
- **Budget tokens.** Keep `MAX_MARKDOWN_CHARS` and the action limit small; add `focus_selector` / `exclude_selectors` via `orbis.snapshot()` for known sites.

## Using Browser-Use with Orbis

[Browser-Use](https://github.com/browser-use/browser-use) can be pointed at any CDP endpoint, including Orbis (`http://localhost:9222`). Treat this as **experimental and unverified** in 0.1.0:

- Browser-Use relies on screenshots for vision, and Orbis returns a 1x1 placeholder image. Disable vision.
- It uses CDP domains and DOM layout information that Orbis does not implement (unknown CDP methods return an empty result), so element detection and clicking may fail.
- Pages that need a full browser engine will not render in Orbis.

If you try it, start the daemon, point Browser-Use's CDP URL setting at `http://localhost:9222` (the exact parameter name depends on your Browser-Use version), and check results on your target sites before relying on it. For a dependable agent, use the Orbis tools directly as in this example. More options: [Agent frameworks](../../docs/integrations.md).
