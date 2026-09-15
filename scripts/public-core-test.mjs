import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'logs'), { recursive: true });
const testDir = await mkdtemp(resolve(root, 'logs', 'public-core-'));
const relocated = resolve(testDir, 'relocated core with spaces');
for (const name of ['dist', 'scripts'])
  await cp(resolve(root, name), resolve(relocated, name), { recursive: true });
await cp(resolve(root, 'package.json'), resolve(relocated, 'package.json'));
const fixture = resolve(testDir, 'user installed worker', 'dist');
await mkdir(fixture, { recursive: true });
// This fixture is our own test double, not Desktop Commander source.
await writeFile(
  resolve(fixture, '..', 'package.json'),
  JSON.stringify({ name: '@wonderwhy-er/desktop-commander', version: '0.2.50', type: 'module' }),
);
const original = "import os from 'node:os';\nexport const USER_HOME = os.homedir();\n";
await writeFile(resolve(fixture, 'config.js'), original);
await writeFile(
  resolve(fixture, 'index.js'),
  `
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { USER_HOME } from './config.js';
const server = new Server({name:'dwb-test-double', version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:['get_config','read_file','write_file'].map(name=>({name,inputSchema:{type:'object',additionalProperties:true}}))}));
server.setRequestHandler(CallToolRequestSchema, async request => {
 const args=request.params.arguments || {};
 let value;
 if(request.params.name === 'get_config') value={configHome:USER_HOME,osHome:os.homedir(),pid:process.pid,cwd:process.cwd()};
 else if(request.params.name === 'list_sessions') value='No active sessions';
 else if(request.params.name === 'list_searches') value='No active searches';
 else if(request.params.name === 'read_file') value=await readFile(args.path,'utf8');
 else if(request.params.name === 'write_file') { await writeFile(args.path,args.content); value='written'; }
 else value=[];
 return {content:[{type:'text',text:JSON.stringify(value)}]};
});
await server.connect(new StdioServerTransport());
`,
);
const env = {
  ...process.env,
  DWB_DATA_DIR: resolve(testDir, 'user data'),
  DWB_CONFIG_FILE: resolve(testDir, 'user data', 'config.json'),
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_RUNTIME_DIR: resolve(testDir, 'runtime'),
  DWB_BROKER_STATE_PATH: resolve(testDir, 'runtime', 'broker-state.json'),
  DWB_WORKSPACE_DB: resolve(testDir, 'runtime', 'workspaces.db'),
  DWB_EVENT_LOG_PATH: resolve(testDir, 'events.jsonl'),
};
for (const key of [
  'DWB_WORKER_ENTRY',
  'DWB_WORKER_CAP',
  'DWB_WORKSPACE',
  'DWB_BASE_DC_CONFIG',
  'DWB_BROKER_PIPE',
])
  delete env[key];
