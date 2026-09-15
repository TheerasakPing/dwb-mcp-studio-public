import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeTestBaseConfig } from './test-policy.js';

const root = resolve(import.meta.dirname, '..');
const testDir = resolve(root, 'logs', 'logical-context');
await rm(testDir, { recursive: true, force: true });
await mkdir(testDir, { recursive: true });
const baseConfig = await writeTestBaseConfig(testDir);
const pipe =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dwb-context-test-${process.pid}-${Date.now()}`
    : resolve(testDir, 'broker.sock');

process.env.DWB_BROKER_PIPE = pipe;
process.env.DWB_WORKER_CAP = '2';
process.env.DWB_IDLE_WORKER_MS = '300';
process.env.DWB_BROKER_AUTOSTART = 'true';
process.env.DWB_BROKER_ALLOW_SHUTDOWN = 'true';
process.env.DWB_EVENT_LOG_PATH = resolve(testDir, 'events.jsonl');
process.env.DWB_WORKSPACE_DB = resolve(testDir, 'telemetry.db');
process.env.DWB_RUNTIME_DIR = resolve(testDir, 'runtime');
process.env.DWB_BASE_DC_CONFIG = baseConfig;
const { BrokerClient } = await import('./broker-client.js');
let client = await BrokerClient.connect(testDir);
let brokerPid: number | null = null;
try {
  const a = {
    key: 'meta.conversation_id:chat-z3',
    source: 'meta.conversation_id',
    preview: 'chat-z3#aaa',
  };
  const b = {
    key: 'meta.conversation_id:chat-z6',
    source: 'meta.conversation_id',
    preview: 'chat-z6#bbb',
  };
  await client.listTools(a);
  const statusA: any = await client.callTool('dwb_session_status', {}, a);
  await client.listTools(b);
  const statusB: any = await client.callTool('dwb_session_status', {}, b);
  const broker: any = await client.callTool('dwb_broker_status', {}, a);
  brokerPid = broker.structuredContent.brokerPid;
  assert.notEqual(statusA.structuredContent.sessionId, statusB.structuredContent.sessionId);
  assert.notEqual(statusA.structuredContent.workerPid, statusB.structuredContent.workerPid);
  assert.equal(broker.structuredContent.activeWorkers, 2);
  const listed: any = await client.callTool('dwb_list_sessions', {}, a);
  const live = listed.structuredContent.sessions.filter((s: any) => s.state === 'attached');
  assert.equal(live.length, 2);
  assert.deepEqual(
    new Set(live.map((s: any) => s.contextPreview)),
    new Set([a.preview, b.preview]),
  );

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  const c = {
    key: 'meta.conversation_id:chat-new',
    source: 'meta.conversation_id',
    preview: 'chat-new#ccc',
  };
  await client.listTools(c);
  const statusC: any = await client.callTool('dwb_session_status', {}, c);
  const afterIdleReclaim: any = await client.callTool('dwb_broker_status', {}, c);
  assert.ok(statusC.structuredContent.workerPid, 'new active context should receive a worker');
  assert.equal(
    afterIdleReclaim.structuredContent.activeWorkers,
    2,
    'idle context worker should be reclaimed at capacity',
  );
  const afterList: any = await client.callTool('dwb_list_sessions', {}, c);
  const attached = afterList.structuredContent.sessions.filter((s: any) => s.state === 'attached');
  assert.equal(attached.length, 3, 'idle logical context should remain resumable');
  assert.equal(
    attached.filter((s: any) => s.workerPid).length,
    2,
    'only two workers should remain allocated',
  );

  const aSessionId = statusA.structuredContent.sessionId;
  await client.close();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  client = await BrokerClient.connect(testDir);
  await client.listTools(a);
  const recovered: any = await client.callTool('dwb_session_status', {}, a);
  assert.equal(
    recovered.structuredContent.sessionId,
    aSessionId,
    'logical conversation should survive transport replacement',
  );
  console.log(
    'LOGICAL_CONTEXT_PASS',
    JSON.stringify({ workers: broker.structuredContent.activeWorkers, recovered: true }),
  );
} finally {
  await client.close().catch(() => {});
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
}
