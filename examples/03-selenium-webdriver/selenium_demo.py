"""
Example 03 (Python): Selenium WebDriver backed by Orbis

Start the Orbis WebDriver server first (separate terminal):
    npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 9515

Then:
    pip install -r requirements.txt
    python selenium_demo.py

The script serves a small page on 127.0.0.1:18093 so the output is the same every time.
Set ORBIS_WEBDRIVER_URL to use another server address.
"""

import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from selenium import webdriver
from selenium.webdriver.common.by import By

WEBDRIVER_URL = os.environ.get("ORBIS_WEBDRIVER_URL", "http://localhost:9515")
SITE = "http://127.0.0.1:18093"

HOME = """<!DOCTYPE html><html><head><title>Docs search</title></head><body>
<h1>Documentation</h1>
<form action="/search" method="get">
  <input name="q" placeholder="Search docs">
  <button type="submit">Search</button>
</form>
</body></html>"""


class Site(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/search":
            q = parse_qs(url.query).get("q", [""])[0]
            body = (f"<!DOCTYPE html><html><head><title>Results for {q}</title></head><body>"
                    f"<h1>Results for \"{q}\"</h1><ul><li><a href='/p/1'>Orbis guide</a></li>"
                    f"<li><a href='/p/2'>WebDriver reference</a></li></ul></body></html>")
        else:
            body = HOME
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def main() -> int:
    server = HTTPServer(("127.0.0.1", 18093), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    try:
        # No chromedriver: Orbis is the WebDriver server. ChromeOptions only sets browserName.
        driver = webdriver.Remote(command_executor=WEBDRIVER_URL, options=webdriver.ChromeOptions())
    except Exception as exc:  # connection refused, session limit reached, ...
        print(f"Could not start a session at {WEBDRIVER_URL}: {exc}")
        print("Start Orbis first:\n  npx -y @memoracompany/memora-orbis serve --protocol webdriver --port 9515")
        server.shutdown()
        return 1

    try:
        driver.get(SITE)
        print(f"Title:   {driver.title}")
        print(f"Heading: {driver.find_element(By.TAG_NAME, 'h1').text}")

        box = driver.find_element(By.NAME, "q")
        box.send_keys("selenium")
        driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
        print(f"After submit: {driver.current_url}")

        links = [a.text for a in driver.find_elements(By.CSS_SELECTOR, "li a")]
        print(f"Results: {', '.join(links)}")

        print(f"navigator.webdriver: {driver.execute_script('return navigator.webdriver')}")
    finally:
        driver.quit()  # always quit: sessions count against --max-sessions (default 16)
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
