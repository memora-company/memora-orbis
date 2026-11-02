# Locators

A locator is the string you pass to `act()`, `fillForm()`, `selectOption()`, `activate()`, `waitForSelector()`, the REST `/orbis/act` and `/orbis/fill-form` endpoints, and the Python SDK, to say *which element* you mean. Orbis resolves every locator through one pipeline of ten strategies, from numbered action IDs (`@3`) for LLM agents to CSS, XPath, text, label, placeholder, test-id and ARIA-role locators for deterministic scripts. This page documents the exact matching rules of each strategy as implemented in `src/dom/locators.ts`, the edge cases we verified, and how to choose the right one for production.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Quick reference](#quick-reference)
- [How resolution works](#how-resolution-works)
- [Strategy details](#strategy-details)
  - [Action IDs: `@n`](#action-ids-n)
  - [Semantic aliases: `@word`](#semantic-aliases-word)
  - [XPath](#xpath)
  - [Text: `text=`](#text-text)
  - [Label: `label:`](#label-label)
  - [Placeholder: `placeholder:`](#placeholder-placeholder)
  - [Test ID: `testid:`](#test-id-testid)
  - [ARIA role: `role:`](#aria-role-role)
  - [CSS](#css)
  - [Fuzzy attribute (bare word)](#fuzzy-attribute-bare-word)
- [Choosing a locator](#choosing-a-locator)
- [Custom strategies](#custom-strategies)
- [Pitfalls and verified edge cases](#pitfalls-and-verified-edge-cases)

---

## Quick reference

| # | Strategy | Syntax | Matching | Best for |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Action ID | `@1`, `@42` | the element numbered n in the **latest snapshot** of the page (including focused or filtered snapshots) | LLM agent loops, right after a snapshot |
| 2 | Semantic alias | `@email`, `@submit` | best-scoring action: exact name/id/type first, form fields before links | quick scripts; fuzzy for production |
| 3 | XPath | `//button[@type="submit"]`, `xpath=...`, `xpath:...` | first node of the XPath result | migrating Selenium suites, ancestor queries |
| 4 | Text | `text=Sign in`, `text:"Add to cart"` | case-insensitive; exact, then substring, on buttons/links/inputs/selects | buttons and links |
| 5 | Label | `label:Email`, `label="Email address"` | case-insensitive substring of `<label>` text; then `aria-label`, then `aria-labelledby` | form fields |
| 6 | Placeholder | `placeholder:Search`, `placeholder=...` | **case-sensitive** substring of `placeholder` | unlabelled inputs |
| 7 | Test ID | `testid:checkout`, `data-testid=checkout` | exact `data-testid`, `data-test-id`, `data-qa` or `data-cy` | QA/CI suites |
| 8 | ARIA role | `role:button`, `role=button[name="Save"]` | `[role="x"]` or a native element with that implicit role; optional accessible name (exact, then substring) | buttons, links, fields and custom widgets |
| 9 | CSS | `#id`, `.cls`, `input[name="q"]`, `form > button` | first `querySelector` match | everything stable |
| 10 | Fuzzy | `username` | `#username`, then `[name="username"]`, then `[data-testid="username"]` | short hand in scripts |

All strategies return **one** element (the first match). None of them waits; combine with `page.waitForSelector(locator)` when content appears asynchronously. Leading and trailing whitespace in the locator is ignored.

---

## How resolution works

`LocatorEngine.resolve(target)` tries the strategies in the order of the table above. For each strategy whose `matches()` accepts the string, it calls `resolve()`. The **first non-null element wins**. If a strategy matches the syntax but finds nothing, the engine continues with the next matching strategy. If nothing is found, it finally tries the string as a plain CSS selector; invalid CSS returns `null` instead of throwing.

Consequences you should know:

- A locator never throws for "not found". `act()`, `selectOption()`, `type()` return (or resolve to) `false`; `fillForm()` lists it in `skipped`; `activate()` throws `Element "<target>" not found`; `waitForSelector()` keeps polling until its timeout.
- Prefixes are recognised by their exact spelling: `text=`/`text:`, `label:`/`label=`, `placeholder:`/`placeholder=`, `testid:`/`testid=`/`data-testid:`/`data-testid=`, `role:`/`role=`, `xpath:`/`xpath=` or a leading `//`. Anything else (for example `data-test:go` or `aria-label:Close`) falls through to CSS and normally resolves to nothing.
- A bare word is tried as CSS first (a **tag name**) and only then as an id/name/test id. `button` therefore returns the first `<button>`, not an element with `id="button"`.

---

## Strategy details

### Action IDs: `@n`

Syntax: `@` followed by digits only (`/^@\d+$/`).

Every snapshot numbers the interactive elements of the page in **document order**, starting at `@1`. Interactive means `a`, `button`, `input`, `select`, `textarea`, `summary`, elements with role `button`/`link`/`checkbox`/`radio`/`tab`/`menuitem`/`switch`/`option`/`treeitem`, `tabindex="0"`, or an `onclick` attribute. Elements inside `script`, `style`, `noscript`, `svg`, `canvas` and `template` are ignored, and **hidden elements are skipped**: `hidden`, `aria-hidden="true"`, `input[type=hidden]`, inline `display:none` or `visibility:hidden`, on the element or any ancestor. Stylesheet rules are not evaluated, so elements hidden only by CSS classes still get numbers.

Resolution: when you pass `@n`, Orbis looks the number up in the **latest snapshot taken of the page** (as long as the page has not navigated since) and returns the element shown there. If there is no such snapshot, it takes a new snapshot of the full document and uses its n-th element. Consequences:

1. **IDs from focused or filtered snapshots work.** `snapshot({ focusSelector: 'main' })` numbers only the elements inside `<main>`, and `act('@1')` then resolves to the first element of that focused snapshot. The same applies to `excludeSelectors` and `filterHidden: false`.
2. **Use the latest snapshot.** IDs refer to the most recent snapshot or diff. If you take another snapshot (for example with different options) before acting, the IDs of the earlier one no longer apply.
3. **IDs change when the DOM changes.** If a script inserts a banner, reveals a field or re-renders a list, the next snapshot numbers elements differently. Re-snapshot after each action (the `diff()` output already contains fresh numbers) and never cache `@IDs` across navigations or turns.

```ts
const snap = await agent.goto('https://example.com/signup');
await agent.act('@1', 'ada@example.com');
await agent.act('@4');               // clicks like a real browser (follows links, submits forms)
const delta = agent.diff();          // numbers in delta.summary are valid right now
```

IDs from a focused snapshot:

```ts
const form = agent.snapshot({ focusSelector: 'form#checkout' });
const pay = form.actions.find(a => a.text === 'Pay now');
await agent.act(pay!.actionId);
```

### Semantic aliases: `@word`

Syntax: `@` followed by anything that is not only digits (`@email`, `@first-name`, `@submit`).

Resolution: compares the word (lower-case) with every action of the latest snapshot and returns the **best match**, not the first one. From best to weakest: `name` equals the word; the element's id equals it; an input's `type` equals it; `placeholder` or `text` equals it; `name`, `placeholder`, `selector` or `text` contains it. On equal terms, form fields win over links and buttons. For example, on a page with a navigation link "Email us" before `<input name="email">`, `@email` resolves to the **input**.

Aliases are still a fuzzy match. Use them for exploration and demos. In production prefer `label:`, `placeholder:`, `testid:` or CSS (`input[name="email"]`).

### XPath

Syntax: starts with `//`, `xpath:` or `xpath=` (the prefix is stripped).

Returns the first node of the expression evaluated from the document. Orbis has its own XPath evaluator covering the commonly used parts of XPath 1.0 (axes such as `ancestor`, `following-sibling`, `preceding-sibling`; functions such as `contains`, `starts-with`, `normalize-space`, `text`, `position`, `last`). All four examples below were verified.

```text
//button[@type="submit"]
//a[contains(text(), "Pricing")]
xpath=//label[normalize-space()="Email"]/following-sibling::input
xpath=(//table//tr)[3]
```

Expressions that do not start with `//` (for example `(//a)[2]` or `./div`) are not recognised as XPath; prefix them with `xpath=`. Verified: `(//a)[2]` resolved to nothing, `xpath=(//a)[2]` to the second link.

### Text: `text=`

Syntax: `text=Sign in`, `text:Sign in`, optionally quoted: `text="Add to cart"`, `text='Next'` (one pair of surrounding quotes is removed).

Matching, all case-insensitive on trimmed text:

1. Among `button`, `a`, `input`, `select` and elements with `role="button"`: first whose text content (or `value` attribute when the text is empty, e.g. `<input type="submit" value="Send">`) **equals** the query.
2. Same candidates: first whose text **contains** the query.
3. Any element whose whole text equals the query.

Notes:

- Text locators **do not filter hidden elements**. Verified: `text=Secret` returned a button inside a `hidden` container. If a page has hidden duplicates (mobile menus, templates), use a more specific locator.
- Substring matching means `text=Sign` can hit "Sign up" before "Sign in". Use the full visible label.
- Step 3 can return a non-interactive element (a heading, a `<span>`). Clicking it only fires click handlers.

### Label: `label:`

Syntax: `label:Email`, `label=Email address`, optionally quoted.

Matching:

1. For each `<label>` in document order whose text **contains** the query (case-insensitive): if it has `for="id"`, return `#id`; otherwise return the first `input`, `select` or `textarea` nested inside it. If neither exists, continue with the next label.
2. Otherwise, return the first element whose `aria-label` attribute contains the query (case-insensitive). `label:Search Products` and `label:search products` both find `<input aria-label="Search Products">`.
3. Otherwise, return the first element with `aria-labelledby` whose referenced text contains the query (case-insensitive).

Other notes:

- Substring matching: `label:Email` also matches "Backup email" if that label comes first. Use the longest unambiguous text.
- `for` values are used as `#id` selectors; ids that are not valid CSS identifiers (starting with a digit, containing `:`) do not resolve through this path.
- Label text is shown in the action map: an `<input>` with a `<label for>` or a wrapping `<label>` appears with the label text as its name, so an LLM sees the same name you would use with `label:`.

### Placeholder: `placeholder:`

Syntax: `placeholder:Search`, `placeholder=Work email`, optionally quoted.

Returns the first element whose `placeholder` attribute **contains** the text, **case-sensitively** (it is a CSS `[placeholder*="..."]` query). Verified: `placeholder:Work` matched `placeholder="Work email"`, `placeholder:work` did not.

### Test ID: `testid:`

Syntax: `testid:checkout-btn`, `testid=checkout-btn`, `data-testid:checkout-btn`, `data-testid=checkout-btn`, optionally quoted.

Returns the first element whose `data-testid`, `data-test-id`, `data-qa` or `data-cy` attribute (checked in that order) **equals** the value exactly. `data-test="..."` is **not** checked; use CSS: `[data-test="checkout"]`.

This is the most stable locator for applications you control. Add test ids to critical controls.

### ARIA role: `role:`

Syntax: `role:<name>` or `role:<name>[name="<accessible name>"]` (also `role=`; quotes around the name are optional).

Matching: candidates are elements with `role="<name>"` **and** native elements whose implicit role is `<name>` (an element with a different explicit `role` is skipped). Without a name, the first candidate is returned. With a name, the first candidate whose accessible name **equals** the name is returned, otherwise the first whose accessible name **contains** it (both case-insensitive). The accessible name comes from `aria-label`, `aria-labelledby`, an associated `<label>`, `alt`/`title`/`placeholder`/`value`, or the element's text.

Implicit roles include:

| Role | Native elements |
| :--- | :--- |
| `link` | `<a href>`, `<area href>` |
| `button` | `<button>`, `<input type="button">`, `type="submit"`, `type="reset"`, `type="image"`, `<summary>` |
| `textbox` | text-like `<input>` (no type, `text`, `email`, `tel`, `url`, `search`, `password`), `<textarea>` |
| `checkbox`, `radio` | `<input type="checkbox">`, `<input type="radio">` |
| `combobox`, `listbox` | `<select>`, `<select multiple>` |
| `heading` | `<h1>` to `<h6>` |
| others | `searchbox`, `option`, `img` (with `alt`), `list`, `listitem`, `navigation`, `main`, `form`, `table`, `row`, `cell`, `dialog` |

```text
role:link[name="Pricing"]
role:button[name="Close dialog"]
role:textbox[name="Email"]
role=tab[name='Billing']
role:menuitem[name="Delete"]
```

### CSS

Any selector supported by css-select: ids, classes, attributes (`[name="q"]`, `[href^="https"]`), combinators, `:nth-of-type`, `:not(...)`, `:has(...)` (verified), etc. The first match in document order is returned. Pseudo-classes that need layout or interaction state (`:hover`, `:visible`, `:focus`) are not meaningful in Orbis, because there is no rendering engine. For the full list of DOM features the engine does and does not implement, see [limitations.md](./limitations.md).

CSS is the default for strings without a recognised prefix. Every action map line includes a unique CSS selector you can reuse: `(selector: #email)`.

### Fuzzy attribute (bare word)

A string made only of letters, digits, `_` and `-` (for example `username`, `q`, `submit-btn`) is resolved as: first `#word`, then `[name="word"]`, then `[data-testid="word"]`. It is tried **after** CSS, so a word that is also a tag name (`button`, `form`, `select`, `input`, `a`) resolves to the first element with that tag. Verified: `button` returned the first `<button>`, `email` returned `<input id="email">`.

---

## Choosing a locator

| Situation | Recommended locator | Why |
| :--- | :--- | :--- |
| LLM chooses an element it just saw in the action map | `@n` from the latest snapshot (focused or not) taken after the last action | Shortest, matches what the model saw |
| Your own app, deterministic tests | `testid:` | Exact, survives copy and layout changes |
| Form fields on third-party sites | `label:` (unique text), `input[name="..."]`, `placeholder:` | Stable across layout changes |
| Buttons and links | `text=` with the full label | Readable; check for hidden duplicates |
| Elements found by structure | XPath with `xpath=` prefix | Ancestors, siblings, positions |
| Custom ARIA widgets and native controls by role | `role:<role>[name="..."]` | Uses explicit and implicit roles |
| Anything you can see in DevTools | CSS | Predictable, fast |
| Persisting a target between runs | CSS or `testid:` | `@n` and aliases are positional/fuzzy |

General production rules:

1. **Never store `@n`.** Store the `selector` field, a test id or a label.
2. **Always check the return value** (`false` from `act`/`selectOption`, `skipped` from `fillForm`) and fail loudly.
3. **Re-snapshot after every action** in agent loops.
4. **Make text and label locators specific**: substring matching picks the first hit.
5. **Wait for asynchronous content** with `page.waitForSelector(locator, { timeoutMs })` before acting.

---

## Custom strategies

Implement `LocatorStrategy` and register it on a `LocatorEngine`:

```ts
interface LocatorStrategy {
  readonly name: string;
  matches(selector: string): boolean;
  resolve(selector: string, ctx: LocatorContext): MemoraElement | null;
}
interface LocatorContext {
  document: MemoraDocument;
  getSemanticSnapshot?: () => SemanticPageSnapshot;
}
```

`registerStrategy(strategy, prepend = false)` appends by default. Because the CSS strategy accepts most strings, register custom prefixes with `prepend = true` so they run first.

Example: a case-insensitive `aria:` locator (verified working):

```ts
import { defaultLocatorEngine, type LocatorStrategy } from '@memoracompany/memora-orbis';

const ariaLabel: LocatorStrategy = {
  name: 'aria-label',
  matches: s => s.trim().startsWith('aria:'),
  resolve: (s, ctx) => {
    const q = s.trim().slice(5).trim().toLowerCase();
    return ctx.document
      .querySelectorAll('[aria-label]')
      .find(e => (e.getAttribute('aria-label') || '').toLowerCase().includes(q)) ?? null;
  },
};

defaultLocatorEngine.registerStrategy(ariaLabel, true);

await agent.act('aria:close dialog'); // matches aria-label="Close Dialog"
```

`defaultLocatorEngine` is shared by **every page in the process**. To scope a strategy to one page, give that page its own engine:

```ts
import { LocatorEngine } from '@memoracompany/memora-orbis';

const engine = new LocatorEngine();          // starts with the 10 built-in strategies
engine.registerStrategy(ariaLabel, true);
agent.page.locatorEngine = engine;
```

Custom strategies apply to the TypeScript SDK and to anything running in the same process (the embedded CDP server's REST endpoints). They do not affect a separate `orbis` daemon.

---

## Pitfalls and verified edge cases

| Locator | Page | Result | Lesson |
| :--- | :--- | :--- | :--- |
| `@1` from `snapshot({ focusSelector: 'main' })` | nav link before `<main>` | the first element inside `<main>` | IDs refer to the snapshot you took |
| `@email` | link "Email us" before `<input name="email">` | the input | Aliases pick the best match, form fields first |
| `label:Search Products` | `<input aria-label="Search Products">` | found | `aria-label` matching is case-insensitive |
| `role:link` | `<a href="/x">Docs</a>` | found | Implicit roles are computed |
| `role:button[name="close"]` | `<div role="button" aria-label="Close dialog">` | found | Name match is case-insensitive substring |
| `text=Secret` | button inside a `hidden` div | found | Text locators include hidden elements |
| `placeholder:work` | `placeholder="Work email"` | not found | Placeholder matching is case-sensitive |
| `(//a)[2]` | two links | not found | Prefix XPath with `xpath=` unless it starts with `//` |
| `button` | several buttons | first `<button>` | Bare words are tried as tag names first |
| `data-test:go` | `data-test="go"` | not found | Only `testid:` / `data-testid:` prefixes exist |

Related reading: [typescript-sdk.md](./typescript-sdk.md) for the methods that accept locators, [best-practices.md](./best-practices.md) for agent-loop patterns, [troubleshooting.md](./troubleshooting.md) for "element not found" debugging.
