# Production Deployment

This guide explains how to run Orbis reliably in production: which runtime mode to choose, how Orbis uses processes and memory, how to package it for Docker, Kubernetes, systemd and PM2, which timeouts apply, how to observe it, and what to check before going live. Read it together with [security.md](./security.md). The Orbis server has no working authentication in 0.1.0 and listens on every network interface by default, so network isolation is required.

Applies to: Orbis 0.1.0 (`@memoracompany/orbis` on npm, `memora-orbis` on PyPI)

## Contents

- [Licensing](#licensing)
- [1. Choose a runtime mode](#1-choose-a-runtime-mode)
- [2. Capacity and isolation model](#2-capacity-and-isolation-model)
- [3. Docker](#3-docker)
- [4. Docker Compose with an authenticating reverse proxy](#4-docker-compose-with-an-authenticating-reverse-proxy)
- [5. Kubernetes](#5-kubernetes)
- [6. systemd](#6-systemd)
- [7. PM2](#7-pm2)
- [8. Graceful shutdown and process recycling](#8-graceful-shutdown-and-process-recycling)
- [9. Timeouts](#9-timeouts)
- [10. Logging and observability](#10-logging-and-observability)
- [11. Outbound version check and air-gapped environments](#11-outbound-version-check-and-air-gapped-environments)
- [12. Using Orbis in CI](#12-using-orbis-in-ci)
- [13. Environment variables](#13-environment-variables)
- [14. Pre-launch checklist](#14-pre-launch-checklist)

---

## Licensing

Orbis is distributed under the **Commercial & Community Evaluation License** ([LICENSE.md](../LICENSE.md)). Read the license itself; this summary does not replace it.

- **Free use is limited** to downloading, installing, running and evaluating Orbis for development, proof-of-concept testing and personal educational use.
- **Production deployments, multi-agent fleet operations, dedicated SLAs, enterprise cloud orchestration and commercial product embedding require a commercial license** from Memora. Contact sales@memora.company.
- You may not reverse engineer, decompile or unpack the compiled engine.
- You may not repackage, re-license, sell or operate Orbis as a commercial multi-tenant cloud browser service without a commercial agreement.
- The software is provided "as is", without warranty.

The deployment patterns in this guide describe how to run Orbis well technically. They do not grant any right to run it in production. Make sure your licensing is in place first.

## 1. Choose a runtime mode

Orbis runs in three ways. They share one engine, but they differ in isolation, language support and attack surface.

| Mode | How you start it | Best for | Network exposure |
| :--- | :--- | :--- | :--- |
| **In-process SDK** | `OrbisAgent.launch()` or `new OrbisBrowser()` inside your Node.js service | Node.js/TypeScript agents and job workers. Gives the strongest isolation per job. | `OrbisAgent.launch()` also starts a CDP/HTTP server on `cdpPort` (default 9222). `new OrbisBrowser()` + `newPage()` opens **no** port. |
| **Daemon (CDP or WebDriver server)** | `orbis --port 9222` or `orbis serve --protocol webdriver --port 9515` | Python SDK, Playwright/Puppeteer over CDP, Selenium, polyglot stacks | Listens on TCP. Must be firewalled (see [security.md](./security.md)). |
| **MCP over stdio** | `orbis --mcp` launched by an MCP client | AI coding assistants (Claude Desktop, Cursor, Windsurf, Antigravity) | None. It talks over stdin/stdout only. |

Recommendations:

- **Node.js workers:** use `new OrbisBrowser()` and `browser.newPage()` directly when you don't need CDP. No port is opened, and each job gets its own page, cookie jar and JS context. Use `OrbisAgent.launch()` only when you also want to attach Playwright/Stagehand to the same process. Give every concurrent `launch()` a distinct `cdpPort`.
- **Python, or several languages:** run one daemon **per worker** (see section 2) and call it over the private network or loopback.
- **Selenium test suites:** use WebDriver mode. It is the only mode that gives each client its own isolated page per session.
- **Developer machines:** use MCP. Nothing listens on the network.

See [concepts.md](./concepts.md) for the engine architecture and [cli-reference.md](./cli-reference.md) for every flag.

## 2. Capacity and isolation model

Understanding these facts prevents most production incidents.

**One Orbis process is one Node.js event loop.** Page scripts run synchronously in `node:vm` contexts inside that process. A CPU-heavy page blocks every other page in the same process for up to 5 seconds per script batch (see [Timeouts](#9-timeouts)). Scale out with more processes, not more pages per process.

**The daemon's REST and Python API share one page.** The agent endpoints (`/orbis/goto`, `/orbis/act`, `/orbis/fill-form`, `/orbis/snapshot`, `/orbis/diff`, `/orbis/session`) work on the browser's *default page* unless you pass `?id=<pageId>`. `/orbis/goto` always uses the default page, and the Python SDK never sends an `id`. Two Python agents talking to the same daemon will overwrite each other's page, cookies and history.

> **Known issue (0.1.0):** `GET /orbis/goto` ignores `id` and always navigates the default page. The Python SDK has no way to select a page. Isolate Python agents by giving each one its own daemon.

**CDP clients get their own pages, but share the process.** Playwright/Puppeteer `newPage()` creates a separate page, and each page has its own cookie jar. A CDP `Browser.close` command closes **every** page in the daemon, including pages that belong to other clients.

**WebDriver sessions are isolated.** Each `POST /session` gets its own browser instance and page. Defaults:

| Setting | Default | Configurable |
| :--- | :--- | :--- |
| Maximum concurrent sessions | 16 | `--max-sessions <n>` |
| Idle session reaper | Sessions unused for 5 minutes are closed (checked every 5 s) | Only programmatically (`new WebDriverServer({ sessionIdleTimeoutMs })`) |
| `/status` `ready` | `false` once the session limit is reached | Use it for load-balancer readiness |

**Recommended topologies**

| Workload | Topology |
| :--- | :--- |
| Node.js job queue (scraping, form automation) | In-process `OrbisBrowser`, one page per job, `page.close()` (or `browser.closePage(id)`) when done |
| Python agents (LangChain, CrewAI, custom) | One daemon per worker process, bound to loopback or a private pod network, on its own port |
| Playwright/Puppeteer fleet | One daemon per worker, or a small pool of daemons with sticky assignment. Never call `browser.close()` on a shared daemon. |
| Selenium grid replacement | WebDriver daemons behind a load balancer that reads `/status` `ready`, with `--max-sessions` sized to the CPU you give each process |

**Memory.** Measured on a Windows 11 laptop (Node 22, 30 Oct 2026), an Orbis process with 10 local test pages open used about 107 MB resident memory. In the same test, headless Chrome used 1,154 MB (see the [benchmark notes](../README.md)). Real-world memory depends on page size, script count and how many pages you keep open. Measure with your own workload, and size limits from that measurement, not from these figures.

## 3. Docker

The image below installs the published npm package, runs as the unprivileged `node` user, and exposes a health check.

```dockerfile
# Dockerfile
FROM node:22-alpine

ENV NODE_ENV=production \
    ORBIS_NO_TELEMETRY=1

# Install the published package globally (registers the `orbis` binary)
RUN npm install -g @memoracompany/orbis@0.1.0 && npm cache clean --force

# Writable directory for session files only
RUN mkdir -p /data/sessions && chown -R node:node /data
WORKDIR /data
USER node

EXPOSE 9222

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9222/json/version >/dev/null || exit 1

ENTRYPOINT ["orbis"]
# 0.0.0.0 is required inside a container. Only ever publish this port on a private network.
CMD ["--port", "9222", "--host", "0.0.0.0"]
```

Build and run without publishing the port to the host's public interfaces:

```bash
docker build -t orbis:0.1.0 .
```

```bash
docker run -d --name orbis --read-only --tmpfs /tmp -v orbis-sessions:/data/sessions --memory 512m --cpus 1 -p 127.0.0.1:9222:9222 orbis:0.1.0
```

Notes:

- `-p 127.0.0.1:9222:9222` publishes only on the host's loopback. Never use `-p 9222:9222`. It publishes on every host interface.
- Stealth is on by default. There is no `--stealth` flag. Use `--no-stealth` to turn it off (see [stealth.md](./stealth.md)).
- The Alpine image has no Chrome, so `--mcp --engine auto` uses the native engine automatically. The Chrome engine is only used in MCP mode.
- For a WebDriver image, change `CMD` to `["serve", "--protocol", "webdriver", "--port", "9515", "--host", "0.0.0.0", "--max-sessions", "8"]` and `EXPOSE 9515`. Its health endpoint is `GET /status`.
- Pin the version (`@0.1.0`) so rebuilds are reproducible.

## 4. Docker Compose with an authenticating reverse proxy

Orbis 0.1.0 does not enforce API keys (see [security.md](./security.md#2-verified-security-properties-of-010)). If more than one host must reach the daemon, put a reverse proxy in front of it that does the authentication. Keep Orbis on an internal-only network.

```yaml
# docker-compose.yml
services:
  orbis:
    image: orbis:0.1.0
    read_only: true
    tmpfs: [/tmp]
    volumes:
      - orbis-sessions:/data/sessions
    networks: [orbis-internal]
    # No "ports:" section: Orbis is unreachable from outside the compose network
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }
    restart: unless-stopped

  gateway:
    image: caddy:2-alpine
    ports:
      - "10.0.0.5:8443:8443"      # bind to a private interface, not 0.0.0.0
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    environment:
      ORBIS_GATEWAY_TOKEN: ${ORBIS_GATEWAY_TOKEN:?set a long random token}
    networks: [orbis-internal, edge]
    depends_on: [orbis]
    restart: unless-stopped

networks:
  orbis-internal:
    internal: true
  edge: {}

volumes:
  orbis-sessions: {}
```

```caddyfile
# Caddyfile
https://orbis.internal.example.com:8443 {
  tls internal

  @allowed {
    remote_ip 10.0.0.0/8
    header Authorization "Bearer {$ORBIS_GATEWAY_TOKEN}"
  }

  # Never expose session file endpoints through the gateway (arbitrary file read/write)
  @sessionFiles path /orbis/session /orbis/session/* /memora/session /memora/session/*
  respond @sessionFiles 403

  handle @allowed {
    reverse_proxy orbis:9222
  }
  respond 401
}
```

An equivalent nginx configuration is in [security.md](./security.md#5-reverse-proxy-examples). Both examples proxy the CDP WebSocket (`/devtools/...`), and clients must send the `Authorization` header on the WebSocket upgrade too.

Orbis builds `webSocketDebuggerUrl` in `/json/version` from its own `--host` and `--port`. Behind a gateway that URL points at the internal address, so CDP clients should connect to the WebSocket URL through the gateway directly instead of using HTTP discovery:

```ts
const browser = await chromium.connectOverCDP('wss://orbis.internal.example.com:8443/devtools/browser/memora-root', {
  headers: { Authorization: `Bearer ${process.env.ORBIS_GATEWAY_TOKEN}` },
});
```

## 5. Kubernetes

The manifest runs one daemon per pod, reachable only through a ClusterIP Service and only from pods labelled `orbis-client: "true"`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orbis
  labels: { app: orbis }
spec:
  replicas: 3
  selector:
    matchLabels: { app: orbis }
  template:
    metadata:
      labels: { app: orbis }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000          # the "node" user in node:22-alpine
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      terminationGracePeriodSeconds: 30
      containers:
        - name: orbis
          image: registry.example.com/orbis:0.1.0
          args: ["--port", "9222", "--host", "0.0.0.0"]
          env:
            - name: ORBIS_NO_TELEMETRY
              value: "1"
          ports:
            - name: cdp
              containerPort: 9222
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits:   { cpu: "1",    memory: "768Mi" }
          readinessProbe:
            httpGet: { path: /json/version, port: cdp }
            periodSeconds: 10
            timeoutSeconds: 3
          livenessProbe:
            httpGet: { path: /json/version, port: cdp }
            initialDelaySeconds: 5
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 4
          lifecycle:
            preStop:
              exec:
                # Give the Service time to stop routing before SIGTERM arrives
                command: ["sh", "-c", "sleep 5"]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            - { name: sessions, mountPath: /data/sessions }
      volumes:
        - name: tmp
          emptyDir: {}
        - name: sessions
          emptyDir: { sizeLimit: 100Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: orbis
spec:
  type: ClusterIP
  selector: { app: orbis }
  ports:
    - name: cdp
      port: 9222
      targetPort: cdp
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: orbis-ingress
spec:
  podSelector:
    matchLabels: { app: orbis }
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels: { orbis-client: "true" }
      ports:
        - { protocol: TCP, port: 9222 }
```

Kubernetes notes:

- **State lives in the pod.** The daemon keeps pages, cookies and the default page in memory. Load-balancing a stateful agent across replicas breaks its session. Use one of these patterns:
  - a sidecar container (an Orbis daemon in the same pod as each agent, called over `127.0.0.1`), or
  - a StatefulSet with per-pod DNS and sticky assignment, or
  - WebDriver mode, where every session is self-contained and `/status` tells the balancer whether a pod has capacity.
- **Sidecar is the simplest isolation.** Run Orbis in the agent's pod and leave out the Service and NetworkPolicy. Only the agent container can reach it, but containers in a pod share the loopback interface, so any other container in that pod can too.
- **Egress.** Orbis fetches arbitrary URLs. If agents must only reach approved sites, add an egress NetworkPolicy or an egress proxy, and configure the proxy with `--use-env-proxy` (see [network-and-proxies.md](./network-and-proxies.md)).
- For WebDriver pods, use `GET /status` for readiness. It returns `ready: false` once `--max-sessions` is reached.

## 6. systemd

```ini
# /etc/systemd/system/orbis.service
[Unit]
Description=Orbis by Memora (CDP daemon)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=orbis
Group=orbis
Environment=NODE_ENV=production
Environment=ORBIS_NO_TELEMETRY=1
WorkingDirectory=/var/lib/orbis
# Bind to a specific private interface; "localhost" and "127.0.0.1" bind 0.0.0.0 in 0.1.0
ExecStart=/usr/bin/orbis --port 9222 --host 10.0.0.5
Restart=always
RestartSec=2
# Recycle the process daily to bound memory growth
RuntimeMaxSec=86400
MemoryMax=768M
CPUQuota=100%
KillSignal=SIGTERM
TimeoutStopSec=20

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/orbis/sessions
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/lib/orbis --shell /usr/sbin/nologin orbis
```

```bash
sudo mkdir -p /var/lib/orbis/sessions && sudo chown -R orbis:orbis /var/lib/orbis
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now orbis
```

Find the binary path with `which orbis` after `npm i -g @memoracompany/orbis`.

> **Known issue (0.1.0):** passing `--host localhost` or `--host 127.0.0.1` makes Orbis listen on `0.0.0.0` (all interfaces). To listen on one interface only, pass that interface's IP, for example `--host 10.0.0.5`. For loopback-only access, use `--host 127.0.0.2`. It is a loopback address that Orbis does not rewrite. It works out of the box on Linux and Windows; on macOS, first run `sudo ifconfig lo0 alias 127.0.0.2`. Clients then connect to `http://127.0.0.2:<port>`. Either way, also firewall the port.

> **Known issue (0.1.0):** do not pass an IPv6 literal such as `--host ::1`. The server starts, but the first HTTP request crashes the process (`new URL('http://::1:…')` is invalid), and the advertised `webSocketDebuggerUrl` is malformed.

## 7. PM2

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'orbis-worker-1',
      script: 'orbis',                 // global binary from npm i -g @memoracompany/orbis
      interpreter: 'none',
      args: '--port 9301 --host 127.0.0.2',
      env: { NODE_ENV: 'production', ORBIS_NO_TELEMETRY: '1' },
      max_memory_restart: '600M',      // recycle when memory grows
      kill_timeout: 15000,             // time allowed for SIGINT shutdown
      autorestart: true,
    },
    {
      name: 'orbis-worker-2',
      script: 'orbis',
      interpreter: 'none',
      args: '--port 9302 --host 127.0.0.2',
      env: { NODE_ENV: 'production', ORBIS_NO_TELEMETRY: '1' },
      max_memory_restart: '600M',
      kill_timeout: 15000,
    },
  ],
};
```

Do not use PM2 cluster mode (`exec_mode: 'cluster'`). Clustered workers share one port, so consecutive requests from one agent can land on different processes that hold different page state. Run one named process per port instead.

## 8. Graceful shutdown and process recycling

| Mode | Signal handling |
| :--- | :--- |
| CDP daemon | `SIGINT`/`SIGTERM` → prints `Shutting down browser server...`, closes the WebSocket and HTTP servers, closes all pages, exits 0. Closing the HTTP server waits for open keep-alive connections, so set a stop timeout (`TimeoutStopSec`, `terminationGracePeriodSeconds`, `kill_timeout`). |
| WebDriver daemon | `SIGINT`/`SIGTERM` → closes every session, force-closes connections, exits 0. |
| MCP | `SIGINT`/`SIGTERM` → closes the engine (including a launched Chrome in Chrome mode), exits 0. |
| In-process SDK | Your responsibility: `await agent.close()` or `browser.close()`. |

There is no built-in memory cap and no automatic page eviction for CDP/REST pages. Pages created with `/json/new` or by CDP clients stay in memory until closed (`/json/close/<id>`, `Target.closeTarget`, `page.close()` in Playwright). Recommended practice:

- Close pages explicitly when a job finishes.
- Recycle long-running daemons on a schedule or memory threshold (`RuntimeMaxSec`, `max_memory_restart`, Kubernetes memory limits plus restarts).
- In the SDK, create a fresh `OrbisBrowser` per tenant or per batch and `close()` it afterwards. This also clears that browser's cookies.

## 9. Timeouts

| Timeout | Default | Where it applies | How to change it |
| :--- | :--- | :--- | :--- |
| Navigation (HTTP request incl. redirects) | 20 000 ms | `page.goto()`, `agent.goto()`, REST `/orbis/goto`, CDP `Page.navigate` | `page.goto(url, { timeoutMs })`; MCP `memora_browse` `timeout` argument |
| Fetcher default | 15 000 ms | Only requests that do not pass their own timeout | `--http-timeout` / `network.timeoutMs` (see the known issue below) |
| Post-load settle (await page fetch/promises/short timers) | 5 000 ms, capped by the navigation deadline | Every `goto()` in SDK, CDP and REST | `page.settleTimeoutMs = n` or `page.goto(url, { settleTimeoutMs })`; `0` disables |
| Page script watchdog | 5 000 ms per batch of page scripts | Classic and module `<script>` execution | Not configurable. The batch is stopped and `Script terminated after 5000ms` is logged. |
| `evaluate()` / CDP `Runtime.evaluate` | 30 000 ms | SDK and CDP script evaluation | Not configurable |
| WebDriver page load | 300 000 ms | `driver.get()` | Selenium `set_page_load_timeout()` / `timeouts` capability |
| WebDriver script | 30 000 ms | `execute_script`, `execute_async_script` | Selenium `set_script_timeout()` |
| WebDriver implicit wait | 0 ms | `find_element` | Selenium `implicitly_wait()` |
| robots.txt fetch | 10 000 ms | `--obey-robots` | Not configurable |
| Python SDK HTTP | 5 s connect check, 15 s per call, 10 s for `markdown()` | `orbis` Python package | Not configurable (wrap calls, or call the REST API directly) |

> **Known issue (0.1.0):** `--http-timeout` and `network.timeoutMs` do not affect page navigations. `page.goto()` always passes its own timeout (20 000 ms by default), and that value takes precedence. Verified: with `--http-timeout 200`, a page that takes 1.5 s still loads. To shorten navigations, call `page.goto(url, { timeoutMs })` (SDK) or pass `timeout` to `memora_browse` (MCP).

> **Known issue (0.1.0):** the Python SDK's 15-second HTTP timeout is shorter than the daemon's 20-second navigation timeout, so a slow page can raise a Python timeout while the daemon is still loading it. See [troubleshooting.md](./troubleshooting.md#python-sdk-calls-time-out).

> **Note:** WebDriver `driver.get()` navigates with the settle phase disabled (`settleTimeoutMs: 0`). Asynchronous page work (`fetch` + render) may not be finished when `get()` returns, so use explicit waits (`WebDriverWait`) in Selenium tests.

## 10. Logging and observability

| Signal | How to get it |
| :--- | :--- |
| CDP traffic | `DEBUG_CDP=1` logs every CDP request, response and event (method names, ids, session ids) to stdout. Very verbose, so enable it only when debugging. |
| WebDriver traffic | `DEBUG_WEBDRIVER=1` writes `[WebDriver] METHOD /path body…` (first 200 bytes) to stderr |
| Page console | SDK: `page.getLogs()` / `page.clearLogs()`; MCP: `memora_console`; Chrome engine: browser console messages |
| Script errors | Logged into the page console (`Uncaught …`, `Failed to load script …`, `Script terminated after 5000ms`) |
| robots.txt blocks | `[Memora] blocked by robots.txt: <url>` on stderr; the navigation throws `RobotsBlockedError` (`code: 'ERR_BLOCKED_BY_ROBOTS'`) |
| Health | CDP: `GET /json/version` (200 JSON). WebDriver: `GET /status` (`value.ready`). |
| Process metrics | Use your platform: container memory/CPU, Node.js RSS. Orbis has no metrics endpoint. |

> **Caution:** `DEBUG_CDP` output can contain URLs, form values typed through CDP and script source. Do not ship it to shared log stores without redaction.

Recommended application-level metrics, emitted by your own wrapper code: navigation latency and status code (`page.goto()` returns `{ status, url }`), `tokenEstimate` and `interactiveCount` per snapshot, form-fill `skipped` fields, robots blocks, and timeouts.

## 11. Outbound version check and air-gapped environments

When the server starts (CDP, WebDriver, MCP and `--eval` modes), Orbis sends one request in the background to `https://orbis.memora.company/api/v1/version-check?v=0.1.0`, with a 1.5-second timeout. It never blocks startup and fails silently. The `fetch` subcommand does not perform this check.

Disable it with either variable:

```bash
export ORBIS_NO_TELEMETRY=1
```

`NODE_ENV=test` also disables it. Set `ORBIS_NO_TELEMETRY=1` in:

- air-gapped or egress-restricted networks,
- **MCP configurations.** If a newer version is announced, the update notice is printed with `console.log`, which writes to stdout. In MCP mode stdout is the JSON-RPC channel, so a strict MCP client may reject that line (see [mcp.md](./mcp.md)).

## 12. Using Orbis in CI

Smoke-check a deployment with the `fetch` subcommand. It exits with code 1 when the request fails:

```bash
npx -y @memoracompany/orbis fetch https://staging.example.com/health --dump action_map --http-timeout 15000
```

Do not rely on `--eval` in CI. It prints errors but always exits 0.

Example GitHub Actions job running Selenium tests against Orbis:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      ORBIS_NO_TELEMETRY: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: npm install -g @memoracompany/orbis@0.1.0
      - name: Start Orbis WebDriver
        run: |
          orbis serve --protocol webdriver --port 9515 > orbis.log 2>&1 &
          for i in $(seq 1 30); do curl -sf http://127.0.0.1:9515/status && break; sleep 1; done
      - run: pip install selenium pytest
      - run: pytest tests/e2e
      - if: failure()
        run: cat orbis.log
```

See [selenium-webdriver.md](./selenium-webdriver.md) for the supported command set.

## 13. Environment variables

| Variable | Effect |
| :--- | :--- |
| `ORBIS_NO_TELEMETRY` | Any non-empty value disables the startup version check |
| `NODE_ENV=test` | Also disables the version check |
| `DEBUG_CDP` | Verbose CDP logging to stdout |
| `DEBUG_WEBDRIVER` | WebDriver request logging to stderr |
| `ORBIS_API_KEY` / `MEMORA_API_KEY` | Read by the SDKs and sent as `x-api-key` and `Authorization: Bearer` headers. **Not enforced by the 0.1.0 server.** It is only useful if a gateway checks it. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and lower-case forms) | Used only with `--use-env-proxy` / `network.useEnvProxy` |
| `LOCALAPPDATA` | Windows: used to locate a per-user Chrome install for the MCP Chrome engine |

## 14. Pre-launch checklist

Network and security

- [ ] The Orbis port is unreachable from the internet (firewall, no public `-p`, ClusterIP + NetworkPolicy, or a sidecar).
- [ ] You don't rely on `--host localhost` / `127.0.0.1` for isolation (both bind `0.0.0.0` in 0.1.0).
- [ ] Any cross-host access goes through a reverse proxy that authenticates callers and blocks `/orbis/session*` and `/memora/session*`.
- [ ] Tenants and credentials are isolated per process (see [security.md](./security.md)).
- [ ] Session files are stored in a dedicated, access-restricted directory, and treated as secrets.
- [ ] `--insecure-disable-tls-host-verification` is not set in production.

Reliability

- [ ] One daemon per Python agent, or WebDriver sessions, or in-process pages. No shared default page between agents.
- [ ] Pages are closed after each job; daemons are recycled on a schedule or memory threshold.
- [ ] Health checks use `/json/version` (CDP) or `/status` (WebDriver).
- [ ] The stop timeout is at least 15–30 s.
- [ ] Navigation timeouts are set per call (`page.goto(url, { timeoutMs })`), not through `--http-timeout`.
- [ ] Your wrapper catches navigation errors, timeouts and `RobotsBlockedError`.

Compliance and operations

- [ ] A commercial license from Memora covers this production use (see [Licensing](#licensing) and [LICENSE.md](../LICENSE.md)).
- [ ] `--obey-robots` is enabled for crawling, with a `--robots-agent` token that identifies you (see [network-and-proxies.md](./network-and-proxies.md#robotstxt)).
- [ ] The target sites' terms of service permit automated access.
- [ ] `ORBIS_NO_TELEMETRY=1` is set where outbound calls are not allowed, and in MCP configs.
- [ ] The package version is pinned (`@memoracompany/orbis@0.1.0`).
- [ ] You have reviewed [limitations.md](./limitations.md) for features your workflow depends on (iframes, shadow DOM, screenshots, file upload).
