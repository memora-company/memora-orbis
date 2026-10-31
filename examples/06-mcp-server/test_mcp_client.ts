/**
 * Example 06: Talk to the Orbis MCP server with raw JSON-RPC over stdio
 *
 * This is what Claude Desktop, Claude Code, Cursor and other MCP clients do under the hood.
 * It starts `orbis --mcp`, initializes, lists the tools, browses a local page and acts on it.
 *
 * Run: npm install && npm start
 */
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const SITE = 'http://127.0.0.1:18095';

const site = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url?.startsWith('/search')) {
    const q = new URL(req.url, SITE).searchParams.get('q') ?? '';
    res.end(`<!DOCTYPE html><html><head><title>Results for ${q}</title></head><body><h1>Results for "${q}"</h1></body></html>`);
    return;
  }
  res.end(`<!DOCTYPE html><html><head><title>Docs search</title></head><body>
    <h1>Documentation</h1>
    <form action="/search" method="get"><input name="q" placeholder="Search docs"><button type="submit">Search</button></form>
  </body></html>`);
});

async function main() {
  await new Promise<void>((resolve) => site.listen(18095, '127.0.0.1', resolve));

  // The orbis binary comes from the @memoracompany/memora-orbis dependency of this example.
  // --engine native keeps the result identical on machines with and without Chrome.
  const child = spawn('npx', ['orbis', '--mcp', '--engine', 'native'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, ORBIS_NO_TELEMETRY: '1' },
  });

  // Responses are newline-delimited JSON. Match them to requests by id.
  const pending = new Map<number, (msg: any) => void>();
  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });

  let nextId = 1;
  // Send one request and wait for its response. Await each call: the server handles
  // requests concurrently, so a second tool call sent early can race the first.
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 30000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = await request('tools/call', { name, arguments: args });
    const text = res.result?.content?.[0]?.text ?? JSON.stringify(res.error);
    if (res.result?.isError) throw new Error(text);
    return text as string;
  };

  try {
    const init = await request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'orbis-example', version: '1.0.0' },
      capabilities: {},
    });
    console.log(`Server: ${init.result.serverInfo.title} ${init.result.serverInfo.version} (protocol ${init.result.protocolVersion})`);
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const tools = await request('tools/list');
    console.log(`Tools (${tools.result.tools.length}): ${tools.result.tools.map((t: any) => t.name).join(', ')}\n`);

    console.log(await callTool('memora_browse', { url: SITE, exclude: ['footer'] }), '\n');
    console.log(await callTool('memora_fill_form', { fields: { 'placeholder:Search docs': 'mcp' }, submitActionId: 'text=Search' }), '\n');
    console.log(await callTool('memora_extract', { selector: 'h1', attribute: 'text' }));
  } finally {
    child.kill();
    site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
