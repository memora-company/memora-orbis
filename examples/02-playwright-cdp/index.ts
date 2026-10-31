/**
 * Example 02: Playwright over CDP, backed by Orbis
 *
 * Start the Orbis daemon first (separate terminal):
 *   npx -y @memoracompany/orbis --port 9222
 *
 * Then run: npm install && npm start
 *
 * The script serves a small page on 127.0.0.1:18092 so the output is the same every time.
 * Set ORBIS_CDP_URL to use another daemon address.
 */
import http from 'node:http';
import { chromium } from 'playwright';

const CDP_URL = process.env.ORBIS_CDP_URL ?? 'http://localhost:9222';
const SITE = 'http://127.0.0.1:18092';

const site = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url?.startsWith('/search')) {
    const q = new URL(req.url, SITE).searchParams.get('q') ?? '';
    res.end(`<!DOCTYPE html><html><head><title>Results for ${q}</title></head><body>
      <h1>Results for "${q}"</h1>
      <ul><li><a href="/p/1">Orbis guide</a></li><li><a href="/p/2">CDP reference</a></li></ul>
    </body></html>`);
    return;
  }
  res.end(`<!DOCTYPE html><html><head><title>Docs search</title></head><body>
    <h1>Documentation</h1>
    <form action="/search" method="get">
      <input name="q" placeholder="Search docs">
      <button type="submit">Search</button>
    </form>
  </body></html>`);
});

async function main() {
  await new Promise<void>((resolve) => site.listen(18092, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(`Could not connect to Orbis at ${CDP_URL}. Start it first:\n  npx -y @memoracompany/orbis --port 9222`);
    site.close();
    process.exit(1);
  }

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();

    // Navigation and standard locators
    await page.goto(SITE);
    console.log(`Title:   ${await page.title()}`);
    console.log(`Heading: ${await page.locator('h1').textContent()}`);

    // Typing and clicking go through the CDP Input domain
    await page.fill('input[name="q"]', 'webdriver');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/search?q=webdriver');
    console.log(`After submit: ${page.url()}`);
    console.log(`Results: ${(await page.locator('li a').allTextContents()).join(', ')}`);

    // JavaScript runs in the Orbis page sandbox
    const info = await page.evaluate(() => ({
      webdriver: (navigator as any).webdriver,
      userAgent: navigator.userAgent,
    }));
    console.log(`navigator.webdriver: ${info.webdriver}`);
    console.log(`navigator.userAgent: ${info.userAgent}`);

    // Orbis does not render pixels: this is a 1x1 transparent PNG, not a real screenshot
    const shot = await page.screenshot();
    console.log(`Screenshot bytes: ${shot.length} (placeholder image; Orbis has no renderer)`);

    await page.close();
  } finally {
    // Browser.close closes every page on the daemon. Use one daemon per test worker.
    await browser.close();
    site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
