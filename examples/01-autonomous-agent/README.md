# Example 01: Agent Building Blocks (TypeScript SDK)

This example shows the building blocks of an Orbis-powered agent, end to end, against a small web app that the script starts locally. It needs no internet access and prints the same output every time, so you can also use it as a smoke test.

What it demonstrates:

| Step | API | What you learn |
| :--- | :--- | :--- |
| 1 | `agent.goto()` | The semantic snapshot: action map, Markdown and token estimate |
| 2 | `snapshot.actions` | Building a compact action map (no selectors) for LLM prompts |
| 3 | `agent.fillForm(fields, submit)` | Filling fields with stable locators and submitting a real form (POST + 303 redirect + cookie) |
| 4 | `agent.diff()` | Seeing URL, title and element changes after an action |
| 5 | `agent.fork()` + `page.activate()` | Exploring two links from the same state without affecting the original |
| 6 | `saveSession()` / `loadSession()` | Reusing a cookie-based login in a fresh agent |

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Optional: set `DEMO_PASSWORD` to see that credentials come from your environment, not from the model.

## Expected output (abridged)

```text
1. Loaded "Sign in" — 4 actions, ~130 tokens
=== INTERACTIVE ACTION MAP (4 elements) ===
[@1] [input] "you@company.com" type="email" placeholder="you@company.com" (selector: #email)
[@2] [input] "Password" type="password" placeholder="Password" (selector: #password)
[@3] [input] "[Untitled input]" type="checkbox" (selector: #remember)
[@4] [button] "Sign In" type="submit" (selector: html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > form:nth-of-type(1) > button:nth-of-type(1))

3. Filled 3 fields, skipped [], submitted=true
   Now at http://127.0.0.1:18091/dashboard ("Dashboard")

4. Diff:
=== PAGE STATE DELTA ===
URL navigated: "http://127.0.0.1:18091/login" -> "http://127.0.0.1:18091/dashboard"
Title changed: "Sign in" -> "Dashboard"

Added (2 elements):
  + [@1] [link] "Reports" (selector: ...)
  + [@2] [link] "Billing" (selector: ...)
...
5. Fork results:
   reports branch -> http://127.0.0.1:18091/reports | # Reports
   billing branch -> http://127.0.0.1:18091/billing | # Billing
   original agent -> http://127.0.0.1:18091/dashboard (unchanged)

6. Session saved to ./sessions/demo-session.json
   Fresh agent with restored session opened "Dashboard" at http://127.0.0.1:18091/dashboard
```

## Things this example teaches on purpose

- **The checkbox shows as `[Untitled input]`.** The action map does not use `<label>` text. The `label:` and `#id` locators still find the field. See [Locators](../../docs/locators.md).
- **`act()` does not follow links.** Step 5 uses `page.activate()`, which follows links and submits forms. `agent.act(target)` without text only dispatches a click event.
- **`fillForm()` submits by default.** Here the submit target is given explicitly (`'text=Sign In'`). Pass `false` to fill without submitting.
- **Forks are disposed with `fork.page.close()`.** Calling `close()` on a forked agent would also shut down the parent's server and browser in 0.1.0.
- **Only cookies survive a session restore.** `localStorage` is reset on every navigation in 0.1.0, so this demo app uses a cookie login. See [Sessions and authentication](../../docs/sessions-and-auth.md).
- **The session file contains live cookies.** Keep `sessions/` out of version control (it is in `.gitignore`).

## Ports

The demo app listens on `127.0.0.1:18091`, and the two agents start CDP servers on ports `19222` and `19223`. Change the constants at the top of `index.ts` if those ports are in use.

## Next steps

- [TypeScript SDK reference](../../docs/typescript-sdk.md)
- [Best practices for agent loops](../../docs/best-practices.md)
- [Use cases](../../docs/use-cases.md)
