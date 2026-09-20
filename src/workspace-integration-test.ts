import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { samePath } from './platform.js';
import { writeTestBaseConfig } from './test-policy.js';

await mkdir(resolve('logs'), { recursive: true });
const root = await mkdtemp(resolve('logs', 'workspace-real-'));
const a = resolve(root, 'project-a');
const b = resolve(root, 'project-b');
await Promise.all([mkdir(a), mkdir(b)]);
process.env.DWB_DATA_DIR = resolve(root, 'data');
process.env.DWB_RUNTIME_DIR = resolve(root, 'runtime');
process.env.DWB_WORKSPACE_DB = resolve(root, 'workspaces.db');
process.env.DWB_BROKER_STATE_PATH = resolve(root, 'state.json');
process.env.DWB_EVENT_LOG_PATH = resolve(root, 'events.jsonl');
process.env.DWB_BASE_DC_CONFIG = await writeTestBaseConfig(root);
process.env.DWB_WORKER_CAP = '2';
process.env.DWB_BROKER_ALLOW_SHUTDOWN = 'true';
delete process.env.DWB_BROKER_PIPE;
const { BrokerClient } = await import('./broker-client.js');
const clients = await Promise.all([BrokerClient.connect(root), BrokerClient.connect(root)]);
let brokerPid: number | undefined;
try {
  const [first, second] = clients;
  brokerPid = (await first.ping()).broker.brokerPid;
  await Promise.all(clients.map((client) => client.listTools()));
  await first.callTool('workspace', { action: 'bind', path: a });
  await second.callTool('workspace', { action: 'bind', path: b });
  const cwdProbe = '.dwb-shell-cwd.txt';
  const shell =
    process.platform === 'win32'
      ? {
          command:
            "[IO.File]::WriteAllText((Join-Path (Get-Location).Path '" +
            cwdProbe +
            "'), (Get-Location).Path)",
          shell: 'powershell.exe',
        }
      : {
          command: 'pwd > ' + cwdProbe,
          shell: '/bin/zsh',
        };
  const result = await first.callTool('start_process', {
    ...shell,
    timeout_ms: 3000,
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  let observedCwd = '';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      observedCwd = (await readFile(resolve(a, cwdProbe), 'utf8')).trim();
      if (observedCwd) break;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(observedCwd, 'Shell CWD probe was not created');
  assert.equal(samePath(observedCwd, a), true, 'Shell must start in the bound workspace');
  await first.callTool('write_file', {
    path: resolve(a, 'a.txt'),
    content: 'first chat',
    mode: 'rewrite',
  });
  await second.callTool('write_file', {
    path: resolve(b, 'b.txt'),
    content: 'second chat',
    mode: 'rewrite',
  });
  assert.equal(await readFile(resolve(a, 'a.txt'), 'utf8'), 'first chat');
  assert.equal(await readFile(resolve(b, 'b.txt'), 'utf8'), 'second chat');
  const firstStatus = (await first.callTool('dwb_session_status', {})).structuredContent;
  const secondStatus = (await second.callTool('dwb_session_status', {})).structuredContent;
  assert.equal(firstStatus.workingDirectory, a);
  assert.equal(secondStatus.workingDirectory, b);
  assert.notEqual(firstStatus.workerPid, secondStatus.workerPid);
  assert.equal(
    (
      await first.callTool('write_file', {
        path: resolve(b, 'blocked.txt'),
        content: 'wrong workspace',
      })
    ).isError,
    true,
  );
  console.log(
    'WORKSPACE_INTEGRATION_PASS: two chats, exact bindings, separate workers, real shell CWD, file routing and boundary',
  );
} finally {
  await clients[0].shutdownForTests().catch(() => {});
  await Promise.allSettled(clients.map((client) => client.close()));
  // Fallback for a failed test before graceful shutdown is available.
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
}