function run(script, args = [], expected = 0) {
  const result = spawnSync(process.execPath, [resolve(relocated, 'scripts', script), ...args], {
    env,
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  return result;
}
assert.match(run('doctor.mjs', [], 1).stderr, /DWB_WORKER_ENTRY/);
run('configure.mjs', [
  '--worker-entry',
  resolve(fixture, 'index.js'),
  '--workspace',
  testDir,
  '--worker-cap',
  '2',
]);
const report = JSON.parse(run('doctor.mjs').stdout);
assert.equal(report.ok, true);
assert.equal(report.workerCap, 2);
assert.equal(report.runtime.state, 'stopped');
assert.equal(JSON.parse(run('dashboard-probe.mjs').stdout).state, 'stopped');
assert.ok(report.brokerEndpoint.includes('dwb-mcp-studio-core'));
const policyPath = resolve(testDir, 'user data', 'base-policy.json');
const customPolicy = { allowedDirectories: [testDir], fileReadLineLimit: 123 };
await writeFile(policyPath, JSON.stringify(customPolicy));
run('configure.mjs', ['--worker-entry', resolve(fixture, 'index.js'), '--workspace', testDir]);
assert.deepEqual(
  JSON.parse(await readFile(policyPath)),
  customPolicy,
  'Configure must preserve a user-edited policy.',
);
const clientConfig = JSON.parse(await readFile(resolve(testDir, 'user data', 'mcp-client.json')))
  .mcpServers['dwb-core'];
assert.equal(clientConfig.args[0], resolve(relocated, 'scripts', 'start.mjs'));

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
const clients = [];
let brokerPid;
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
try {
  for (let n = 0; n < 2; n++) {
    const transport = new StdioClientTransport({
      command: clientConfig.command,
      args: clientConfig.args,
      env,
      stderr: 'pipe',
    });
    const client = new Client({ name: `public-core-${n}`, version: '1' });
    clients.push({ client, transport });
    await client.connect(transport);
  }
  const [a, b] = clients.map((c) => c.client);
  brokerPid = (await call(a, 'dwb_broker_status')).structuredContent.brokerPid;
  const beforeDoctor = (await call(a, 'dwb_broker_status')).structuredContent;
  const liveReport = JSON.parse(run('doctor.mjs').stdout);
  assert.equal(liveReport.runtime.state, 'running');
  assert.equal(liveReport.runtime.brokerPid, brokerPid);
  assert.equal(
    liveReport.runtime.sessions,
    beforeDoctor.sessions,
    'Doctor must not attach a session',
  );
  assert.equal(
    liveReport.runtime.activeWorkers,
    beforeDoctor.activeWorkers,
    'Doctor must not spawn a worker',
  );
  const dashboard = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.equal(dashboard.state, 'running');
  assert.equal(dashboard.broker.sessions, beforeDoctor.sessions, 'Dashboard must not attach');
  assert.equal(
    dashboard.broker.activeWorkers,
    beforeDoctor.activeWorkers,
    'Dashboard must not allocate',
  );
  assert.equal(dashboard.sessions.length, beforeDoctor.sessions);
  assert.equal(dashboard.sessions[0].workingDirectory, testDir);
  const secondSnapshot = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.deepEqual(
    secondSnapshot.sessions.map((s) => s.lastActivityAt),
    dashboard.sessions.map((s) => s.lastActivityAt),
    'Dashboard polling must not keep idle workers alive',
  );
  const surface = (await a.listTools()).tools.map((t) => t.name);
  assert.deepEqual(
    surface.filter((n) => !['get_config', 'read_file', 'write_file'].includes(n)).sort(),
    [
      'dwb_bridge_status',
      'dwb_broker_status',
      'dwb_session_status',
      'dwb_restart_worker',
      'dwb_list_sessions',
      'dwb_list_detached_sessions',
      'dwb_resume_session',
      'workspace',
    ].sort(),
  );
  const configA = JSON.parse((await call(a, 'get_config')).content[0].text);
  const configB = JSON.parse((await call(b, 'get_config')).content[0].text);
  assert.notEqual(configA.pid, configB.pid);
  const activeDashboard = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.equal(activeDashboard.broker.activeWorkers, 2);
  assert.deepEqual(
    activeDashboard.sessions.map((s) => s.workerPid).sort(),
    [configA.pid, configB.pid].sort(),
  );
  await writeFile(resolve(testDir, 'dashboard-snapshot.json'), JSON.stringify(activeDashboard));
  assert.notEqual(configA.configHome, configB.configHome);
  assert.equal(configA.osHome, homedir());
  assert.equal(configB.osHome, homedir());
  assert.equal(await readFile(resolve(fixture, 'config.js'), 'utf8'), original);
  const bound = resolve(testDir, 'workspace');
  await mkdir(bound);
  await call(a, 'workspace', { action: 'bind', workspace: bound });
  const reboundConfig = JSON.parse((await call(a, 'get_config')).content[0].text);
  assert.equal(reboundConfig.cwd, bound);
  assert.notEqual(reboundConfig.pid, configA.pid);
  assert.equal(JSON.parse((await call(b, 'get_config')).content[0].text).pid, configB.pid);
  await call(a, 'write_file', { path: 'relative.txt', content: 'in the bound workspace' });
  assert.equal(await readFile(resolve(bound, 'relative.txt'), 'utf8'), 'in the bound workspace');
  const outside = await call(a, 'write_file', {
    path: resolve(testDir, 'outside.txt'),
    content: 'must not write',
  });
  assert.equal(outside.isError, true);
  assert.match(outside.content[0].text, /DWB_WORKSPACE_BOUNDARY/);
  const file = resolve(bound, 'shared.txt');
  await writeFile(file, 'one');
  await call(a, 'read_file', { path: file });
  await call(b, 'write_file', { path: file, content: 'two' });
  assert.equal((await call(a, 'write_file', { path: file, content: 'stale' })).isError, true);
  assert.equal(await readFile(file, 'utf8'), 'two');
  await call(a, 'read_file', { path: file });
  assert.notEqual(
    (await call(a, 'write_file', { path: file, content: 'reconciled' })).isError,
    true,
  );
  assert.equal(await readFile(file, 'utf8'), 'reconciled');
  const stateBefore = await readFile(env.DWB_BROKER_STATE_PATH, 'utf8');
  const duplicate = spawnSync(process.execPath, [resolve(relocated, 'dist', 'broker-server.js')], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(duplicate.status, 0, duplicate.stderr);
  assert.equal(
    await readFile(env.DWB_BROKER_STATE_PATH, 'utf8'),
    stateBefore,
    'A losing broker startup must not rewrite the live broker state',
  );
  const replies = await new Promise((resolveReplies, reject) => {
    const socket = createConnection(report.brokerEndpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Duplicate hello timed out'));
    }, 5000);
    let buffer = '';
    const messages = [];
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(
        [1, 2]
          .map((id) =>
            JSON.stringify({
              id: String(id),
              method: 'hello',
              params: { cwd: testDir },
            }),
          )
          .join('\n') + '\n',
      ),
    );
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        messages.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
      if (messages.length === 2) {
        clearTimeout(timer);
        socket.destroy();
        resolveReplies(messages);
      }
    });
  });
  assert.equal(
    replies.filter((message) => message.ok).length,
    1,
    'One connection can attach only once',
  );
  console.log(
    'PUBLIC_CORE_PASS: relocated launcher, generated config, missing dependency, read-only Doctor, core-only tools, 2 isolated workers, real OS home, unchanged external files, workspace boundary, stale-write protection, broker singleton, duplicate hello',
  );
} finally {
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
  for (const { client, transport } of clients) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
