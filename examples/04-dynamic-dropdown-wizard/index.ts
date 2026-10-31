/**
 * Example 04: Dependent dropdowns (Country -> State) without broken locators
 *
 * The problem: selecting a country reveals a State dropdown. Action IDs are positional,
 * so every element after the new dropdown gets a new number (@3 -> @4).
 *
 * The solution shown here:
 *   1. Use stable locators (label:, text=, #id) for scripted steps.
 *   2. Use diff() to discover what appeared, with the new action IDs.
 *   3. Use selectOption() for <select> elements.
 *
 * The form is loaded with page.setContent(), so the example runs offline.
 * Run: npm install && npm start
 */
import { OrbisAgent } from '@memoracompany/orbis';

// Two Orbis 0.1.0 limitations shape this demo page (see docs/limitations.md):
//  - page scripts have no element.style, so visibility is toggled with the `hidden` attribute;
//  - select.value returns '' inside page scripts, so the handler reads the selected <option>.
// Real sites that rely on either will not reveal the dependent dropdown in 0.1.0.
const WIZARD_HTML = `<!DOCTYPE html>
<html>
  <head><title>Registration</title></head>
  <body>
    <h1>Account details</h1>
    <label for="fullName">Full Name</label>
    <input id="fullName" name="fullName" placeholder="Enter full name" />

    <label for="country">Country</label>
    <select id="country" name="country" onchange="updateStates(selectedValue(this))">
      <option value="">-- Choose country --</option>
      <option value="IN">India</option>
      <option value="US">United States</option>
    </select>

    <div id="stateContainer" hidden>
      <label for="state">State / Province</label>
      <select id="state" name="state"></select>
    </div>

    <button id="submitBtn" type="button" onclick="submitForm()">Complete Registration</button>
    <p id="status">Not submitted</p>

    <script>
      const STATES = {
        IN: [['DL', 'Delhi'], ['MH', 'Maharashtra'], ['KA', 'Karnataka']],
        US: [['CA', 'California'], ['NY', 'New York'], ['TX', 'Texas']],
      };
      // Works in real browsers and in Orbis (where select.value is not implemented)
      function selectedValue(select) {
        const option = select.querySelector('option[selected]');
        return option ? option.getAttribute('value') : '';
      }
      function updateStates(country) {
        const box = document.getElementById('stateContainer');
        const select = document.getElementById('state');
        const options = STATES[country] || [];
        select.innerHTML = options.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
        if (options.length) box.removeAttribute('hidden');
        else box.setAttribute('hidden', '');
      }
      function submitForm() {
        const name = document.getElementById('fullName').value;
        const state = selectedValue(document.getElementById('state'));
        document.getElementById('status').textContent = 'Submitted: ' + name + ' / ' + state;
      }
    </script>
  </body>
</html>`;

async function main() {
  const agent = await OrbisAgent.launch({ cdpPort: 19224 });

  try {
    agent.page.setContent(WIZARD_HTML, 'https://wizard.example.test/register');

    // 1. Initial state: the State dropdown is hidden, so it is not in the action map
    const before = agent.snapshot();
    console.log('1. Initial action map:');
    console.log(before.actionMapText, '\n');

    // 2. Select the country with a stable locator. This fires the change event,
    //    so the page's onchange handler runs and reveals the State dropdown.
    const countryOk = agent.selectOption('label:Country', 'India');
    console.log(`2. selectOption('label:Country', 'India') -> ${countryOk}\n`);

    // 3. Ask Orbis what changed. New elements come with their new action IDs.
    const delta = agent.diff();
    console.log('3. Diff after choosing a country:');
    console.log(delta.summary);
    for (const el of delta.addedActions) {
      console.log(`   new element: ${el.actionId} <${el.tag}> selector=${el.selector}`);
    }
    console.log();

    // 4. The button moved from @3 to @4. Stable locators do not care.
    const after = agent.snapshot();
    const button = after.actions.find((a) => a.text === 'Complete Registration');
    console.log(`4. "Complete Registration" was ${before.actions.find((a) => a.tag === 'button')?.actionId}, now ${button?.actionId}\n`);

    // 5. Fill the rest with stable locators
    const stateOk = agent.selectOption('label:State / Province', 'Maharashtra');
    const nameOk = agent.act('placeholder:Enter full name', 'Priya Sharma');
    console.log(`5. state selected=${stateOk}, name typed=${nameOk}`);

    // 6. A type="button" with an onclick handler: a click event is all it needs
    agent.act('text=Complete Registration');
    console.log(`6. Status: ${agent.page.querySelector('#status')?.textContent}`);

    // Page script errors never throw into your code; check the page console
    const errors = agent.page.getLogs().filter((l) => l.type === 'error');
    console.log(`   Page console errors: ${errors.length}`);
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
