/**
 * Example 03 (TypeScript): Selenium WebDriver backed by Orbis
 *
 * Start the Orbis WebDriver server first (separate terminal):
 *   npx -y @memoracompany/orbis serve --protocol webdriver --port 9515
 *
 * Then run: npm install && npm start
 *
 * The script serves a small page on 127.0.0.1:18094 so the output is the same every time.
 * Set ORBIS_WEBDRIVER_URL to use another server address.
 */
import http from 'node:http';
import { Builder, By, until } from 'selenium-webdriver';

const WEBDRIVER_URL = process.env.ORBIS_WEBDRIVER_URL ?? 'http://localhost:9515';
const SITE = 'http://127.0.0.1:18094';

const site = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url?.startsWith('/search')) {
    const q = new URL(req.url, SITE).searchParams.get('q') ?? '';
    res.end(`<!DOCTYPE html><html><head><title>Results for ${q}</title></head><body>
      <h1>Results for "${q}"</h1>
      <ul><li><a href="/p/1">Orbis guide</a></li><li><a href="/p/2">WebDriver reference</a></li></ul>
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
  await new Promise<void>((resolve) => site.listen(18094, '127.0.0.1', resolve));

  let driver;
  try {
    // No chromedriver: Orbis is the WebDriver server. forBrowser('chrome') only sets browserName.
    driver = await new Builder().usingServer(WEBDRIVER_URL).forBrowser('chrome').build();
  } catch (err) {
    console.error(`Could not start a session at ${WEBDRIVER_URL}: ${(err as Error).message}`);
    console.error('Start Orbis first:\n  npx -y @memoracompany/orbis serve --protocol webdriver --port 9515');
    site.close();
    process.exit(1);
  }

  try {
    await driver.get(SITE);
    console.log(`Title:   ${await driver.getTitle()}`);
    console.log(`Heading: ${await driver.findElement(By.css('h1')).getText()}`);

    await driver.findElement(By.name('q')).sendKeys('selenium');
    await driver.findElement(By.css('button[type=submit]')).click();
    await driver.wait(until.urlContains('/search'), 5000);
    console.log(`After submit: ${await driver.getCurrentUrl()}`);

    const links = await driver.findElements(By.css('li a'));
    console.log(`Results: ${(await Promise.all(links.map((a) => a.getText()))).join(', ')}`);

    console.log(`navigator.webdriver: ${await driver.executeScript('return navigator.webdriver')}`);
  } finally {
    await driver.quit(); // always quit: sessions count against --max-sessions (default 16)
    site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
