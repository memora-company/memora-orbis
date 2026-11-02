# Security Guide

This guide describes the security properties of Orbis, the threats that matter in production, and how to harden a deployment. Orbis loads untrusted web content, executes its JavaScript, and exposes powerful remote-control interfaces (CDP, REST, WebDriver, MCP). Treat every Orbis process as **a component that websites and anyone who can reach its port will try to control**, and isolate it accordingly.

Applies to: Orbis 0.2.0 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. Threat model](#1-threat-model)
- [2. Security properties](#2-security-properties)
- [3. Network isolation](#3-network-isolation)
- [4. Process and tenant isolation](#4-process-and-tenant-isolation)
- [5. Reverse proxy examples](#5-reverse-proxy-examples)
- [6. Secrets, credentials and session files](#6-secrets-credentials-and-session-files)
- [7. Keeping secrets away from the LLM](#7-keeping-secrets-away-from-the-llm)
- [8. TLS](#8-tls)
- [9. Responsible automation](#9-responsible-automation)
- [10. Hardening checklist](#10-hardening-checklist)
- [11. Reporting vulnerabilities](#11-reporting-vulnerabilities)

> **Prompt injection:** web pages can try to give your agent instructions. The 0.2.0 [prompt injection firewall](./prompt-injection-firewall.md) adds approvals for risky actions, site allow and block lists, and a signed activity log.

---

## 1. Threat model

| Actor | What they can do if not mitigated |
| :--- | :--- |
| **Anyone who can reach the CDP/REST port** (and has the API key, if one is set) | Navigate pages, read page content and cookies, run JavaScript in any page, save and load session files in the server's session folder, and close pages |
| **Anyone who can reach the WebDriver port** (and has the API key, if one is set) | Create sessions (up to `--max-sessions`), navigate, run scripts, read cookies |
| **A website the agent visits** | Run JavaScript in the page. Orbis blocks the known ways for page scripts to reach the host Node.js process, but the page runtime is not a perfect sandbox (see [2.6](#26-page-javascript-runs-in-a-hardened-sandbox)). |
| **A prompt-injected LLM** (via page content) | Ask the agent to visit attacker URLs, submit forms, exfiltrate data through query strings, call `memora_eval`, or save/load session files |
| **Whoever can read your logs or prompts** | See page content and anything a page script copied from typed values. Typed values themselves are hidden in action maps and diffs (see [section 7](#7-keeping-secrets-away-from-the-llm)). |

Design principle: **treat the Orbis process as exposed to hostile content.** Give it nothing it does not need: no cloud credentials, no access to internal admin networks, no writable application directories, no shared tenancy.

## 2. Security properties

### 2.1 Bind address

The CDP/REST server and the WebDriver server listen on `127.0.0.1` only when `--host` is `localhost` (the default) or `127.0.0.1`. Other machines and containers cannot connect.

- To accept connections from other machines (for example in Docker or Kubernetes), pass `--host 0.0.0.0`, or a specific private IP such as `--host 10.0.0.5`.
- `--host ::1` listens on the IPv6 loopback; printed URLs show `[::1]`.

> **Changed in 0.2.0:** earlier versions listened on all interfaces (`0.0.0.0`) for `--host localhost` and `--host 127.0.0.1`. If you relied on that to reach a daemon from another machine or container, pass `--host 0.0.0.0` explicitly.

### 2.2 API keys

When `ORBIS_API_KEY` (or `MEMORA_API_KEY`, or the `apiKey` option of `OrbisAgent.launch()`) is set, the CDP/REST server requires it on **every** HTTP request and every CDP WebSocket connection, sent in one of these ways:

- `x-api-key: <key>` header,
- `Authorization: Bearer <key>` header,
- `?apiKey=<key>` query parameter.

Requests without the right key get HTTP `401`. The TypeScript and Python clients send the key automatically when you configure it. Health checks (`/json/version`) must send it too.

The WebDriver server (`orbis serve --protocol webdriver`) checks the same key on every request, including `/status`. Besides the three ways above it also accepts `Authorization: Basic` with the key as the password (any user name), which is what Selenium sends when the key is in the server URL:

```python
driver = webdriver.Remote(command_executor=f"http://orbis:{key}@127.0.0.1:9515", options=options)
```

A missing or wrong key gets HTTP `401`. See [selenium-webdriver.md](./selenium-webdriver.md#api-key).

Set a key whenever anything other than your own process can reach the port, and still keep the port on a private network.

> **Changed in 0.2.0:** earlier versions stored the key but did not check it, and the WebDriver server had no authentication at all. If you set `ORBIS_API_KEY` for a WebDriver server, every Selenium client and health check must now send the key.

### 2.3 Requests from web pages are refused

The CDP/REST server does not send CORS headers, and it refuses requests that a web page in someone's browser makes to it (cross-site requests) with HTTP `403` and the code `ERR_FORBIDDEN_ORIGIN`. A website open in a developer's normal browser therefore cannot drive a local daemon. The WebDriver server also refuses cross-site requests with HTTP `403`.

REST endpoints called with the wrong HTTP method answer `405` with an `Allow` header listing the accepted methods, and the body `{"error":"Method not allowed","code":"ERR_METHOD_NOT_ALLOWED"}`.

> **Changed in 0.2.0:** earlier versions answered with `Access-Control-Allow-Origin: *`.

### 2.4 Session file paths are restricted

| Interface | Behaviour |
| :--- | :--- |
| `POST /orbis/session` with `{"filePath": "..."}` (also `/memora/session`) | Reads only `.json` files inside the folder the server was started in, or inside `ORBIS_SESSION_DIR` if set. Anything else is refused with HTTP `403` (`ERR_SESSION_PATH`). |
| `POST /orbis/session/save` with `{"filePath": "..."}` (also `/memora/session/save`) | Writes only `.json` files inside the same folder, creating sub-folders as needed. Existing session files there can be overwritten. |
| MCP `memora_session` | Same restriction; other paths return a tool error |
| CDP `Orbis.saveSession` / `Orbis.loadSession` with `filePath` (also `Memora.*`, `LP.*`) | Same restriction: only `.json` files inside the session folder. Other paths return a CDP error. |
| TypeScript SDK `saveSession()` / `loadSession()` in your own code | Not restricted; your code chooses the path |

Mitigations:
- Start the server in a dedicated folder, or set `ORBIS_SESSION_DIR` to one.
- Run as an unprivileged user, with a read-only root filesystem except the sessions folder.
- In MCP setups, review tool calls that touch session files.

### 2.5 Cookies are scoped to a site

The native engine scopes cookies like a browser: by domain (host-only, or the domain and its subdomains when `Domain=` is set), path, `Secure` and expiry. A cookie set by one site is not sent to other sites, and a `Secure` cookie is not sent over plain HTTP.

Each page (and each context created with `newContext()`) has its own cookie jar. Keeping one page or context per credential set is still good practice, so that an agent browsing other sites cannot act on an authenticated session.

> **Changed in 0.2.0:** earlier versions sent every cookie to every host. Session files now also contain a `cookieList` with each cookie's site; older files are still accepted (see [sessions-and-auth.md](./sessions-and-auth.md)).

### 2.6 Page JavaScript runs in a hardened sandbox

Pages execute inside Node.js `node:vm` contexts. Orbis blocks the known ways for page JavaScript to reach the host Node.js process: for example, `document.constructor.constructor('return process')()` throws an `EvalError`, and module imports with a computed path are refused.

This is hardening, not a perfect sandbox. The Node.js documentation states that `node:vm` is not a security mechanism. For high-assurance setups:

- Run Orbis in a dedicated container or VM, as an unprivileged user, with no secrets in its environment and no access to internal networks it does not need.
- Avoid embedding the in-process SDK (`OrbisBrowser` / `OrbisAgent.launch()`) in a service that holds credentials when it visits untrusted URLs.
- Prefer a separate daemon process per trust domain.

Code you run deliberately is different: `page.evaluate()`, CDP `Runtime.evaluate`/`callFunctionOn`, WebDriver `execute_script` and MCP `memora_eval` run whatever the caller sends. Expose them only to trusted callers.

### 2.7 Other properties

| Property | Detail |
| :--- | :--- |
| No request size limits | HTTP bodies are buffered fully in memory. Put a body-size limit in the gateway. |
| No rate limiting | Add it at the gateway if the daemon is shared |
| Browser close | CDP `Browser.close` closes only the pages created by that client |
| Logs | `DEBUG_CDP` / `DEBUG_WEBDRIVER` print request contents, which can include typed values |
| Outbound call | A startup version check calls `orbis.memora.company` unless `ORBIS_NO_TELEMETRY=1` (see [production-deployment.md](./production-deployment.md#11-outbound-version-check-and-air-gapped-environments)) |

## 3. Network isolation

Use the strongest of these that fits your topology:

1. **No listener at all.** Use `new OrbisBrowser()` + `newPage()` in-process (no port), or MCP over stdio.
2. **Loopback only.** The default (`--host localhost`) listens on `127.0.0.1` only. In Docker, where the container must listen on `0.0.0.0`, publish with `-p 127.0.0.1:9222:9222`.
3. **Private network only.** Use one of these:
   - a container on an internal Docker network with no published ports,
   - a Kubernetes ClusterIP Service plus a NetworkPolicy,
   - a pod sidecar.

   See [production-deployment.md](./production-deployment.md).
4. **Host firewall** in every case, as defence in depth:

```bash
# Linux (ufw): allow only the agent host to reach Orbis
sudo ufw deny 9222/tcp
sudo ufw allow from 10.0.0.20 to any port 9222 proto tcp
```

```powershell
# Windows: block inbound access to the Orbis port from other machines
New-NetFirewallRule -DisplayName "Block Orbis 9222 inbound" -Direction Inbound -Protocol TCP -LocalPort 9222 -RemoteAddress Any -Action Block
```

Also restrict **egress** when agents should only reach approved sites. Use an egress proxy with `--use-env-proxy` (see [network-and-proxies.md](./network-and-proxies.md)) or egress network policies. This limits both prompt-injection exfiltration and the impact of a hostile page reaching the host.

## 4. Process and tenant isolation

- **One process per tenant or trust domain.** Pages in one process share the Node.js heap, and the page sandbox is hardened but not perfect (section 2.6).
- **One page or context per credential set**, so that browsing other sites cannot act on an authenticated session (section 2.5).
- **Python and REST clients share the daemon's default page.** Never let two users or two agents share one daemon.
- **WebDriver sessions** have separate pages, but they still share one process. Do not mix tenants on one WebDriver daemon.
- **Recycle processes** regularly (see [production-deployment.md](./production-deployment.md#8-graceful-shutdown-and-process-recycling)) so leaked state and memory do not accumulate.
- **Least privilege:**
  - a non-root user,
  - a read-only filesystem except the sessions directory and `/tmp`,
  - dropped Linux capabilities,
  - no service-account token,
  - no cloud metadata access (block `169.254.169.254` egress).

## 5. Reverse proxy examples

A gateway in front of Orbis should:

- authenticate callers,
- restrict source IPs,
- block the file-system session endpoints,
- cap request bodies,
- support WebSocket upgrades for CDP.

### nginx

```nginx
# /etc/nginx/conf.d/orbis.conf
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

upstream orbis_backend { server 10.0.1.15:9222; }

server {
  listen 10.0.0.5:8443 ssl;
  server_name orbis.internal.example.com;
  ssl_certificate     /etc/nginx/tls/orbis.crt;
  ssl_certificate_key /etc/nginx/tls/orbis.key;

  client_max_body_size 1m;

  # Source allowlist
  allow 10.0.0.0/8;
  deny  all;

  # Block the session file endpoints
  location ~ ^/(orbis|memora)/session { return 403; }

  location / {
    # Shared-secret check (store the secret outside the repo, e.g. via an include)
    include /etc/nginx/secrets/orbis_token.conf;   # defines: set $orbis_token "Bearer <long-random-token>";
    if ($http_authorization != $orbis_token) { return 401; }

    proxy_pass http://orbis_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Authorization "";            # do not forward the gateway secret
    # If Orbis runs with ORBIS_API_KEY, add it here (from another include):
    # proxy_set_header x-api-key $orbis_api_key;
    proxy_read_timeout 300s;
  }
}
```

### Caddy

A Caddy configuration with the same policy is included in [production-deployment.md](./production-deployment.md#4-docker-compose-with-an-authenticating-reverse-proxy).

Because `/json/version` advertises Orbis's internal address, CDP clients behind a gateway should connect straight to the gateway's WebSocket URL (`wss://gateway/devtools/browser/memora-root`) and send the `Authorization` header with the connection.

## 6. Secrets, credentials and session files

- **Session files are credentials.** A saved session (`saveSession`, `memora_session`, `/orbis/session/save`) contains every cookie and storage value in plaintext JSON (see [sessions-and-auth.md](./sessions-and-auth.md)). Protect them:
  - Store them in a dedicated directory with mode `0700` (files `0600`), owned by the Orbis user.
  - Never commit them. The repository `.gitignore` ignores `sessions/`.
  - Encrypt them at rest if they leave the host (for example, in your secret manager or an encrypted volume).
  - Rotate them. Delete files when the account password changes or the session is revoked.
- **Do not put secrets in Orbis's environment** unless Orbis needs them. The page sandbox is hardened, not perfect (section 2.6), so keep what a sandbox escape could reach to a minimum.
- **Inject credentials from your secret manager at call time** in your own code, not through prompts or configuration files committed to git.
- **Custom headers** (`--http-header "Authorization: Bearer …"`) are sent to **every** host the browser contacts (unlike cookies, which are scoped to their site). Only use them when every URL in that process belongs to the same trusted service.
- **Test values only** in shared or staging environments.

## 7. Keeping secrets away from the LLM

Values typed through `act()`, `type()`, `fillForm()`, REST `/orbis/act`, `/orbis/fill-form`, or MCP `memora_act`/`memora_fill_form` are not shown to the model in action maps and diffs:

- in `actionMapText`, a filled text field shows `[FILLED]` instead of `value="..."`, password values are never included, and typed text never becomes a field's label;
- in `diff().summary`, text fields show `[filled]` or `[empty]` instead of the typed text.

The values are still in the page itself, so outputs that return raw page content can include them: `memora_html`, `fetch --dump html`, `page.evaluate()` / `memora_eval`, and any text a page script copies elsewhere on the page.

> **Changed in 0.2.0:** earlier versions showed typed values, including passwords, as `value="..."` in action maps and diffs.

Mitigations:

- Fill secrets **in code**, not via LLM tool calls. For example, run `fillForm({ '#password': secretFromVault })` in your own code before handing control to the model.
- Do not send raw HTML or `memora_eval` results from pages that contain typed secrets to a model.
- Prefer **restoring a saved session** (cookies) over typing credentials at all (see [sessions-and-auth.md](./sessions-and-auth.md)).
- Do not log raw snapshots or diffs from authenticated flows.

## 8. TLS

- Certificate verification is **on** by default for navigations, scripts and page `fetch()`.
- `--insecure-disable-tls-host-verification` (`network.insecureTls: true`) disables verification for direct connections and for connections through proxies. A man-in-the-middle can then read and modify everything, including credentials and session cookies. Use it only against staging hosts with self-signed certificates, never in production. Prefer adding your internal CA to Node.js with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.
- Plain `http://` URLs are fetched as-is. Orbis does not upgrade them to HTTPS.

## 9. Responsible automation

Orbis sends Chrome-like request headers by default (see [stealth.md](./stealth.md)). That is not permission to access a site.

- Respect `robots.txt` with `--obey-robots` / `network.obeyRobots` and an honest `--robots-agent` token (see [network-and-proxies.md](./network-and-proxies.md#robotstxt)).
- Follow each site's terms of service. Do not bypass access controls, paywalls or authentication you are not authorised to use.
- Rate-limit your own crawlers, identify yourself where appropriate (`--user-agent` with contact information for crawlers), and cache results.
- Handle personal data under the laws that apply to you (GDPR, CCPA, DPDP Act, and so on). Collect only what you need.

## 10. Hardening checklist

Network
- [ ] No Orbis port is reachable from the internet or from untrusted networks.
- [ ] `--host 0.0.0.0` (or a specific IP) is only used where other hosts must connect, and then `ORBIS_API_KEY` is set.
- [ ] A gateway with authentication, an IP allowlist and body-size limits fronts any shared daemon.
- [ ] Session files live in a dedicated folder (`ORBIS_SESSION_DIR`), or `/orbis/session*` and `/memora/session*` are blocked at the gateway.
- [ ] Egress is restricted to the sites the agent needs, and cloud metadata endpoints are blocked.

Process
- [ ] Orbis runs as a non-root user in a dedicated container or VM.
- [ ] The root filesystem is read-only; only the sessions directory and `/tmp` are writable.
- [ ] Orbis's environment holds no credentials, cloud keys or tokens it does not need.
- [ ] There is one process per tenant or trust domain, and one page per site and per credential set.
- [ ] Processes are recycled regularly.

Data
- [ ] Session files are permission-restricted, never committed, encrypted when moved, and rotated.
- [ ] Secrets are typed in code, and raw HTML or `memora_eval` output from pages holding typed secrets is not sent to a model.
- [ ] Debug logging (`DEBUG_CDP`, `DEBUG_WEBDRIVER`) is off in production or its output is redacted.
- [ ] `--insecure-disable-tls-host-verification` is not used in production.

Operations
- [ ] `ORBIS_NO_TELEMETRY=1` is set where outbound calls are not allowed.
- [ ] The Orbis version is pinned, and release notes are reviewed for security fixes before upgrading.
- [ ] MCP clients require confirmation for `memora_eval` and `memora_session` tool calls where the client supports it.

## 11. Reporting vulnerabilities

Do not open public issues for security vulnerabilities. Follow the process in [SECURITY.md](../SECURITY.md) at the repository root.
