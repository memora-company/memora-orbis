/**
 * Example 01: Agent building blocks with the Orbis TypeScript SDK
 *
 * Runs against a small local web app started by this script, so it works offline
 * and gives the same output every time. It shows:
 *   1. goto() + the semantic snapshot (action map, Markdown, token estimate)
 *   2. a compact action map for LLM prompts
 *   3. fillForm() with stable locators and a real form submission
 *   4. diff() to see what changed
 *   5. fork() to explore two paths from the same state
 *   6. saveSession() / loadSession() to reuse a login
 *
 * Run: npm install && npm start
 */
import http from 'node:http';
import { OrbisAgent, type SemanticPageSnapshot } from '@memoracompany/memora-orbis';

const PORT = 18091;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- tiny demo app
function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

const app = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE);
  const loggedIn = /(?:^|;\s*)sid=demo-session/.test(req.headers.cookie ?? '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      if (form.get('email') && form.get('password')) {
        res.writeHead(303, { 'Set-Cookie': 'sid=demo-session; Path=/; HttpOnly', Location: '/dashboard' });
        res.end();
      } else {
        res.end(page('Sign in', '<p role="alert">Email and password are required.</p><a href="/login">Try again</a>'));
      }
    });
    return;
  }
  if (url.pathname === '/login') {
    res.end(page('Sign in', `
      <main>
        <h1>Sign in to Acme</h1>
        <form action="/login" method="post">
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" placeholder="you@company.com">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" placeholder="Password">
          <label><input id="remember" name="remember" type="checkbox"> Remember me</label>
          <button type="submit">Sign In</button>
        </form>
      </main>`));
    return;
  }
  if (url.pathname === '/dashboard') {
    if (!loggedIn) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
    res.end(page('Dashboard', `
      <nav><a href="/reports">Reports</a> <a href="/billing">Billing</a></nav>
      <main><h1>Welcome back</h1><p>You have <strong>3</strong> open invoices.</p></main>`));
    return;
  }
  if (url.pathname === '/reports' || url.pathname === '/billing') {
    const name = url.pathname === '/reports' ? 'Reports' : 'Billing';
    res.end(page(name, `<main><h1>${name}</h1><table><tr><th>Item</th><th>Amount</th></tr><tr><td>Q3</td><td>$1,200</td></tr></table></main>`));
    return;
  }
  res.writeHead(302, { Location: '/login' });
  res.end();
});

// A short map for LLM prompts: no selectors, which are the longest part of actionMapText
function compactMap(snap: SemanticPageSnapshot): string {
  return snap.actions
    .filter((a) => !a.disabled)
    .map((a) => `[${a.actionId}] ${a.role} "${a.text}"${a.href ? ` -> ${a.href}` : ''}`)
    .join('\n');
}

// ---------------------------------------------------------------- the example
async function main() {
  await new Promise<void>((resolve) => app.listen(PORT, '127.0.0.1', resolve));
  // The SDK also starts a CDP server; pick a port that is free on your machine.
  const agent = await OrbisAgent.launch({ cdpPort: 19222 });

  try {
    // 1. Load the login page
    const login = await agent.goto(`${BASE}/login`);
    console.log(`1. Loaded "${login.title}" — ${login.interactiveCount} actions, ~${login.tokenEstimate} tokens`);
    console.log(login.actionMapText, '\n');

    // 2. Compact map you would give to a language model
    console.log('2. Compact map for the model:\n' + compactMap(login), '\n');

    // 3. Fill and submit with stable locators. Credentials come from code, never from the model.
    const result = await agent.fillForm(
      {
        'label:Email Address': 'developer@example.com',
        'label:Password': process.env.DEMO_PASSWORD ?? 'demo-password',
        '#remember': 'true',
      },
      'text=Sign In',
    );
    console.log(`3. Filled ${result.fieldsFilled} fields, skipped [${result.skipped.join(', ')}], submitted=${result.submitted}`);
    console.log(`   Now at ${result.url} ("${result.title}")\n`);

    // 4. What changed since the last snapshot?
    console.log('4. Diff:\n' + agent.diff().summary, '\n');

    // 5. Fork: explore two links from the same state. act() only fires a click event,
    //    so use page.activate() to follow links.
    const reportsBranch = agent.fork();
    const billingBranch = agent.fork();
    await reportsBranch.page.activate('text=Reports');
    await billingBranch.page.activate('text=Billing');
    console.log('5. Fork results:');
    console.log(`   reports branch -> ${reportsBranch.page.url} | ${reportsBranch.markdown().split('\n')[0]}`);
    console.log(`   billing branch -> ${billingBranch.page.url} | ${billingBranch.markdown().split('\n')[0]}`);
    console.log(`   original agent -> ${agent.page.url} (unchanged)\n`);
    reportsBranch.page.close();
    billingBranch.page.close();

    // 6. Save the session (contains live cookies: store it like a password)
    agent.saveSession('./sessions/demo-session.json');
    console.log('6. Session saved to ./sessions/demo-session.json');
  } finally {
    await agent.close();
  }

  // Reuse the saved login in a fresh agent: load the session, then navigate
  const second = await OrbisAgent.launch({ cdpPort: 19223 });
  try {
    second.loadSession('./sessions/demo-session.json');
    const dash = await second.goto(`${BASE}/dashboard`);
    console.log(`   Fresh agent with restored session opened "${dash.title}" at ${dash.url}`);
  } finally {
    await second.close();
    app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
