# Security Guide

This guide describes the security properties of Orbis 0.1.0 as verified against its source code and at runtime, the threats that matter in production, and how to harden a deployment. Orbis loads untrusted web content, executes its JavaScript, and exposes powerful remote-control interfaces (CDP, REST, WebDriver, MCP). Treat every Orbis process as **a component that can be fully controlled by both the websites it visits and anyone who can reach its port**, and isolate it accordingly.

Applies to: Orbis 0.1.2 (`@memoracompany/memora-orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [1. Threat model](#1-threat-model)
- [2. Verified security properties of 0.1.0](#2-verified-security-properties-of-010)
- [3. Network isolation](#3-network-isolation)
- [4. Process and tenant isolation](#4-process-and-tenant-isolation)
- [5. Reverse proxy examples](#5-reverse-proxy-examples)
- [6. Secrets, credentials and session files](#6-secrets-credentials-and-session-files)
- [7. Keeping secrets away from the LLM](#7-keeping-secrets-away-from-the-llm)
- [8. TLS](#8-tls)
- [9. Responsible automation](#9-responsible-automation)
- [10. Hardening checklist](#10-hardening-checklist)
- [11. Reporting vulnerabilities](#11-reporting-vulnerabilities)

---

## 1. Threat model

| Actor | What they can do in 0.1.0 if not mitigated |
| :--- | :--- |
| **Anyone who can reach the CDP/REST port** | Navigate pages, read page content and cookies, run JavaScript in any page, read and write files through the session endpoints, and close every page |
| **Anyone who can reach the WebDriver port** | Create sessions (up to `--max-sessions`), navigate, run scripts, read cookies |
| **A website the agent visits** | Run JavaScript that reaches the host Node.js process. That is code execution with the privileges of the Orbis process (see [2.6](#26-page-javascript-is-not-sandboxed)). It also receives cookies that other sites set in the same page (see [2.5](#25-cookies-are-not-scoped-to-a-site)). |
| **A prompt-injected LLM** (via page content) | Ask the agent to visit attacker URLs, submit forms, exfiltrate data through query strings, call `memora_eval`, or save/load session files at arbitrary paths |
| **Whoever can read your logs or prompts** | See typed values (passwords, OTPs) that appear in action maps and diffs (see [section 7](#7-keeping-secrets-away-from-the-llm)) |

Design principle: **the Orbis process is untrusted.** Give it nothing it does not need: no cloud credentials, no access to internal admin networks, no writable application directories, no shared tenancy.

## 2. Verified security properties of 0.1.0

Each item below was confirmed by reading `memora-browser/src` and, where marked, by running the 0.1.0 build.

### 2.1 The server listens on all interfaces by default

The CDP/REST server and the WebDriver server both replace `localhost` and `127.0.0.1` with `0.0.0.0` before listening. **Verified at runtime:** `OrbisAgent.launch()` with the default host reported bind address `0.0.0.0`. The default `orbis --port 9222` is therefore reachable from any network the machine is attached to.

> **Known issue (0.1.0):** `--host localhost` and `--host 127.0.0.1` bind `0.0.0.0`. Workarounds:
> - Bind a specific private IP (`--host 10.0.0.5`).
> - Bind the alternative loopback address `--host 127.0.0.2` (verified; on macOS run `sudo ifconfig lo0 alias 127.0.0.2` first).
> - Run Orbis in a container whose port is not published.
>
> Do **not** use an IPv6 literal such as `--host ::1`. The process crashes on the first request.

### 2.2 API keys are not enforced

`OrbisAgent.launch({ apiKey })`, `ORBIS_API_KEY` and `MEMORA_API_KEY` are stored, and the TypeScript and Python clients send them as `x-api-key` and `Authorization: Bearer` headers. The server contains an authorization routine, but nothing calls it. **Verified at runtime:** with an API key configured, an unauthenticated `GET /json/version` returned HTTP 200, and so did the agent endpoints.

> **Known issue (0.1.0):** the API key provides no protection. Enforce authentication in a reverse proxy ([section 5](#5-reverse-proxy-examples)) or rely purely on network isolation.

### 2.3 CORS allows every origin

HTTP responses carry `Access-Control-Allow-Origin: *`. Any web page open in a developer's normal browser can call `http://localhost:9222/orbis/...` from JavaScript. Through the session endpoints it can then read cookies or files. Developers running a daemon locally are exposed to this while they browse.

Mitigations:
- Prefer MCP (stdio) or the in-process SDK on workstations.
- Stop daemons when they are not in use.
- Never keep real credentials in a local daemon's session.

### 2.4 Session endpoints read and write arbitrary paths

| Endpoint | Behaviour |
| :--- | :--- |
| `POST /orbis/session` with `{"filePath": "..."}` (also `/memora/session`) | Reads and parses **any path** the process can read. Parse errors are returned to the caller and can include a fragment of the file's content. |
| `POST /orbis/session/save` with `{"filePath": "..."}` (also `/memora/session/save`) | Writes JSON to **any path** the process can write, creating directories as needed, and overwrites existing files |
| CDP `Orbis.saveSession` / `Orbis.loadSession` (also `Memora.*`, `LP.*`) | Same behaviour over CDP |
| MCP `memora_session` | Same behaviour, driven by the LLM's tool call |

Mitigations:
- Run as an unprivileged user.
- Use a read-only root filesystem with a single writable sessions directory.
- Block these paths at the gateway.
- In MCP setups, review tool calls that touch paths.

### 2.5 Cookies are not scoped to a site

The native engine stores cookies as a single `name â†’ value` map per page. It ignores `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite` and expiry dates; only `Max-Age=0` and pre-1980 `Expires` delete a cookie. Every stored cookie is sent to **every** host the page requests, including subresources and page `fetch()` calls. **Verified at runtime:** a cookie set by `http://127.0.0.1:18081/set` was sent to `http://localhost:18081/echo`.

Consequences:
- After logging in to site A, any later navigation, script or `fetch()` to site B leaks A's session cookie to B.
- Cookies with the same name from two sites overwrite each other.
- A cookie marked `Secure` is also sent over plain HTTP.

> **Known issue (0.1.0):** never visit untrusted or third-party URLs in a page or browser that holds authentication cookies. Use one page (or one `OrbisBrowser`) per site and per credential set. The Chrome engine (MCP `--engine chrome`) uses Chrome's normal cookie scoping.

### 2.6 Page JavaScript is not sandboxed

Pages execute inside Node.js `node:vm` contexts. The Node.js documentation states that `node:vm` is not a security mechanism. **Verified at runtime:** a page `<script>` obtained the host `process` object through the constructor of a host-provided function, including `process.getBuiltinModule`. Any website loaded by the native engine can therefore read and write files, open network connections, read environment variables (including secrets) and start processes with the privileges of the Orbis process.

> **Known issue (0.1.0):** treat visiting a URL as running that site's code on your host. Required mitigations:
> - Run Orbis in a dedicated container or VM, as an unprivileged user, with no secrets in its environment and no access to internal networks it does not need.
> - Do not embed the in-process SDK (`OrbisBrowser` / `OrbisAgent.launch()`) in a service that holds credentials, unless every URL it visits is trusted.
> - Prefer a separate daemon process per trust domain.

The same applies to code you run deliberately: `page.evaluate()`, CDP `Runtime.evaluate`/`callFunctionOn`, WebDriver `execute_script` and MCP `memora_eval` all run with host reach. Expose them only to trusted callers.

### 2.7 Other properties

| Property | Detail |
| :--- | :--- |
| No request size limits | HTTP bodies are buffered fully in memory. Put a body-size limit in the gateway. |
| No rate limiting | Add it at the gateway if the daemon is shared |
| Browser-wide close | CDP `Browser.close` closes every page in the daemon |
| Logs | `DEBUG_CDP` / `DEBUG_WEBDRIVER` print request contents, which can include typed values |
| Outbound call | A startup version check calls `orbis.memora.company` unless `ORBIS_NO_TELEMETRY=1` (see [production-deployment.md](./production-deployment.md#11-outbound-version-check-and-air-gapped-environments)) |

## 3. Network isolation

Use the strongest of these that fits your topology:

1. **No listener at all.** Use `new OrbisBrowser()` + `newPage()` in-process (no port), or MCP over stdio.
2. **Loopback only.** `--host 127.0.0.2` and connect to `http://127.0.0.2:<port>`. Alternatively, in Docker, publish with `-p 127.0.0.1:9222:9222`.
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

- **One process per tenant or trust domain.** Pages in one process share the Node.js heap, and page scripts can reach the process (section 2.6).
- **One page per site and per credential set**, because cookies are not scoped (section 2.5).
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

  # Block arbitrary file read/write endpoints
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
- **Do not put secrets in Orbis's environment** unless Orbis needs them. Hostile pages can read `process.env` (section 2.6).
- **Inject credentials from your secret manager at call time** in your own code, not through prompts or configuration files committed to git.
- **Custom headers** (`--http-header "Authorization: Bearer â€¦"`) are sent to **every** host the browser contacts, the same as cookies. Only use them when every URL in that process belongs to the same trusted service.
- **Test values only** in shared or staging environments.

## 7. Keeping secrets away from the LLM

Values typed through `act()`, `type()`, `fillForm()`, REST `/orbis/act`, `/orbis/fill-form`, or MCP `memora_act`/`memora_fill_form` are written to the element's `value` attribute. As a result they appear:

- in later snapshots' `actionMapText`, for example `[@2] [input] "Password" type="password" value="correct-horse" ...`,
- in `diff().summary`, for example `* [@2] [input] "Password" (value: undefined -> "correct-horse")`,
- in the Markdown or HTML returned by `memora_html`, `fetch --dump html`, and similar outputs.

If you send the action map or diff to a model, you send it the password, OTP or API key too.

Mitigations:

- Fill secrets **in code**, not via LLM tool calls. For example, run `fillForm({ '#password': secretFromVault }, false)` in your own code before handing control to the model.
- **Redact before prompting.** For example, replace `value="..."` on `type="password"` entries:

```ts
const redact = (text: string) =>
  text.replace(/(type="password"[^\n]*?) value="[^"]*"/g, '$1 value="[REDACTED]"')
      .replace(/(value: )[^,)]*( -> )"[^"]*"/g, '$1[REDACTED]$2"[REDACTED]"');

const snap = agent.snapshot();
const safeForLlm = redact(snap.actionMapText);
```

  The second pattern redacts every value change in a diff summary. Apply it to diffs that may contain typed secrets.
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
- [ ] You don't depend on `--host localhost` / `127.0.0.1` for isolation; you use a specific IP, `127.0.0.2`, or an unpublished container port.
- [ ] A gateway with authentication, an IP allowlist and body-size limits fronts any shared daemon.
- [ ] `/orbis/session*` and `/memora/session*` are blocked at the gateway.
- [ ] Egress is restricted to the sites the agent needs, and cloud metadata endpoints are blocked.

Process
- [ ] Orbis runs as a non-root user in a dedicated container or VM.
- [ ] The root filesystem is read-only; only the sessions directory and `/tmp` are writable.
- [ ] Orbis's environment holds no credentials, cloud keys or tokens it does not need.
- [ ] There is one process per tenant or trust domain, and one page per site and per credential set.
- [ ] Processes are recycled regularly.

Data
- [ ] Session files are permission-restricted, never committed, encrypted when moved, and rotated.
- [ ] Secrets are typed in code and redacted from action maps and diffs before any LLM call.
- [ ] Debug logging (`DEBUG_CDP`, `DEBUG_WEBDRIVER`) is off in production or its output is redacted.
- [ ] `--insecure-disable-tls-host-verification` is not used in production.

Operations
- [ ] `ORBIS_NO_TELEMETRY=1` is set where outbound calls are not allowed.
- [ ] The Orbis version is pinned, and release notes are reviewed for security fixes before upgrading.
- [ ] MCP clients require confirmation for `memora_eval` and `memora_session` tool calls where the client supports it.

## 11. Reporting vulnerabilities

Do not open public issues for security vulnerabilities. Follow the process in [SECURITY.md](../SECURITY.md) at the repository root.
