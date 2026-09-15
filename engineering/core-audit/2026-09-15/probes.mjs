import { mkdir, mkdtemp, writeFile, realpath, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const reportRoot = resolve('logs/core-audit-2026-09-15');
await mkdir(reportRoot, { recursive: true });
const run = await mkdtemp(resolve(reportRoot, 'isolated-'));
process.env.DWB_DATA_DIR = resolve(run, 'data');
process.env.DWB_TELEMETRY_ENABLED = 'false';
process.env.DWB_BROKER_STATE_PATH = resolve(run, 'broker-state.json');
const load = (project, file) => import(pathToFileURL(resolve(project, 'src', file + '.ts')).href);
const results = {};
for (const [name, project] of [
  ['prototype', resolve('../dwb-desktop-bridge')],
  ['public', process.cwd()],
]) {
  const { canonicalPath, planTool } = await load(project, 'file-observer');
  const { LockManager } = await load(project, 'lock-manager');
  const { resolveLogicalRequestContext } = await load(project, 'request-context');
  const { WorkspaceStore, pathWithin } = await load(project, 'workspace-store');
  const Store =
    name === 'prototype'
      ? (await load(project, 'telemetry-store')).TelemetryStore
      : (await load(project, 'core-store')).CoreStore;
  const { brokerTools } = await load(project, 'broker-tools');
  const base = resolve(run, name);
  const alpha = resolve(base, 'alpha');
  const beta = resolve(base, 'beta');
  await mkdir(alpha, { recursive: true });
  await mkdir(beta, { recursive: true });
  const file = resolve(alpha, 'CaseFile.txt');
  await writeFile(file, 'fixture');
  const upper = file.toUpperCase();
  const lower = file.toLowerCase();
  assert.equal((await realpath(upper)).toLowerCase(), (await realpath(lower)).toLowerCase());
  const locks = new LockManager();
  const first = await locks.acquire(planTool('write_file', { path: upper }, alpha).locks, 'chat-a');
  let second = null;
  const wait = locks
    .acquire(planTool('write_file', { path: lower }, alpha).locks, 'chat-b')
    .then((lease) => (second = lease));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((done) => setImmediate(done));
  const concurrentCaseLocks = Boolean(second);
  first.release();
  await wait;
  second.release();
  const link = resolve(alpha, 'linked-out');
  await symlink(beta, link, 'junction');
  await writeFile(resolve(beta, 'fixture.txt'), 'fixture');
  const lexicalTarget = resolve(link, 'fixture.txt');
  const actual = await realpath(lexicalTarget);
  const db = new Store(resolve(base, 'fixture.db'));
  const store = new WorkspaceStore(db);
  await store.register({ path: alpha, name: 'Alpha', aliases: ['taken'] });
  let registrationError;
  try {
    await store.register({ path: beta, name: 'Beta', aliases: ['taken'] });
  } catch (error) {
    registrationError = error.message;
  }
  assert.ok(registrationError);
  const partialRegistration = store.list().some((workspace) => workspace.root === beta);
  db.close();
  const nested1 = resolveLogicalRequestContext({
    conversation: { request_id: 'request-000000001' },
  });
  const titleOnly = resolveLogicalRequestContext({ conversation: { title: 'same project title' } });
  const stable1 = resolveLogicalRequestContext({
    conversation: { id: 'conversation-111111', request_id: 'request-000000001' },
  });
  const stable2 = resolveLogicalRequestContext({
    conversation: { id: 'conversation-111111', request_id: 'request-000000002' },
  });
  results[name] = {
    controls: brokerTools.map((tool) => tool.name),
    caseVariantHasDifferentLockKey: canonicalPath(upper, alpha) !== canonicalPath(lower, alpha),
    concurrentCaseLocks,
    junctionLexicallyAllowed: pathWithin(alpha, lexicalTarget),
    junctionActuallyOutside: !pathWithin(alpha, actual),
    partialWorkspaceAfterRejectedAlias: partialRegistration,
    acceptsNestedRequestAsChat: Boolean(nested1),
    acceptsTitleAsChat: Boolean(titleOnly),
    stableConversationAcrossRequests: stable1?.key === stable2?.key,
  };
}
// Public registry injection permits a no-process reproduction of idle-request vs background-work restart.
const { SessionRegistry } = await load(process.cwd(), 'session-registry');
let restarts = 0;
const fake = {
  status: { workerPid: 123, ready: true },
  start: async () => {},
  stop: async () => {},
  listTools: async () => ({ tools: [] }),
  hasActiveWork: async () => true,
  restart: async () => {
    restarts++;
  },
};
const registry = new SessionRegistry({ write: async () => {} }, undefined, () => fake);
try {
  const id = await registry.attach(run, 0);
  await registry.listTools(id);
  await registry.restartWorker(id);
  results.public.manualRestartAllowsBackgroundWork = restarts === 1;
} finally {
  await registry.shutdown();
}
await writeFile(resolve(reportRoot, 'probe-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
