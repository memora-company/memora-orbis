# Use-Case Cookbook

These are production-style recipes for Orbis. Each one covers the problem, when Orbis fits it (and when it doesn't), complete code, the output you should expect, and notes for running it in production. Unless a recipe says otherwise, every TypeScript sample was type-checked against the 0.1.0 type definitions and run end to end against local fixture pages that mimic the target sites. The **Verified** line on each recipe says exactly what was run.

Applies to: Orbis 0.1.1 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Before you start: is the page a good fit?](#before-you-start-is-the-page-a-good-fit)
- [Running the samples](#running-the-samples)
- [1. LLM research agent with Claude tool use](#1-llm-research-agent-with-claude-tool-use)
- [2. Documentation ingestion for RAG](#2-documentation-ingestion-for-rag)
- [3. SEO and metadata audit](#3-seo-and-metadata-audit)
- [4. Price and stock monitoring](#4-price-and-stock-monitoring)
- [5. Log in once, reuse the session](#5-log-in-once-reuse-the-session)
- [6. Multi-step forms and dependent dropdowns](#6-multi-step-forms-and-dependent-dropdowns)
- [7. QA smoke tests in CI with Selenium](#7-qa-smoke-tests-in-ci-with-selenium)
- [8. Migrating a Playwright scraper over CDP](#8-migrating-a-playwright-scraper-over-cdp)
- [9. Browsing for coding assistants via MCP](#9-browsing-for-coding-assistants-via-mcp)
- [10. Compliance-friendly crawling](#10-compliance-friendly-crawling)
- [11. Parallel exploration with fork()](#11-parallel-exploration-with-fork)
- [12. Company contact-page extraction](#12-company-contact-page-extraction)
- [13. Status-page monitoring from cron](#13-status-page-monitoring-from-cron)
- [Related documents](#related-documents)

## Before you start: is the page a good fit?

Orbis's native engine parses HTML and runs page JavaScript in a sandbox. It has no rendering engine, no layout and no CSSOM, and many browser APIs are missing (see [limitations.md](limitations.md)). That makes it strongest on **server-rendered HTML**: documentation sites, blogs, news, server-rendered e-commerce pages, internal admin tools and classic forms. Heavy client-rendered single-page apps often don't render at all.

Spend 30 seconds checking a target before you build on it:

```bash
npx -y @memoracompany/memora-orbis fetch https://target.example.com/page --dump action_map
npx -y @memoracompany/memora-orbis fetch https://target.example.com/page --dump markdown --dump-max-bytes 2000
```

If the action map and the Markdown contain what a person would see, Orbis fits. If they're empty or show only a loading shell, check the page's script errors from the SDK:

```ts
await page.goto(url);
console.log(page.getLogs().filter(l => l.type === 'error'));
```

Errors such as `XMLHttpRequest is not defined` or `Cannot set properties of undefined (setting 'display')` mean the page needs browser APIs Orbis doesn't implement. For those pages, use the MCP server's Chrome engine (`--engine chrome`, [mcp.md](mcp.md)) or a real browser.

The engine also doesn't support `<iframe>` content, canvas or WebGL, screenshots (a 1Ã—1 placeholder is returned), file uploads, `alert()`/`confirm()`, WebSockets or Workers.

## Running the samples

```bash
mkdir orbis-recipes && cd orbis-recipes
npm init -y && npm pkg set type=module
npm install @memoracompany/memora-orbis
npm install -D tsx typescript @types/node
npx tsx price-watch.ts
```

The samples use `new OrbisBrowser()` and `new OrbisAgent(browser, page)` instead of `OrbisAgent.launch()`. `launch()` also starts a CDP server, which listens on all network interfaces with no authentication enforced (see [security.md](security.md)). A script that only drives pages in-process doesn't need that open port.

Python samples need a running daemon (`npx -y @memoracompany/memora-orbis --port 9222 --host 127.0.0.1`) and `pip install memora-orbis`. See [python-sdk.md](python-sdk.md).

---

## 1. LLM research agent with Claude tool use

**Problem.** An assistant must answer questions by reading live web pages: open a page, follow links, fill a search box, and cite where each fact came from.

**Why Orbis fits.** Each page becomes a numbered action list (`@1`, `@2`, â€¦) plus Markdown, so the model chooses an ID instead of writing selectors. After an action, `diff().summary` reports only what changed, which keeps follow-up turns small.

**When it doesn't fit.** Client-rendered apps that don't render in the native engine (see above), and tasks that need visual judgement (charts, images, layout).

**Verified.** The `browser-tools.ts` tool layer was run with scripted tool calls against fixtures (browse, type into email and password, submit, follow a link, unknown IDs), including the password scrubbing. The Claude loop follows the official SDK's tool-use shapes but was not run against the API.

`browser-tools.ts`. This tool layer is independent of the LLM provider:

```ts
// browser-tools.ts â€” Orbis-backed tools for an LLM agent
import { OrbisAgent, OrbisBrowser, type SemanticPageSnapshot } from '@memoracompany/memora-orbis';

const MAX_VIEW_CHARS = 12_000; // hard cap on what one tool result may add to the context
const NOISE = ['nav', 'footer', 'aside', '.cookie-banner', '[role="banner"]']; // stripped from page content

export function createBrowserTools() {
  // In-process engine: no CDP server, no open port
  const browser = new OrbisBrowser();
  const agent = new OrbisAgent(browser, browser.newPage());

  // Values typed into password fields show up in later action maps and diffs
  // (as the element's text and value). Scrub them from everything the model sees.
  const secrets = new Set<string>();
  const scrub = (text: string) => {
    for (const s of secrets) text = text.split(s).join('[REDACTED]');
    return text.slice(0, MAX_VIEW_CHARS);
  };

  // Compact action map without CSS selectors: on link-heavy pages the selectors
  // in actionMapText can outweigh the page content itself
  const compactMap = (snap: SemanticPageSnapshot) =>
    snap.actions
      .filter(a => !a.disabled)
      .map(a => `[${a.actionId}] ${a.role}${a.isInput && a.type ? `(${a.type})` : ''} "${a.text}"${a.href ? ` -> ${a.href}` : ''}`)
      .join('\n');

  // Action IDs must come from an UNFILTERED snapshot: act()/activate() resolve @N against the
  // whole page, so focus/exclude filters are applied to the Markdown only.
  const view = (snap: SemanticPageSnapshot) =>
    scrub(`URL: ${snap.url}\nTitle: ${snap.title}\n\nActions:\n${compactMap(snap)}\n\n--- Page content ---\n${agent.markdown({ excludeSelectors: NOISE })}`);

  async function run(name: string, input: any): Promise<string> {
    switch (name) {
      case 'browse': {
        const { status } = await agent.page.goto(input.url, { timeoutMs: 20_000 });
        return `HTTP ${status}\n` + view(agent.snapshot());
      }
      case 'click': {
        // activate() = browser default action: follows links, submits forms, toggles checkboxes
        const navigated = await agent.page.activate(input.actionId);
        if (navigated) return view(agent.snapshot());
        return scrub(agent.diff().summary);
      }
      case 'type': {
        const target = agent.page.resolveElement(input.actionId);
        if (!target) return `No element matches ${input.actionId}. Call "look" to get fresh action IDs.`;
        if (target.getAttribute('type') === 'password' && input.text) secrets.add(input.text);
        agent.act(input.actionId, input.text);
        return scrub(agent.diff().summary);
      }
      case 'look':
        return view(agent.snapshot());
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }

  return { run, close: () => agent.close() };
}
```

`research-agent.ts`. The Claude tool-use loop:

```ts
// research-agent.ts â€” Claude drives Orbis through tool use
import Anthropic from '@anthropic-ai/sdk';
import { createBrowserTools } from './browser-tools.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const browserTools = createBrowserTools();

const tools: Anthropic.Tool[] = [
  {
    name: 'browse',
    description: 'Open a URL. Returns the page action map ([@N] entries) and the page content as Markdown.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'click',
    description: 'Click an element by its action ID from the MOST RECENT action map (e.g. "@3"). Follows links and submits forms.',
    input_schema: { type: 'object', properties: { actionId: { type: 'string' } }, required: ['actionId'] },
  },
  {
    name: 'type',
    description: 'Type text into an input by its action ID from the most recent action map.',
    input_schema: {
      type: 'object',
      properties: { actionId: { type: 'string' }, text: { type: 'string' } },
      required: ['actionId', 'text'],
    },
  },
  {
    name: 'look',
    description: 'Re-read the current page and get fresh action IDs. Use after any change you are unsure about.',
    input_schema: { type: 'object', properties: {} },
  },
];

const SYSTEM = `You are a research assistant with a text-only web browser.
- Action IDs like @3 are only valid for the action map you received most recently.
- After "click" or "type" you receive a diff; call "look" if you need fresh IDs.
- Cite the URL of every fact you report. Stop as soon as you can answer.`;

export async function research(task: string, maxTurns = 15): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }];
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-5-5',
        max_tokens: 2048,
        system: SYSTEM,
        tools,
        messages,
      });
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        return response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n');
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const output = await browserTools.run(block.name, block.input);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
        } catch (err: any) {
          // Navigation timeouts, DNS failures, robots.txt blocks, unknown action IDs...
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return 'Stopped: turn budget exhausted.';
  } finally {
    await browserTools.close();
  }
}

// Example run
console.log(await research('What are the system requirements listed at https://docs.example.com/guide ?'));
```

**Expected output.** Each `browse`/`look` result looks like this:

```text
HTTP 200
URL: https://docs.example.com/guide
Title: Install Guide

Actions:
[@1] link "API" -> /docs/api
[@2] input(email) "[Untitled input]"
[@3] button "Sign in"

--- Page content ---
# Installing Acme
...
```

Clicks that don't navigate, and typing, return a diff:

```text
=== PAGE STATE DELTA ===

Mutated (1 elements):
  * [@2] [input] "[REDACTED]" (text: "[Untitled input]" -> "[REDACTED]", value: undefined -> "[REDACTED]")
```

**Python variant.** Python goes through the daemon's REST API. In 0.1.0, `act()` doesn't follow links or submit forms, so the tool layer navigates explicitly. The `/orbis/act` endpoint also resets the diff baseline, so the tool reads a fresh snapshot instead of calling `diff()`.

```python
# browser_tools.py â€” the same tool layer in Python, through a running Orbis daemon
import os
from urllib.parse import urljoin

from orbis import OrbisAgent

MAX_VIEW_CHARS = 12_000


class BrowserTools:
    def __init__(self, base_url: str = os.environ.get("ORBIS_URL", "http://127.0.0.1:9222")):
        # One daemon per worker: every client of a daemon shares its default page
        self.agent = OrbisAgent.connect(base_url)
        self.last = None  # most recent OrbisSnapshot
        self.secrets: set[str] = set()  # values typed into password fields

    def _scrub(self, text: str) -> str:
        for secret in self.secrets:
            text = text.replace(secret, "[REDACTED]")
        return text[:MAX_VIEW_CHARS]

    def _view(self, snap) -> str:
        self.last = snap
        # Compact action map without CSS selectors
        actions = "\n".join(
            f'[{a["actionId"]}] {a["role"]} "{a["text"]}"' + (f' -> {a["href"]}' if a.get("href") else "")
            for a in snap.actions
            if not a.get("disabled")
        )
        return self._scrub(
            f"URL: {snap.url}\nTitle: {snap.title}\n\nActions:\n{actions}\n\n--- Page content ---\n{snap.markdown}"
        )

    def _action(self, action_id: str):
        return next((a for a in (self.last.actions if self.last else []) if a["actionId"] == action_id), None)

    def run(self, name: str, args: dict) -> str:
        if name == "browse":
            return self._view(self.agent.goto(args["url"]))
        if name == "look":
            return self._view(self.agent.snapshot())
        if name == "click":
            action = self._action(args["actionId"])
            if action and action.get("href") and not action["href"].startswith(("#", "javascript:")):
                # 0.1.0: act() dispatches a click event but does not follow links; navigate explicitly
                return self._view(self.agent.goto(urljoin(self.last.url, action["href"])))
            if action and action.get("type") == "submit":
                # ...and does not submit forms; fill_form with a submit target does
                self.agent.fill_form({}, submit=args["actionId"])  # type: ignore[arg-type]
                return self._view(self.agent.snapshot())
            self.agent.act(args["actionId"])
            return self._view(self.agent.snapshot())
        if name == "type":
            action = self._action(args["actionId"])
            if action and action.get("type") == "password":
                self.secrets.add(args["text"])
            result = self.agent.act(args["actionId"], args["text"])
            if not result.get("success"):
                return f"No element matches {args['actionId']}. Call look for fresh action IDs."
            # /orbis/act snapshots the page after acting, which resets the diff baseline:
            # read the new state instead of calling diff()
            return self._view(self.agent.snapshot())
        raise ValueError(f"Unknown tool {name}")
```

```python
# research_agent.py
import anthropic
from browser_tools import BrowserTools

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
TOOLS = [
    {"name": "browse", "description": "Open a URL. Returns numbered actions and Markdown.",
     "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    {"name": "click", "description": "Click an element by action ID from the most recent action list (e.g. \"@3\").",
     "input_schema": {"type": "object", "properties": {"actionId": {"type": "string"}}, "required": ["actionId"]}},
    {"name": "type", "description": "Type text into an input by action ID.",
     "input_schema": {"type": "object", "properties": {"actionId": {"type": "string"}, "text": {"type": "string"}},
                      "required": ["actionId", "text"]}},
    {"name": "look", "description": "Re-read the current page and get fresh action IDs.",
     "input_schema": {"type": "object", "properties": {}}},
]
SYSTEM = "You are a research assistant with a text-only browser. Action IDs are only valid for the latest action list. Cite URLs."


def research(task: str, max_turns: int = 15) -> str:
    browser = BrowserTools()
    messages = [{"role": "user", "content": task}]
    for _ in range(max_turns):
        resp = client.messages.create(model="claude-sonnet-5-5", max_tokens=2048,
                                      system=SYSTEM, tools=TOOLS, messages=messages)
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            return "".join(b.text for b in resp.content if b.type == "text")
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            try:
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": browser.run(block.name, block.input)})
            except Exception as err:  # urllib.error.HTTPError on failed navigations, timeouts, ...
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": f"Error: {err}", "is_error": True})
        messages.append({"role": "user", "content": results})
    return "Stopped: turn budget exhausted."


if __name__ == "__main__":
    print(research("What are the system requirements listed at https://docs.example.com/guide ?"))
```

**Production notes.**

- **Secrets leak into snapshots.** A value typed into a field becomes that element's `text` and `value` in later action maps and diffs, and that includes passwords. Fill credentials in code (recipe 5), or scrub them as the samples do. Don't let the model type passwords it shouldn't see.
- **Token cost.** The full `actionMapText` includes a CSS selector on every line. On link-heavy real pages that can be larger than the raw HTML. Use a compact map as shown, apply `excludeSelectors`/`focusSelector` to the Markdown, and keep a hard character cap. See [best-practices.md](best-practices.md#2-token-budgeting).
- **Take IDs from unfiltered snapshots.** `act()`/`activate()` resolve `@N` against the whole page. A snapshot taken with `focusSelector` or `excludeSelectors` numbers elements differently, and the model would click the wrong thing. That's why `view()` filters only the Markdown.
- **Use `activate()` for clicks.** `agent.act('@3')` only dispatches a click event. It doesn't follow links or submit forms. `agent.page.activate('@3')` does.
- **Untrusted content.** Page text reaches the model, so treat it as prompt-injection input. Don't give the agent tools with side effects outside the browser without confirmation.
- **Isolation.** Page JavaScript runs in a Node `vm` context, which is not a security boundary. Run agents that visit arbitrary sites in a container that holds no secrets (see [security.md](security.md)).
- **Python daemons.** Every client of a daemon shares its default page. Run one daemon per worker.

---

## 2. Documentation ingestion for RAG

**Problem.** Keep a vector index of your product docs (or a vendor's public docs) current, with clean text, stable source URLs and heading-aware chunks.

**Why Orbis fits.** `getMarkdown()` turns server-rendered documentation into Markdown with headings, lists, tables and links. `focusSelector`/`excludeSelectors` drop navigation, footers and cookie banners. `getStructuredData()` gives you the canonical URL to use as a stable document ID.

**When it doesn't fit.** Docs sites that render their content entirely client-side (check with `--dump markdown` first), PDFs, and content inside iframes.

**Verified.** Run against fixture pages: two docs pages plus a 404, giving 4 chunks, with the canonical URL used as the ID and the 404 skipped.

```ts
// ingest-docs.ts â€” turn documentation pages into RAG-ready JSONL chunks
import { appendFileSync, writeFileSync } from 'node:fs';
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const URLS = (process.env.DOC_URLS ?? 'https://docs.example.com/guide,https://docs.example.com/api').split(',');
const OUT = process.env.OUT ?? 'docs.jsonl';
const DELAY_MS = Number(process.env.DELAY_MS ?? 1000); // be polite, even to your own docs site
const MAX_CHUNK_CHARS = 3000;

const browser = new OrbisBrowser({
  network: { userAgent: 'AcmeDocsIngest/1.0 (+https://acme.example/bot)', timeoutMs: 20_000 },
});

// Split Markdown on H1-H3 headings, then split oversized sections on paragraph boundaries
function chunk(markdown: string): string[] {
  const out: string[] = [];
  for (const section of markdown.split(/\n(?=#{1,3} )/)) {
    let buf = '';
    for (const para of section.split(/\n{2,}/)) {
      if (buf && buf.length + para.length > MAX_CHUNK_CHARS) { out.push(buf.trim()); buf = ''; }
      buf += para + '\n\n';
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

writeFileSync(OUT, '');
let written = 0;
for (const url of URLS) {
  const page = browser.newPage();
  try {
    const { status } = await page.goto(url, { timeoutMs: 20_000 });
    if (status >= 400) { console.warn(`skip ${url}: HTTP ${status}`); continue; }

    const markdown = page.getMarkdown({
      focusSelector: 'main, article',                       // first match wins; falls back to the whole page
      excludeSelectors: ['nav', 'footer', '.cookie-banner', 'aside', '[role="navigation"]'],
    });
    const meta = page.getStructuredData();
    const source = meta.canonical ?? page.url;

    chunk(markdown).forEach((text, i) => {
      appendFileSync(OUT, JSON.stringify({ id: `${source}#${i}`, source, title: page.title(), text }) + '\n');
      written++;
    });
  } catch (err: any) {
    console.error(`failed ${url}: ${err.message}`); // timeouts, DNS errors, robots.txt blocks
  } finally {
    browser.closePage(page.id);
  }
  await new Promise(r => setTimeout(r, DELAY_MS));
}
browser.close();
console.log(`wrote ${written} chunks to ${OUT}`);
```

**Expected output (`docs.jsonl`).**

```json
{"id":"https://docs.example.com/guide#0","source":"https://docs.example.com/guide","title":"Install Guide","text":"# Installing Acme\n\nRun the installer."}
{"id":"https://docs.example.com/guide#1","source":"https://docs.example.com/guide","title":"Install Guide","text":"## Requirements\n - Node 20+ - 2 GB RAM"}
```

**One-off pages from the shell.** Run this for a single page:

```bash
npx -y @memoracompany/memora-orbis fetch https://docs.example.com/guide --dump markdown > guide.md
```

The CLI has no focus or exclude options for Markdown. `--dump-selector main` returns the element's **raw text** (headings and paragraphs run together), not Markdown. Use the SDK, or the daemon's `GET /orbis/snapshot?format=markdown&focus=main&exclude=nav,footer` endpoint ([http-api.md](http-api.md)), when you need focused Markdown.

**Production notes.**

- `focusSelector` uses the **first** element that matches. If nothing matches, the whole page is used, so check chunk sizes after a site redesign.
- Markdown conversion is good but not perfect: short lists can collapse onto one line, as the expected output shows. Don't rely on exact formatting downstream.
- For third-party docs, turn on `obeyRobots` and identify your crawler (recipe 10). Rate-limit even your own docs site if it's behind a CDN with bot rules.
- Re-ingest by comparing a hash of each chunk's `text` so you only re-embed what changed.

---

## 3. SEO and metadata audit

**Problem.** Catch missing titles, descriptions, canonicals, Open Graph tags and JSON-LD before a release, and fail CI when something important is missing.

**Why Orbis fits.** `getStructuredData()` returns `title`, `description`, `canonical`, `openGraph`, `twitter`, other `meta` tags and parsed `jsonLd` blocks in one call. Metadata is in the server HTML, so no JavaScript has to run.

**When it doesn't fit.** Sites that inject meta tags client-side (some SPA frameworks without SSR). Orbis reports the server HTML, which is also what many crawlers see first. It doesn't measure Core Web Vitals, rendering or mobile layout.

**Verified.** Run against fixtures: a fully tagged product page produced no findings, and a bare page produced 2 errors and 4 warnings, so the script exited with code 1.

```ts
// seo-audit.ts â€” metadata checks for a list of URLs; exits 1 when any page has errors (CI-friendly)
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const URLS = (process.env.AUDIT_URLS ?? 'https://shop.example.com/product/1').split(',');
const browser = new OrbisBrowser();

type Finding = { url: string; level: 'error' | 'warn'; check: string; detail: string };
const findings: Finding[] = [];

for (const url of URLS) {
  const page = browser.newPage();
  try {
    const { status } = await page.goto(url, { timeoutMs: 20_000, settleTimeoutMs: 0 }); // metadata needs no JS settle
    const add = (level: Finding['level'], check: string, detail: string) => findings.push({ url, level, check, detail });
    if (status !== 200) add('error', 'status', `HTTP ${status}`);

    const sd = page.getStructuredData();
    const title = page.title().trim();
    if (!title) add('error', 'title', 'missing <title>');
    else if (title.length > 60) add('warn', 'title', `${title.length} chars (> 60)`);
    if (!sd.description) add('error', 'description', 'missing meta description');
    else if (sd.description.length > 160) add('warn', 'description', `${sd.description.length} chars (> 160)`);
    if (!sd.canonical) add('warn', 'canonical', 'no <link rel="canonical">');
    if (!sd.openGraph['og:title']) add('warn', 'og:title', 'missing');
    if (!sd.openGraph['og:image']) add('warn', 'og:image', 'missing');
    if (sd.jsonLd.length === 0) add('warn', 'json-ld', 'no JSON-LD blocks');

    const h1 = page.extract('h1', 'text');
    if (h1.length !== 1) add('warn', 'h1', `${h1.length} <h1> elements`);
  } catch (err: any) {
    findings.push({ url, level: 'error', check: 'fetch', detail: err.message });
  } finally {
    browser.closePage(page.id);
  }
}
browser.close();

console.table(findings);
process.exit(findings.some(f => f.level === 'error') ? 1 : 0);
```

**Expected output.**

```text
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ (index) â”‚ url                                â”‚ level   â”‚ check         â”‚ detail                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ 0       â”‚ 'https://shop.example.com/bare'    â”‚ 'error' â”‚ 'title'       â”‚ 'missing <title>'           â”‚
â”‚ 1       â”‚ 'https://shop.example.com/bare'    â”‚ 'error' â”‚ 'description' â”‚ 'missing meta description'  â”‚
â”‚ 2       â”‚ 'https://shop.example.com/bare'    â”‚ 'warn'  â”‚ 'canonical'   â”‚ 'no <link rel="canonical">' â”‚
...
```

**Shell version.** Pipe the structured data through `jq`:

```bash
npx -y @memoracompany/memora-orbis fetch https://shop.example.com/product/1 --dump structured_data \
  | jq '{title, description, canonical, og: .openGraph, types: [.jsonLd[]."@type"]}'
```

`structured_data` output shape (keys exactly as produced):

```json
{
  "url": "https://shop.example.com/product/1",
  "title": "Acme Kettle",
  "openGraph": { "og:title": "Acme Kettle", "og:image": "https://shop.example.com/k.jpg" },
  "twitter": { "twitter:card": "summary" },
  "meta": { "description": "A fast electric kettle." },
  "jsonLd": [ { "@context": "https://schema.org", "@type": "Product", "name": "Acme Kettle", "offers": { "...": "..." } } ],
  "description": "A fast electric kettle.",
  "canonical": "https://shop.example.com/product/1"
}
```

**Production notes.**

- Meta `name`/`property` keys are lower-cased. Invalid JSON-LD blocks are skipped silently, so validate JSON-LD separately if it matters.
- `settleTimeoutMs: 0` skips waiting for page scripts. That's fine for metadata and speeds up large audits.
- Audit staging with `--http-header "Authorization: Bearer â€¦"` or `network.headers`, never with production credentials pasted into scripts.

---

## 4. Price and stock monitoring

**Problem.** Track price and availability for a list of product pages and alert when either changes.

**Why Orbis fits.** Product pages are usually server-rendered and carry JSON-LD `Offer` data. `extract()` reads CSS-selected text in one call. The runs are short-lived processes that suit cron.

**When it doesn't fit.** Prices loaded by XHR after page load (`XMLHttpRequest` doesn't exist in the sandbox; `fetch()` does), prices shown as images, and sites whose terms forbid automated collection.

**Verified.** Two runs against a fixture product page. Run 1 printed `no changes` (and stored the baseline). After the fixture price changed, run 2 printed `129 -> 99.5 USD; stock "In stock" -> "Only 2 left"`.

```ts
// price-watch.ts â€” detect price / stock changes and notify a webhook
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const PRODUCTS = (process.env.PRODUCT_URLS ?? 'https://shop.example.com/product/1').split(',');
const STATE_FILE = process.env.STATE_FILE ?? 'price-state.json';
const WEBHOOK = process.env.ALERT_WEBHOOK; // e.g. a Slack incoming webhook

type Observation = { price: number | null; currency: string | null; stock: string | null; checkedAt: string };
const state: Record<string, Observation> = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const browser = new OrbisBrowser();
const changes: string[] = [];

function priceFromJsonLd(jsonLd: any[]): { price: number; currency: string | null } | null {
  for (const block of jsonLd.flatMap(b => (Array.isArray(b) ? b : [b]))) {
    const offer = Array.isArray(block?.offers) ? block.offers[0] : block?.offers;
    if (offer?.price !== undefined) return { price: Number(offer.price), currency: offer.priceCurrency ?? null };
  }
  return null;
}

for (const url of PRODUCTS) {
  const page = browser.newPage();
  try {
    await page.goto(url, { timeoutMs: 20_000 });
    // 1. Structured data is the most stable source; 2. fall back to a CSS selector
    const ld = priceFromJsonLd(page.getStructuredData().jsonLd);
    const cssText: string | undefined = page.extract('.price', 'text', 1)[0];
    const price = ld?.price ?? (cssText ? Number(cssText.replace(/[^0-9.]/g, '')) : null);
    const stock: string | null = page.extract('.stock', 'text', 1)[0] ?? null;

    const now: Observation = { price, currency: ld?.currency ?? null, stock, checkedAt: new Date().toISOString() };
    const before = state[url];
    if (price === null) changes.push(`${url}: price not found (selector or markup changed?)`);
    else if (before && (before.price !== now.price || before.stock !== now.stock)) {
      changes.push(`${url}: ${before.price} -> ${now.price} ${now.currency ?? ''}; stock "${before.stock}" -> "${now.stock}"`);
    }
    state[url] = now;
  } catch (err: any) {
    changes.push(`${url}: check failed (${err.message})`);
  } finally {
    browser.closePage(page.id);
  }
}
browser.close();
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

if (changes.length) {
  console.log(changes.join('\n'));
  if (WEBHOOK) await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: changes.join('\n') }) });
} else {
  console.log('no changes');
}
```

**Expected output.**

```text
https://shop.example.com/product/1: 129 -> 99.5 USD; stock "In stock" -> "Only 2 left"
```

**Production notes.**

- Prefer structured data over CSS selectors. Selectors break on redesigns, and the sample reports `price not found` so you notice.
- Run it every 15â€“60 minutes, not every minute. Pages rarely change faster, and frequent polling invites blocking.
- Keep `price-state.json` on durable storage. Concurrent runs need a lock (`flock` on Linux).
- Check the retailer's terms of service and robots.txt. Add `network: { obeyRobots: true, robotsAgent: 'â€¦' }` for third-party sites.

---

## 5. Log in once, reuse the session

**Problem.** A nightly report needs numbers from an internal dashboard behind a login form. Logging in on every run is slow and trips lockout policies.

**Why Orbis fits.** `fillForm()` fills the form by label and submits it. Redirect cookies (`Set-Cookie` on a 302) are captured, and `saveSession()`/`loadSession()` persist them to a JSON file.

**When it doesn't fit.** Login flows with CAPTCHAs, WebAuthn/passkeys, SSO through pages that need missing browser APIs, and apps that keep the auth token in `localStorage` (see the known issue below). Prefer an API token if the app has one.

**Verified.** Run against a fixture login. Run 1 logged in and saved the session. Run 2, with no credentials in the environment, reused the session file. Wrong credentials raised `login rejected (still on /login)`.

```ts
// dashboard-report.ts â€” log in once, reuse the saved session on later runs
import { chmodSync, existsSync } from 'node:fs';
import { OrbisAgent, OrbisBrowser } from '@memoracompany/memora-orbis';

const BASE = process.env.DASH_URL ?? 'https://ops.internal.example.com';
const SESSION_FILE = process.env.SESSION_FILE ?? '.secrets/ops-dashboard-session.json';
const { DASH_USER, DASH_PASSWORD } = process.env; // from your secret manager, never from the LLM

const browser = new OrbisBrowser();
const agent = new OrbisAgent(browser, browser.newPage());

async function login(): Promise<void> {
  if (!DASH_USER || !DASH_PASSWORD) throw new Error('DASH_USER / DASH_PASSWORD are not set');
  await agent.page.goto(`${BASE}/login`);
  const result = await agent.fillForm(
    { 'label:Email': DASH_USER, 'label:Password': DASH_PASSWORD },
    'text=Sign in', // submit by clicking this button
  );
  if (result.skipped.length) throw new Error(`login form changed; fields not found: ${result.skipped.join(', ')}`);
  if (new URL(agent.page.url).pathname.startsWith('/login')) throw new Error('login rejected (still on /login)');
  agent.saveSession(SESSION_FILE);
  try { chmodSync(SESSION_FILE, 0o600); } catch { /* not supported on Windows */ }
}

try {
  if (existsSync(SESSION_FILE)) agent.loadSession(SESSION_FILE); // restores cookies + storage, does not navigate
  await agent.page.goto(`${BASE}/dashboard`);
  if (new URL(agent.page.url).pathname.startsWith('/login')) {  // session missing or expired
    await login();
    await agent.page.goto(`${BASE}/dashboard`);
  }

  const cells: string[] = agent.page.extract('#kpis td', 'text');
  const kpis = Object.fromEntries(cells.flatMap((c, i) => (i % 2 === 0 ? [[c, cells[i + 1]]] : [])));
  console.log(JSON.stringify({ url: agent.page.url, kpis }, null, 2));
} finally {
  await agent.close();
}
```

**Expected output.**

```json
{
  "url": "https://ops.internal.example.com/dashboard",
  "kpis": { "Open tickets": "42", "SLA": "99.2%" }
}
```

The session file is plain JSON:

```json
{ "version": 1, "createdAt": "2026-10-30T19:23:25.983Z", "url": "https://ops.internal.example.com/dashboard",
  "cookies": { "sid": "â€¦" }, "localStorage": {}, "sessionStorage": {} }
```

**Production notes.**

- **The session file is a credential.** Store it outside the repo (add `.secrets/` to `.gitignore`), make it readable only by the service account, or keep it in a secret store and write it to a temp file at start-up.
- Credentials come from the environment or a secret manager, never from an LLM tool call. If an LLM drives later steps, note that typed values appear in snapshots (recipe 1).
- Check `result.skipped`: when the login form changes, a field that isn't found is reported there instead of throwing.

> **Known issue (0.1.0):** The cookie jar ignores domain and path. Every stored cookie is sent to every host the page requests, including third-party scripts and redirects to other domains. Each page has its own jar, so use a separate page (`browser.newPage()`) per site, and never load a session file for one site into a page that visits others.

> **Known issue (0.1.0):** `localStorage`/`sessionStorage` are reset on every navigation in the native engine. Restoring a session therefore only helps **cookie-based** logins. A token kept in `localStorage` is gone after the next `goto()`.

---

## 6. Multi-step forms and dependent dropdowns

**Problem.** Complete a registration wizard where choosing a country fills a State dropdown, then a second step asks for company details and consent.

**Why Orbis fits.** `selectOption()` picks options by value or visible text and fires `input`/`change`, so the page's `onchange` handler runs. `diff()` shows the newly revealed dropdown. `fillForm({ steps })` chains "fill, click Next, fill, click Finish" in one call.

**When it doesn't fit.** Wizards built on custom JavaScript widgets that need layout or CSSOM (`element.style`, `getComputedStyle`), `XMLHttpRequest` or framework internals. Check `page.getLogs()` for errors first.

**Verified.** Run against a fixture wizard. The State dropdown appeared after choosing India, both steps were filled, and the final GET submission was `?fullName=Priya+Sharma&country=IN&state=MH&company=Acme+Ltd&terms=on`.

```ts
// register-wizard.ts â€” dependent dropdowns + a two-step form
import { OrbisAgent, OrbisBrowser } from '@memoracompany/memora-orbis';

const URL_ = process.env.WIZARD_URL ?? 'https://portal.example.com/wizard';
const browser = new OrbisBrowser();
const agent = new OrbisAgent(browser, browser.newPage());

try {
  await agent.goto(URL_); // also records the baseline snapshot for diff()

  // 1. Pick the parent value; the page's onchange handler builds the dependent <select>.
  //    0.1.0 workaround: page scripts read select.value from the value attribute, so set it first.
  const country = agent.page.resolveElement('label:Country');
  if (!country) throw new Error('Country field not found');
  country.value = 'IN';
  if (!agent.selectOption('label:Country', 'India')) throw new Error('Country option not found');
  const delta = agent.diff();
  console.log(delta.summary); // shows the State <select> appearing and Country's mutation

  // 2. The dependent dropdown now exists; target it by label, not by @ID
  if (!agent.selectOption('label:State', 'Maharashtra')) {
    // Usually a page-script failure: Orbis has no layout/CSSOM APIs (see limitations.md)
    console.error(agent.page.getLogs());
    throw new Error('State option not found');
  }

  // 3. Remaining steps in one call: fill, click "Next", fill, tick terms, click "Finish"
  const result = await agent.page.fillForm({
    steps: [
      { fields: { 'label:Full name': 'Priya Sharma' }, submit: 'text=Next' },
      { fields: { 'label:Company': 'Acme Ltd', '#terms': 'true' }, submit: 'text=Finish' },
    ],
  });
  console.log({ filled: result.filled, skipped: result.skipped, submitted: result.submitted, url: result.url });
  if (result.skipped.length) throw new Error(`fields not found: ${result.skipped.join(', ')}`);
} finally {
  await agent.close();
}
```

**Expected output.**

```text
=== PAGE STATE DELTA ===

Added (1 elements):
  + [@3] [select] "DelhiMaharashtra" (selector: #state)

Mutated (1 elements):
  * [@2] [select] "IN" (text: "-- Choose --IndiaUnited States" -> "IN", value: undefined -> "IN")
{
  filled: [ 'label:Full name', 'label:Company', '#terms' ],
  skipped: [],
  submitted: true,
  url: 'https://portal.example.com/wizard/done?fullName=Priya+Sharma&country=IN&state=MH&company=Acme+Ltd&terms=on'
}
```

> **Known issue (0.1.0):** In page JavaScript, `select.value` reads the `<select>`'s `value` attribute, not the selected option. `selectOption()` marks the option as selected and fires `change`, but a handler doing `update(this.value)` receives `''`. The sample works around this by setting the attribute first (`country.value = 'IN'`). Alternatives: call the page's own function with `page.evaluate("updateStates('IN')")`, or submit the step and read the server-rendered next page. Native form submission always sends the selected option correctly.

> **Known issue (0.1.0):** Elements have no `style`, `dataset` or `innerText` properties for page scripts on the SDK, MCP-native and WebDriver paths, so a handler such as `box.style.display = 'block'` throws. If expected fields never appear, `page.getLogs()` shows the error. The fixture in this recipe toggles visibility with the `hidden` attribute.

**Production notes.**

- Target dependent fields by label (`label:State`), not by `@ID`. IDs are renumbered whenever elements appear or disappear.
- `page.fillForm()` only submits when you pass `submit`. `agent.fillForm(fields)` submits **by default** (its second argument defaults to `true`).
- For a `<select>`, `fillForm` matches an option by exact `value` or exact text. `selectOption` also accepts a substring of the text.
- Checkboxes and radios take `'true' | '1' | 'yes' | 'checked' | 'on'` to check. Any other value unchecks.

---

## 7. QA smoke tests in CI with Selenium

**Problem.** Run a handful of smoke tests (login works, key pages load, links aren't broken) on every pull request without installing Chrome and chromedriver in CI.

**Why Orbis fits.** `orbis serve --protocol webdriver` speaks W3C WebDriver, so the standard Selenium client works unchanged. Clicks on links and submit buttons navigate, as they would in a browser.

**When it doesn't fit.** Visual or layout assertions, screenshots (you get a placeholder image), alerts, iframes, shadow DOM, real file uploads, and front ends that need browser APIs Orbis lacks. Keep a real-browser suite for those, and use Orbis for the fast server-rendered smoke layer.

**Verified.** The same WebDriver command sequence was run against `orbis serve --protocol webdriver` with the Node Selenium client (`selenium-webdriver`): log in, submit, read the `<h1>`, follow a link by link text, and handle a missing element (`NoSuchElementError`). The pytest files below weren't executed in our environment.

`conftest.py`:

```python
import os

import pytest
from selenium import webdriver

ORBIS_WEBDRIVER_URL = os.environ.get("ORBIS_WEBDRIVER_URL", "http://127.0.0.1:4444")
APP_URL = os.environ.get("APP_URL", "http://127.0.0.1:3000")


@pytest.fixture
def app_url() -> str:
    return APP_URL


@pytest.fixture
def driver():
    drv = webdriver.Remote(command_executor=ORBIS_WEBDRIVER_URL, options=webdriver.ChromeOptions())
    drv.implicitly_wait(2)  # seconds; Orbis polls for the element until this expires
    yield drv
    drv.quit()  # always quit: the server caps concurrent sessions (--max-sessions, default 16)
```

`test_smoke.py`:

```python
import os

from selenium.webdriver.common.by import By


def test_login_reaches_dashboard(driver, app_url):
    driver.get(f"{app_url}/login")
    assert driver.title == "Sign in"
    driver.find_element(By.ID, "email").send_keys(os.environ["SMOKE_USER"])
    driver.find_element(By.CSS_SELECTOR, "input[type=password]").send_keys(os.environ["SMOKE_PASSWORD"])
    driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
    assert driver.current_url.endswith("/dashboard")
    assert driver.find_element(By.CSS_SELECTOR, "h1").text == "Ops dashboard"


def test_contact_link(driver, app_url):
    driver.get(app_url)
    driver.find_element(By.LINK_TEXT, "Contact us").click()
    assert driver.current_url.endswith("/contact-us")
```

`.github/workflows/smoke.yml`:

```yaml
name: smoke
on: [pull_request]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install selenium pytest
      - name: Start Orbis WebDriver server
        run: |
          npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 4444 --host 127.0.0.1 > orbis.log 2>&1 &
          curl --retry 20 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:4444/status
        env: { ORBIS_NO_TELEMETRY: '1' }
      - name: Start the app under test
        run: npm ci && (npm start > app.log 2>&1 &) && npx -y wait-on http://127.0.0.1:3000
      - run: pytest -q
        env:
          SMOKE_USER: ${{ secrets.SMOKE_USER }}
          SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}
      - if: failure()
        run: tail -n 200 orbis.log app.log
```

**Production notes.**

- `GET /status` returns `{"value":{"ready":true,â€¦}}` while there's session capacity left. Use it as the readiness check.
- Idle sessions are reaped after 5 minutes. A test that crashes before `quit()` holds a slot until then.
- `driver.get_screenshot_as_png()` succeeds but returns a placeholder image. Don't attach it to failure reports. Attach `driver.page_source` instead.
- `acceptInsecureCerts: true` in the capabilities skips TLS verification for self-signed staging certificates. Never use it against production.
- See [selenium-webdriver.md](selenium-webdriver.md) for the supported command list.

---

## 8. Migrating a Playwright scraper over CDP

**Problem.** You have Playwright scripts that read server-rendered pages, and you want to run more of them per machine.

**Why Orbis fits.** `chromium.connectOverCDP()` against the Orbis daemon keeps the script nearly unchanged. `goto`, `getByLabel().fill()`, `getByRole().click()`, `waitForURL` and `locator().allTextContents()` all worked in our test.

**When it doesn't fit.** Scripts that rely on screenshots, PDFs, request interception, downloads, iframes, or the visual state of the page.

**Verified.** The script below was run against a daemon (`orbis --port â€¦ --host 127.0.0.1`) and a fixture app. It printed `{ heading: 'Ops dashboard', values: [ '42', '99.2%' ] }`.

```ts
// scrape-dashboard.playwright.ts â€” an existing Playwright script, now pointed at Orbis
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'https://ops.internal.example.com';
const ORBIS_CDP_URL = process.env.ORBIS_CDP_URL ?? 'http://127.0.0.1:9222';

// Before: const browser = await chromium.launch();
const browser = await chromium.connectOverCDP(ORBIS_CDP_URL);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();

try {
  await page.goto(`${APP}/login`);
  await page.getByLabel('Email').fill(process.env.DASH_USER!);
  await page.locator('#password').fill(process.env.DASH_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 10_000 });

  const values = await page.locator('#kpis td.v').allTextContents();
  console.log({ heading: await page.locator('h1').textContent(), values });
} finally {
  await page.close();      // close what you opened...
  await browser.close();   // ...then disconnect (see the shared-daemon note below)
}
```

Start the daemon next to the job:

```bash
ORBIS_NO_TELEMETRY=1 npx -y @memoracompany/memora-orbis --port 9222 --host 127.0.0.1
```

**What to watch for (all observed on 0.1.0).**

| Playwright feature | Behaviour on Orbis |
| :--- | :--- |
| `page.route()` / request interception | Registers without error but the handler is **never called** |
| `context.cookies()` | Returned `[]` even though the session cookie was being sent |
| `page.on('console')` | No console events are forwarded |
| `page.screenshot()` | Returns a 1Ã—1 placeholder PNG (68 bytes) |
| `page.selectOption()` | Failed with `TypeError: Cannot read properties of undefined (reading 'replace')`. Use the Orbis SDK's `selectOption()` for select-heavy flows |
| Page JS using `element.style` | Works over CDP (a DOM compatibility layer is installed when a CDP client attaches), unlike the native SDK path |

**Production notes.**

- Run **one daemon per worker** and don't share a daemon between unrelated jobs. All CDP clients of a daemon share its page list and connection pool, and any client can read or close another client's pages.
- The daemon listens on all interfaces even with `--host 127.0.0.1` or `localhost`, and doesn't enforce an API key in 0.1.0. Firewall the port or isolate it in a container network (see [security.md](security.md) and [production-deployment.md](production-deployment.md)).
- Measure on your own pages before planning capacity. The only published comparison is a local test set (see [limitations.md](limitations.md) and [playwright-puppeteer.md](playwright-puppeteer.md)).

---

## 9. Browsing for coding assistants via MCP

**Problem.** You want Claude Code, Claude Desktop or Cursor to read your local dev server, documentation and issue pages while you code, and to click through flows in your app.

**Why Orbis fits.** `orbis --mcp` is a stdio MCP server with 15 tools (`memora_browse`, `memora_act`, `memora_fill_form`, `memora_diff`, `memora_extract`, â€¦). Pages come back as action maps plus Markdown instead of raw HTML.

**When it doesn't fit.** Inspecting visual layout and CSS issues, or a client-rendered dev server on the native engine. Use `--engine chrome` for SPAs.

**Verified.** The tool list (15 tools) was confirmed with `initialize` + `tools/list` against the 0.1.0 build. The client configurations below weren't tested in each client.

Claude Code:

```bash
claude mcp add orbis -e ORBIS_NO_TELEMETRY=1 -- npx -y @memoracompany/memora-orbis --mcp --engine chrome
```

Cursor (`.cursor/mcp.json` in the project) or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "orbis": {
      "command": "npx",
      "args": ["-y", "@memoracompany/memora-orbis", "--mcp", "--engine", "native"],
      "env": { "ORBIS_NO_TELEMETRY": "1" }
    }
  }
}
```

Example prompts:

- "Open http://localhost:3000/signup, fill the form with test data, submit it and tell me what error the page shows."
- "Browse http://localhost:3000/settings, focus on `main`, and list every button that is disabled."
- "Read https://docs.example.com/api/auth and summarise the token refresh flow with links."

**Choosing an engine.**

| `--engine` | Uses | Pick it when |
| :--- | :--- | :--- |
| `native` | Orbis's own engine | Server-rendered pages and docs. Fastest; needs no Chrome |
| `chrome` | Installed Chrome or Edge through Playwright | Your dev server is a client-rendered SPA |
| `auto` (default) | Chrome if found at the standard install paths, otherwise native | You don't mind which engine runs |

**Production notes.**

- Always set `ORBIS_NO_TELEMETRY=1`. At start-up the CLI checks for updates, and an update notice is printed to **stdout**, the same stream the MCP protocol uses.
- `memora_eval` runs arbitrary JavaScript and `memora_session` reads and writes files on your machine. Approve those tool calls deliberately.
- Clients must wait for each tool result before sending the next call. Requests aren't serialised, and concurrent calls (for example a browse and an act) can race.
- `memora_fork` switches the active page to the clone. There is no tool to switch back.
- Full tool reference: [mcp.md](mcp.md).

---

## 10. Compliance-friendly crawling

**Problem.** Crawl a site you don't own (for research, archiving or search) while honouring robots.txt, identifying yourself, and limiting load.

**Why Orbis fits.** `obeyRobots` checks every request against the origin's robots.txt (RFC 9309), including redirect hops, page `fetch()` calls and script downloads. Rules are cached per origin for 24 hours and fetched once even when requests run concurrently.

**When it doesn't fit.** Large-scale crawling that needs politeness scheduling across many hosts, `Crawl-delay` support, sitemap discovery or deduplication. Use a crawler framework and Orbis as the page processor.

**Verified.** Run against a fixture whose robots.txt disallows `/private` for `AcmeResearchBot` and everything for `*`. The crawl fetched 2 pages and reported `/private/x` as blocked. With the default agent token (`MemoraBrowser`), the first request failed with `RobotsBlockedError` (`code: 'ERR_BLOCKED_BY_ROBOTS'`).

```ts
// polite-crawler.ts â€” same-origin crawl that honours robots.txt and rate limits itself
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const START = process.env.START_URL ?? 'https://docs.example.com/guide';
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 200);
const DELAY_MS = Number(process.env.DELAY_MS ?? 2000); // Orbis ignores Crawl-delay; enforce your own

const browser = new OrbisBrowser({
  network: {
    obeyRobots: true,
    robotsAgent: 'AcmeResearchBot',                                // token matched against "User-agent:" lines
    userAgent: 'AcmeResearchBot/1.0 (+https://acme.example/bot)',  // identify yourself honestly
    headers: { From: 'crawler-ops@acme.example' },
  },
});

const origin = new URL(START).origin;
const queue = [START];
const seen = new Set(queue);
const report = { crawled: 0, blocked: [] as string[], failed: [] as string[] };

while (queue.length && report.crawled < MAX_PAGES) {
  const url = queue.shift()!;
  const page = browser.newPage();
  try {
    const { status } = await page.goto(url, { timeoutMs: 20_000 });
    report.crawled++;
    console.log(status, url, page.title());
    for (const href of page.extract('a[href]', 'href', 500) as string[]) {
      let next: URL;
      try { next = new URL(href, page.url); } catch { continue; }
      next.hash = '';
      if (next.origin === origin && !seen.has(next.href)) { seen.add(next.href); queue.push(next.href); }
    }
  } catch (err: any) {
    if (err.code === 'ERR_BLOCKED_BY_ROBOTS') report.blocked.push(url);
    else report.failed.push(`${url}: ${err.message}`);
  } finally {
    browser.closePage(page.id);
  }
  await new Promise(r => setTimeout(r, DELAY_MS));
}
browser.close();
console.log(JSON.stringify(report, null, 2));
```

**Expected output.**

```text
200 https://docs.example.com/guide Install Guide
200 https://docs.example.com/api API
[Memora] blocked by robots.txt: https://docs.example.com/private/x
{
  "crawled": 2,
  "blocked": [ "https://docs.example.com/private/x" ],
  "failed": []
}
```

The same rules from the CLI:

```bash
npx -y @memoracompany/memora-orbis fetch https://docs.example.com/private/x \
  --obey-robots --robots-agent AcmeResearchBot \
  --user-agent "AcmeResearchBot/1.0 (+https://acme.example/bot)"
# stderr: Fetch error: Blocked by robots.txt: â€¦ ; exit code 1
```

**How the robots rules behave.**

| robots.txt response | Effect |
| :--- | :--- |
| 2xx | Parsed. The group matching your agent token applies, the longest matching rule wins, and `Allow` wins ties |
| 4xx (including 404) | Everything is allowed |
| 5xx or unreachable | Everything is **disallowed** |

**Production notes.**

- `robotsAgent` selects the robots group and `userAgent` is what the server sees. Set both to the same product name. The CLI only accepts letters, `_` and `-` in `--robots-agent` (`"Acme Bot"` is rejected).
- `Crawl-delay` and `Sitemap` lines are ignored. Enforce your own per-host delay as the sample does.
- Every blocked request writes a line to stderr (`[Memora] blocked by robots.txt: â€¦`). Expect that noise in your logs.
- Stop on 429 and 503 responses and respect `Retry-After`. Robots compliance alone doesn't make a crawl polite.

---

## 11. Parallel exploration with fork()

**Problem.** From one loaded page (search results, a configured cart, a filled first step), try several alternatives and compare the outcomes without redoing the setup each time.

**Why Orbis fits.** `agent.fork()` copies the current URL, DOM, cookies, `localStorage` and `sessionStorage` into a new, independent page. That took about 5 ms on a small page in our measurements. Each branch can then submit a different form or follow a different link.

**When it doesn't fit.** Exploration that relies on in-memory JavaScript state, such as SPA stores or listeners attached by scripts. A fork re-parses the HTML, so JS heap state and event listeners aren't copied. Branches also aren't free once they navigate: each one makes its own network requests.

**Verified.** Run against a fixture search page. Three branches submitted different category and sort filters at the same time and returned `12`, `7` and `30` results. The original page stayed on `?q=kettle`.

```ts
// explore-filters.ts â€” try several filter combinations from one loaded state
import { OrbisAgent, OrbisBrowser } from '@memoracompany/memora-orbis';

const SEARCH_URL = process.env.SEARCH_URL ?? 'https://catalog.example.com/search?q=kettle';
const browser = new OrbisBrowser();
const agent = new OrbisAgent(browser, browser.newPage());

const variants = [
  { '#cat': 'books', '#sort': 'price' },
  { '#cat': 'tools', '#sort': 'relevance' },
  { '#cat': 'all', '#sort': 'price' },
];

try {
  await agent.goto(SEARCH_URL); // the state every branch starts from (cookies, storage, DOM)

  const results = await Promise.all(variants.map(async fields => {
    const branch = agent.fork(); // independent page: copies URL, DOM, cookies, local/sessionStorage
    try {
      // Submitting a GET form is a real navigation: each branch makes its own request
      const res = await branch.fillForm(fields, 'text=Search');
      return { fields, url: res.url, count: branch.page.extract('#count', 'text', 1)[0] };
    } finally {
      branch.page.close(); // close only the branch page â€” NOT branch.close() (see Known issue)
    }
  }));

  console.table(results);
  console.log('original page untouched:', agent.page.url);
} finally {
  await agent.close();
}
```

**Expected output.**

```text
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ (index) â”‚ fields                                    â”‚ url                                                         â”‚ count                                               â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ 0       â”‚ { '#cat': 'books', '#sort': 'price' }     â”‚ 'https://catalog.example.com/search?q=kettle&cat=books&â€¦'   â”‚ '12 results for kettle in books sorted by price'    â”‚
â”‚ 1       â”‚ { '#cat': 'tools', '#sort': 'relevance' } â”‚ 'https://catalog.example.com/search?q=kettle&cat=tools&â€¦'   â”‚ '7 results for kettle in tools sorted by relevance' â”‚
â”‚ 2       â”‚ { '#cat': 'all', '#sort': 'price' }       â”‚ 'https://catalog.example.com/search?q=kettle&cat=all&â€¦'     â”‚ '30 results for kettle in all sorted by price'      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
original page untouched: https://catalog.example.com/search?q=kettle
```

> **Known issue (0.1.0):** `fork.close()` closes the **parent's** browser and its connection pool. Afterwards the original agent fails with `The client is closed`. Dispose of branches with `fork.page.close()`, as the sample does.

**Production notes.**

- Design branches around native links (`page.activate()` on `<a href>`), GET/POST form submissions (`fillForm` with `submit`) and reading or extracting. Don't rely on script-attached click handlers.
- Inline `<script>`s run again in the fork when the HTML is re-parsed. Scripts with side effects (analytics beacons, counters) run once more per branch.
- Forked pages aren't registered with the browser, so they don't appear in `listPages()` or to CDP clients.
- Cap parallelism (for example 3â€“5 branches per site) for the same politeness reasons as crawling.

---

## 12. Company contact-page extraction

**Problem.** For a list of company websites, find their **published business contact channels** (sales or support email, phone, contact page) to enrich a B2B CRM.

**Why Orbis fits.** Corporate sites are mostly server-rendered. `extract('a[href]', 'href')` finds candidate pages, and `mailto:`/`tel:` links plus a regex over the Markdown pick up the contacts.

**When it doesn't fit.** Collecting personal data about individuals, contact forms that need JavaScript Orbis lacks, and sites that obfuscate addresses on purpose (respect that choice).

**Verified.** Run against a fixture company site. It found the contact page (the 404 `/about` link was skipped), `sales@acme.test` and `press@acme.test`, and `+1-555-0100`.

```ts
// company-contacts.ts â€” find published business contact channels on company websites
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const SITES = (process.env.SITES ?? 'https://acme.example').split(',');
const CONTACT_LINK = /contact|about|impressum|team|support/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const browser = new OrbisBrowser({
  network: { obeyRobots: true, robotsAgent: 'AcmeResearchBot', userAgent: 'AcmeResearchBot/1.0 (+https://acme.example/bot)' },
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function scan(site: string) {
  const found = { site, pages: [] as string[], emails: new Set<string>(), phones: new Set<string>() };
  const page = browser.newPage();
  try {
    await page.goto(site, { timeoutMs: 20_000 });
    const origin = new URL(page.url).origin;
    const candidates = [page.url];
    for (const href of page.extract('a[href]', 'href', 300) as string[]) {
      try {
        const u = new URL(href, page.url);
        if (u.origin === origin && CONTACT_LINK.test(u.pathname) && !candidates.includes(u.href)) candidates.push(u.href);
      } catch { /* ignore malformed hrefs */ }
    }
    for (const url of candidates.slice(0, 5)) {             // hard cap per site
      if (url !== page.url) {
        await sleep(1500);
        const { status } = await page.goto(url, { timeoutMs: 20_000 });
        if (status >= 400) continue;
      }
      found.pages.push(page.url);
      for (const href of page.extract('a[href^="mailto:"]', 'href') as string[]) found.emails.add(href.slice(7).split('?')[0].toLowerCase());
      for (const href of page.extract('a[href^="tel:"]', 'href') as string[]) found.phones.add(href.slice(4));
      for (const m of page.getMarkdown().match(EMAIL) ?? []) found.emails.add(m.toLowerCase());
    }
  } catch (err: any) {
    return { site, error: err.code === 'ERR_BLOCKED_BY_ROBOTS' ? 'disallowed by robots.txt' : err.message };
  } finally {
    browser.closePage(page.id);
  }
  return { ...found, emails: [...found.emails], phones: [...found.phones] };
}

const out = [];
for (const site of SITES) out.push(await scan(site));
browser.close();
console.log(JSON.stringify(out, null, 2));
```

**Expected output.**

```json
[
  {
    "site": "https://acme.example",
    "pages": ["https://acme.example/", "https://acme.example/contact-us"],
    "emails": ["sales@acme.test", "press@acme.test"],
    "phones": ["+1-555-0100"]
  }
]
```

**Responsible use (read before running).**

- **Lawful basis.** In the EU/UK (GDPR), California (CCPA/CPRA) and many other places, even business email addresses of named people are personal data. Collect role addresses (`sales@`, `support@`) by preference, record where each one came from, and honour deletion and opt-out requests.
- **Outreach rules.** CAN-SPAM, PECR and CASL restrict what you may send to the addresses you collect. Collecting an address doesn't give you consent to email it.
- **Terms and robots.** Keep `obeyRobots` on, and skip sites whose terms forbid automated collection.
- **Minimise.** Cap pages per site (the sample stops at 5), store only what you need, and don't build profiles of individuals.

---

## 13. Status-page monitoring from cron

**Problem.** Check an internal status page every few minutes and alert when it's unreachable or reports a degraded component.

**Why Orbis fits.** A short-lived Node process with no browser binary is cheap to run every few minutes. The script returns a meaningful exit code that cron, systemd or your alerting wrapper can act on.

**When it doesn't fit.** Status pages that render client-side from a JSON API. Query that API directly instead, because it's more reliable than any browser.

**Verified.** Run against fixtures. A healthy page exited 0 (`OK: 2 components operational`). A 503 page with one outage printed both messages and exited 2. An unreachable host exited 2.

```ts
// status-check.ts â€” exit 0 = healthy, 1 = degraded component, 2 = page unreachable / HTTP error
import { OrbisBrowser } from '@memoracompany/memora-orbis';

const STATUS_URL = process.env.STATUS_URL ?? 'https://status.internal.example.com/';
const browser = new OrbisBrowser({ network: { timeoutMs: 15_000 } });
const page = browser.newPage();
let code = 0;

try {
  const { status } = await page.goto(STATUS_URL, { timeoutMs: 15_000 });
  if (status >= 400) {
    console.error(`UNREACHABLE: HTTP ${status} from ${STATUS_URL}`);
    code = 2;
  }
  // Read whatever the page renders even on 5xx â€” many status pages still list components
  const names: string[] = page.extract('.component', 'text');
  const states: string[] = page.extract('.component', 'data-state');
  const broken = names.filter((_, i) => states[i] !== 'operational');
  if (names.length === 0) { console.error('No components found â€” has the page markup changed?'); code = Math.max(code, 2); }
  else if (broken.length) { console.error(`DEGRADED: ${broken.join('; ')}`); code = Math.max(code, 1); }
  else console.log(`OK: ${names.length} components operational`);
} catch (err: any) {
  console.error(`UNREACHABLE: ${err.message}`);   // DNS failure, timeout, TLS error
  code = 2;
} finally {
  browser.close();
}
process.exit(code);
```

Exit codes:

| Code | Meaning |
| :--- | :--- |
| 0 | Page reachable, every component operational |
| 1 | Page reachable, at least one component not operational |
| 2 | Page unreachable, HTTP error, or markup changed (no components found) |

Crontab (Linux), with a lock and a hard timeout:

```cron
*/5 * * * * cd /opt/monitors && ORBIS_NO_TELEMETRY=1 flock -n /tmp/status-check.lock timeout 60 npx tsx status-check.ts >> /var/log/status-check.log 2>&1 || /opt/monitors/alert.sh "status-check exit $?"
```

**Production notes.**

- Don't use `orbis --eval` for monitoring: it exits 0 even when the fetch fails. `orbis fetch` exits 1 only on network, TLS or robots errors and **exits 0 on HTTP 4xx/5xx**. The SDK gives you the status code (`goto()` returns `{ status }`, and `page.lastStatus` holds it too).
- Set both the navigation timeout (`timeoutMs`) and an outer `timeout` in cron. TCP connect attempts have their own 10-second limit in the HTTP client.
- Alert on consecutive failures (for example 2 of the last 3 runs) to avoid flapping.

---

## Related documents

- [best-practices.md](best-practices.md): agent loops, token budgeting, waiting, retries and lifecycle
- [typescript-sdk.md](typescript-sdk.md) and [python-sdk.md](python-sdk.md): full API references
- [locators.md](locators.md): every locator syntax and its matching rules
- [limitations.md](limitations.md): what the engine can't do
- [security.md](security.md) and [production-deployment.md](production-deployment.md): running Orbis safely
- [stealth.md](stealth.md): what the browser profile does and doesn't change
