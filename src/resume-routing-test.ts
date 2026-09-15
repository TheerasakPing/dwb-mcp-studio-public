import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeTestBaseConfig } from './test-policy.js';

await mkdir(resolve('logs'), { recursive: true });
const root = await mkdtemp(resolve('logs', 'resume-routing-'));
const otherCwd = resolve(root, 'new-adapter');
const workspace = resolve(root, 'project-a');
await Promise.all([mkdir(otherCwd), mkdir(workspace)]);
Object.assign(process.env, {
  DWB_DATA_DIR: resolve(root, 'data'),
  DWB_RUNTIME_DIR: resolve(root, 'runtime'),
  DWB_WORKSPACE_DB: resolve(root, 'workspaces.db'),
  DWB_BROKER_STATE_PATH: resolve(root, 'state.json'),
  DWB_EVENT_LOG_PATH: resolve(root, 'events.jsonl'),
  DWB_BASE_DC_CONFIG: await writeTestBaseConfig(root),
  DWB_WORKER_CAP: '4',
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
});
delete process.env.DWB_BROKER_PIPE;
const { BrokerClient } = await import('./broker-client.js');
const old = await BrokerClient.connect(root);
const next = await BrokerClient.connect(otherCwd);
const sibling = { key: 'sibling-chat-123', source: 'test' };
const oldContext = { key: 'old-chat-123', source: 'test' };
const newContext = { key: 'new-chat-123', source: 'test' };
const status = async (
  client: Awaited<ReturnType<typeof BrokerClient.connect>>,
  context: typeof oldContext,
) => (await client.callTool('dwb_session_status', {}, context)).structuredContent;
async function detached(id: string) {
  for (let i = 0; i < 100; i++) {
    const list = (await next.callTool('dwb_list_detached_sessions', {})).structuredContent.sessions;
    if (list.some((s: any) => s.sessionId === id)) return;
    await delay(20);
  }
  throw new Error('Session did not detach');
}
let brokerPid: number | undefined;
try {
  brokerPid = (await next.ping()).broker.brokerPid;
  await old.callTool('workspace', { action: 'bind', path: workspace }, oldContext);
  await old.listTools(oldContext);
  const before = await status(old, oldContext);
  await old.close();
  await detached(before.sessionId);
  await next.callTool('dwb_session_status', {}, newContext);
  await next.callTool('dwb_resume_session', { session_id: before.sessionId }, newContext);
  assert.equal(next.sessionId, before.sessionId, 'Client must remember the resumed transport root');
  const resumed = await status(next, newContext);
  assert.equal(resumed.sessionId, before.sessionId);
  assert.equal(resumed.workerPid, before.workerPid);
  assert.equal(resumed.workingDirectory, workspace);
  assert.equal(resumed.transportWorkspaceKey, otherCwd);
  const file = resolve(workspace, 'shared.txt');
  await writeFile(file, 'before');
  await next.callTool('read_file', { path: file }, newContext);
  await next.shutdownForTests();
  await delay(150);
  // Concurrent reconnect requests must all wait for the same hello handshake.
  const [tools, recovered] = await Promise.all([
    next.listTools(newContext),
    status(next, newContext),
  ]);
  brokerPid = (await next.ping()).broker.brokerPid;
  assert.ok(tools.tools.length);
  assert.equal(recovered.sessionId, before.sessionId);
  assert.equal(recovered.workingDirectory, workspace);
  await writeFile(file, 'changed externally');
  assert.equal(
    (await next.callTool('write_file', { path: file, content: 'stale' }, newContext)).isError,
    true,
  );

  // Resume a logical child while keeping the root/sibling identity intact.
  const source = await BrokerClient.connect(root);
  let sourceId: string;
  try {
    sourceId = (await status(source, oldContext)).sessionId;
  } finally {
    await source.close();
  }
  await detached(sourceId!);
  const childId = (await status(next, sibling)).sessionId;
  const rootId = next.sessionId;
  await next.callTool('dwb_resume_session', { session_id: sourceId! }, sibling);
  assert.notEqual(childId, sourceId!);
  assert.equal(next.sessionId, rootId, 'Logical resume must not replace the transport root');
  assert.equal((await status(next, sibling)).sessionId, sourceId!);
  assert.equal((await status(next, newContext)).sessionId, before.sessionId);
  console.log(
    'RESUME_ROUTING_PASS: new chat, root token, sibling routing, different adapter CWD, concurrent reconnect, workspace and stale-write state',
  );
} finally {
  await next.shutdownForTests().catch(() => {});
  await Promise.allSettled([old.close(), next.close()]);
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
}
