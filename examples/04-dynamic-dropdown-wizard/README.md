# Example 04: Dependent Dropdowns Without Broken Locators

A common automation failure: you select a country, a State dropdown appears, and every element after it gets a new position. Scripts and agent plans that remembered "`@3` is the submit button" now click the wrong thing. This example shows how to handle it with Orbis.

The form is loaded with `page.setContent()`, so the example runs offline.

## The problem

Action IDs (`@1`, `@2`, ...) are positional. They are recomputed on every snapshot, in document order, and hidden elements are not numbered.

| Before choosing a country | After choosing "India" |
| :--- | :--- |
| `@1` Full name | `@1` Full name |
| `@2` Country | `@2` Country |
| `@3` **Complete Registration** | `@3` **State / Province** (new) |
| | `@4` **Complete Registration** |

## The solution

1. **Stable locators for scripted steps.** `label:Country`, `label:State / Province`, `placeholder:Enter full name` and `text=Complete Registration` find the same element no matter how many fields appear before it. See [Locators](../../docs/locators.md).
2. **`diff()` for agents.** After an action, `agent.diff()` lists only what changed, with the new action IDs, so a language model can continue without re-reading the whole page.
3. **`selectOption()` for `<select>`.** It matches by option value, then exact text, then partial text (case-insensitive), marks the option selected and fires `input` and `change`, so the page's `onchange` handler runs.

```typescript
agent.selectOption('label:Country', 'India');      // fires change -> page reveals State
const delta = agent.diff();                         // delta.addedActions -> [@3 <select id="state">]
agent.selectOption('label:State / Province', 'Maharashtra');
agent.act('placeholder:Enter full name', 'Priya Sharma');
agent.act('text=Complete Registration');            // type="button" + onclick: a click event is enough
```

## Run it

```bash
npm install
npm start
```

Expected output:

```text
1. Initial action map:
=== INTERACTIVE ACTION MAP (3 elements) ===
[@1] [input] "Enter full name" placeholder="Enter full name" (selector: #fullName)
[@2] [select] "-- Choose country -- India United States" type="select" (selector: #country)
[@3] [button] "Complete Registration" type="button" (selector: #submitBtn)

2. selectOption('label:Country', 'India') -> true

3. Diff after choosing a country:
=== PAGE STATE DELTA ===

Added (1 elements):
  + [@3] [select] "DelhiMaharashtraKarnataka" (selector: #state)
   new element: @3 <select> selector=#state

4. "Complete Registration" was @3, now @4

5. state selected=true, name typed=true
6. Status: Submitted: Priya Sharma / MH
   Page console errors: 0
```

## Important: what this means for real websites

The demo page is written to work within two Orbis 0.1.0 limitations of the page-script environment:

- **No `element.style`.** The page shows the State dropdown by removing the `hidden` attribute instead of setting `style.display`.
- **`select.value` returns an empty string in page scripts.** The page reads the selected `<option>` instead.

Many real sites use `this.value` and `style.display` in exactly this kind of handler. On those sites, the dependent dropdown will not appear in Orbis 0.1.0. Options:

- If the site falls back to a normal form submission, submit the form (`fillForm` or `page.activate` on the submit button) and read the next page. Orbis sends the selected options correctly in form submissions.
- Call the site's own function with the value: `agent.page.evaluate("updateStates('IN')")`.
- For assistants using MCP, run the server with `--engine chrome`.

Check the page console with `agent.page.getLogs()` when a dependent field does not appear. Details: [Limitations](../../docs/limitations.md) and [Troubleshooting](../../docs/troubleshooting.md).
