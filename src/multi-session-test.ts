import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeTestBaseConfig } from './test-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const adapterEntry = resolve(root, 'dist', 'index.js');
const testDir = resolve(root, 'logs', 'multi-session');
await rm(testDir, { recursive: true, force: true });
await mkdir(testDir, { recursive: true });
const baseConfig = await writeTestBaseConfig(testDir);

const pipe =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dwb-multi-test-${process.pid}-${Date.now()}`
    : resolve(testDir, 'broker.sock');

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
const testEnv = {
  ...inheritedEnv,
  DWB_BROKER_PIPE: pipe,
  DWB_WORKER_CAP: '3',
  DWB_DETACH_GRACE_MS: '60000',
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_BROKER_AUTOSTART: 'true',
  DWB_TELEMETRY_ENABLED: 'false',
  DWB_EVENT_LOG_PATH: resolve(testDir, 'events.jsonl'),
  DWB_RUNTIME_DIR: resolve(testDir, 'runtime'),
  DWB_BASE_DC_CONFIG: baseConfig,
  DWB_PAYLOAD_ARCHIVE_DIR: resolve(testDir, 'payloads'),
};

function contentText(result: any): string {
  return Array.isArray(result?.content)
    ? result.content
        .filter((x: any) => x?.type === 'text')
        .map((x: any) => String(x.text ?? ''))
        .join('\n')
    : '';
}

function structured<T = any>(result: any): T {
  return result.structuredContent as T;
}

type TestClient = { name: string; client: Client; transport: StdioClientTransport };

async function openClient(name: string): Promise<TestClient> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [adapterEntry],
    cwd: testDir,
    env: testEnv,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => process.stderr.write(`[${name}] ${String(chunk)}`));
  const client = new Client({ name: `dwb-multi-${name}`, version: '0.1.0' });
  await client.connect(transport);
  return { name, client, transport };
}

async function closeClient(c: TestClient): Promise<void> {
  await c.client.close().catch(() => {});
  await c.transport.close().catch(() => {});
}

async function call(c: TestClient, name: string, args: Record<string, unknown> = {}) {
  return c.client.callTool({ name, arguments: args });
}

const clients: TestClient[] = [];
let brokerPid: number | null = null;

try {
  const a = await openClient('A');
  clients.push(a);
  const [aTools, aConfig] = await Promise.all([
    a.client.listTools(undefined, { timeout: 20_000 }),
    call(a, 'get_config'),
  ]);
  assert.notEqual(aConfig.isError, true);
  const aStatus = structured<any>(await call(a, 'dwb_session_status'));
  const raceBroker = structured<any>(await call(a, 'dwb_broker_status'));
  assert.equal(
    raceBroker.activeWorkers,
    1,
    'Concurrent first requests must share one worker allocation',
  );

  const [b, c] = await Promise.all([openClient('B'), openClient('C')]);
  clients.push(b, c);
  const [bTools, cTools] = await Promise.all([
    b.client.listTools(undefined, { timeout: 20_000 }),
    c.client.listTools(undefined, { timeout: 20_000 }),
  ]);
  const toolLists = [aTools, bTools, cTools];
  for (const list of toolLists) {
    assert.ok(list.tools.some((tool) => tool.name === 'read_file'));
    assert.ok(list.tools.some((tool) => tool.name === 'dwb_broker_status'));
  }

  const statuses = [
    aStatus,
    structured<any>(await call(b, 'dwb_session_status')),
    structured<any>(await call(c, 'dwb_session_status')),
  ];
  const workers = new Set(statuses.map((s) => s.workerPid));
  const sessionIds = new Set(statuses.map((s) => s.sessionId));
  assert.equal(workers.size, 3, 'Each MCP session should have an isolated worker');
  assert.equal(sessionIds.size, 3, 'Each adapter should have a unique DWB session ID');
  assert.ok([...workers].every((pid) => typeof pid === 'number'));

  const brokerStatuses = await Promise.all(
    clients.map(async (x) => structured<any>(await call(x, 'dwb_broker_status'))),
  );
  const brokerPids = new Set(brokerStatuses.map((s) => s.brokerPid));
  assert.equal(brokerPids.size, 1, 'All adapters must share one singleton broker');
  brokerPid = brokerStatuses[0].brokerPid;
  assert.equal(brokerStatuses[0].activeWorkers, 3);
  assert.equal(brokerStatuses[0].workerCap, 3);

  const fixture = resolve(testDir, 'shared.txt');
  await writeFile(fixture, 'base\n', 'utf8');
  await Promise.all([
    call(a, 'read_file', { path: fixture }),
    call(b, 'read_file', { path: fixture }),
  ]);

  const aWrite = await call(a, 'write_file', {
    path: fixture,
    content: 'alpha\n',
    mode: 'rewrite',
  });
  assert.notEqual(aWrite.isError, true);
  const bStale = await call(b, 'write_file', {
    path: fixture,
    content: 'beta-stale\n',
    mode: 'rewrite',
  });
  assert.equal(bStale.isError, true);
  assert.match(contentText(bStale), /stale-write protection/i);
  assert.equal(await readFile(fixture, 'utf8'), 'alpha\n');

  await call(b, 'read_file', { path: fixture });
  const bFresh = await call(b, 'write_file', { path: fixture, content: 'beta\n', mode: 'rewrite' });
  assert.notEqual(bFresh.isError, true);
  assert.equal(await readFile(fixture, 'utf8'), 'beta\n');

  const aSessionId = statuses[0].sessionId as string;
  const aWorkerPid = statuses[0].workerPid as number;
  await closeClient(a);
  clients.splice(clients.indexOf(a), 1);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));

  const detached = structured<any>(await call(c, 'dwb_list_detached_sessions'));
  assert.ok(detached.sessions.some((s: any) => s.sessionId === aSessionId));

  const d = await openClient('D');
  clients.push(d);
  const resumed = structured<any>(await call(d, 'dwb_resume_session', { session_id: aSessionId }));
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.session.sessionId, aSessionId);
  assert.equal(
    resumed.session.workerPid,
    aWorkerPid,
    'Resume should preserve the detached worker when capacity allows',
  );

  const resumedStatus = structured<any>(await call(d, 'dwb_session_status'));
  assert.equal(resumedStatus.sessionId, aSessionId);
  assert.equal(resumedStatus.workerPid, aWorkerPid);

  const e = await openClient('E');
  clients.push(e);
  let eResolved = false;
  const eToolsPromise = e.client.listTools(undefined, { timeout: 20_000 }).then((value) => {
    eResolved = true;
    return value;
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
  assert.equal(eResolved, false, 'Fourth worker should wait while worker cap is full');

  await closeClient(c);
  clients.splice(clients.indexOf(c), 1);
  const eTools = await eToolsPromise;
  assert.ok(eTools.tools.some((tool) => tool.name === 'read_file'));
  const eStatus = structured<any>(await call(e, 'dwb_session_status'));
  assert.equal(typeof eStatus.workerPid, 'number');

  const finalBroker = structured<any>(await call(e, 'dwb_broker_status'));
  assert.equal(finalBroker.activeWorkers, 3);
  assert.equal(finalBroker.queueDepth, 0);
  assert.ok(finalBroker.locks.conflictsPrevented >= 1);

  console.log(
    'MULTI_SESSION_PASS',
    JSON.stringify({
      brokerPid,
      initialSessions: [...sessionIds],
      initialWorkerPids: [...workers],
      resumedSession: aSessionId,
      resumedWorkerPid: aWorkerPid,
      queuedWorkerPid: eStatus.workerPid,
      conflictsPrevented: finalBroker.locks.conflictsPrevented,
    }),
  );
} finally {
  for (const client of [...clients]) await closeClient(client).catch(() => {});
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
}
