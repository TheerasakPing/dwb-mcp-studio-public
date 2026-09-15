import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { canonicalPath, planTool } from './file-observer.js';
import { LockManager } from './lock-manager.js';
import { CoreStore } from './core-store.js';
import { WorkspaceStore, pathWithin } from './workspace-store.js';
import { RequestLifetime } from './request-lifetime.js';
import { EventLog } from './event-log.js';
import type { WorkerSupervisor } from './worker-supervisor.js';

const root = await mkdtemp(join(tmpdir(), 'dwb-hardening-'));
process.env.DWB_BROKER_STATE_PATH = join(root, 'state.json');
process.env.DWB_WORKER_CAP = '1';
const { SessionRegistry } = await import('./session-registry.js');
const { loadBrokerState } = await import('./broker-state.js');
const a = join(root, 'alpha');
const b = join(root, 'beta');
await Promise.all([mkdir(a), mkdir(b)]);

function fixture() {
  const workers: any[] = [];
  const log = new EventLog();
  log.write = async () => {};
  const registry = new SessionRegistry(log, undefined, () => {
    const worker = {
      status: { workerPid: workers.length + 1 },
      active: false,
      calls: 0,
      restarts: 0,
      async start() {},
      async stop() {},
      async listTools() {
        return { tools: [] };
      },
      async hasActiveWork() {
        return this.active;
      },
      async restart() {
        this.restarts++;
      },
      async callTool() {
        this.calls++;
        return { content: [] };
      },
    };
    workers.push(worker);
    return worker as unknown as WorkerSupervisor;
  });
  return { registry, workers };
}

test('Windows case variants and junction aliases share file identity and locks', async () => {
  const path = join(a, 'CaseFile.txt');
  await writeFile(path, 'one');
  await symlink(a, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const first = canonicalPath(path, root)!;
  assert.equal(first, canonicalPath(join(root, 'alias', 'CaseFile.txt'), root));
  if (process.platform === 'win32') assert.equal(first, canonicalPath(path.toUpperCase(), root));
  const locks = new LockManager();
  const lease = await locks.acquire([`file:${first}`], 'one');
  const lifetime = new RequestLifetime();
  const waiting = assert.rejects(
    locks.acquire([`file:${first}`], 'two', 'write', lifetime.signal),
    /CANCELLED/,
  );
  assert.equal(locks.status.waiting, 1);
  lifetime.cancel();
  await waiting;
  lease.release();
  assert.equal(locks.status.activeKeys, 0);
});

test('workspace boundary follows junctions and allows ordinary dot-prefixed children', async () => {
  await symlink(b, join(a, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(pathWithin(a, join(a, 'outside', 'new', 'file.txt')), false);
  assert.equal(pathWithin(a, join(a, '..notes', 'new.txt')), true);
  const db = new CoreStore(join(root, 'workspaces.db'));
  try {
    const store = new WorkspaceStore(db);
    await store.bind({ path: a }, 'session');
    const plan = planTool('create_directory', { path: join(a, 'outside', 'new') }, a);
    assert.equal(
      store.mutationGate({
        sessionId: 'session',
        kind: plan.kind,
        paths: plan.locks.map((x) => x.slice(5)),
      }).allowed,
      false,
    );
  } finally {
    db.close();
  }
});

test('alias collision rolls back new workspace, rename, aliases and events', async () => {
  const db = new CoreStore(join(root, 'atomic.db'));
  try {
    const store = new WorkspaceStore(db);
    await store.register({ path: a, name: 'Alpha', aliases: ['reserved'] });
    await assert.rejects(
      store.register({ path: b, name: 'Beta', aliases: ['new-alias', 'reserved'] }),
      /alias already/,
    );
    assert.equal(store.list().length, 1);
    const before = JSON.stringify(db.query('SELECT * FROM workspace_events'));
    const beta = await store.register({ path: b, name: 'Beta' });
    const events = JSON.stringify(db.query('SELECT * FROM workspace_events'));
    await assert.rejects(
      store.register({ path: b, name: 'Renamed', aliases: ['partial', 'reserved'] }),
      /alias already/,
    );
    assert.deepEqual(store.resolveRef(beta.id), beta);
    assert.equal(JSON.stringify(db.query('SELECT * FROM workspace_events')), events);
    assert.notEqual(events, before);
  } finally {
    db.close();
  }
});

test('manual restart and upgrade retain background work', async () => {
  const f = fixture();
  try {
    const id = await f.registry.attach(a, 1);
    await f.registry.listTools(id);
    f.workers[0].active = true;
    await assert.rejects(f.registry.restartWorker(id), /active processes/);
    await assert.rejects(f.registry.prepareUpgrade(), /background/);
    assert.equal(f.workers[0].restarts, 0);
    f.workers[0].active = false;
    await f.registry.restartWorker(id);
    assert.equal(f.workers[0].restarts, 1);
    await f.registry.prepareUpgrade();
    await assert.rejects(f.registry.callTool(id, 'late', { name: 'write_file' }), /upgrade/);
  } finally {
    await f.registry.shutdown();
  }
});

test('cancelled worker queue is removed and never executes later', async () => {
  const f = fixture();
  try {
    const first = await f.registry.attach(a, 1);
    await f.registry.listTools(first);
    f.workers[0].active = true;
    const second = await f.registry.attach(b, 2);
    const lifetime = new RequestLifetime();
    const request = assert.rejects(
      f.registry.callTool(
        second,
        'cancel',
        { name: 'write_file', arguments: { path: join(b, 'never.txt') } },
        lifetime,
      ),
      /CANCELLED/,
    );
    await delay(10);
    assert.equal(f.registry.status.queueDepth, 1);
    lifetime.cancel();
    await request;
    assert.equal(f.registry.status.queueDepth, 0);
    assert.equal(f.registry.status.inFlightCalls, 0);
    await f.registry.detach(first);
    f.workers[0].active = false;
    await f.registry.reclaimIdleWorkers();
    await delay(10);
    assert.equal(f.workers.length, 1);
    assert.equal(f.workers[0].calls, 0);
  } finally {
    await f.registry.shutdown();
  }
});

test('dispatched work retains lock until completion after caller cancellation', async () => {
  const f = fixture();
  try {
    const id = await f.registry.attach(a, 1);
    await f.registry.listTools(id);
    let finish!: (value: any) => void;
    f.workers[0].callTool = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const lifetime = new RequestLifetime();
    const request = f.registry.callTool(
      id,
      'active',
      { name: 'write_file', arguments: { path: join(a, 'live.txt') } },
      lifetime,
    );
    while (!finish) await delay(1);
    lifetime.cancel();
    assert.match(lifetime.error().message, /OUTCOME_PENDING/);
    assert.equal(f.registry.locks.status.writers, 1);
    assert.equal(f.registry.status.inFlightCalls, 1);
    finish({ content: [] });
    await request;
    assert.equal(f.registry.locks.status.activeKeys, 0);
  } finally {
    await f.registry.shutdown();
  }
});

test('upstream keeps long-running results and refuses recovery restart during a call', async () => {
  const { WorkerSupervisor } = await import('./worker-supervisor.js');
  const log = new EventLog();
  log.write = async () => {
    throw new Error('fixture log disk full');
  };
  const worker = new WorkerSupervisor(log);
  let finish!: (result: any) => void;
  let timeout = 0;
  (worker as any).client = {
    callTool: (_params: unknown, _schema: unknown, options: any) => {
      timeout = options.timeout;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    close: async () => {},
  };
  const request = worker.callTool({ name: 'write_file', arguments: {} });
  while (!finish) await delay(1);
  assert.ok(timeout > 120_000, 'SDK timeout must not discard a result before the broker deadline');
  assert.equal(await worker.hasActiveWork(), true);
  await assert.rejects(worker.restart('heartbeat_failed'), /dispatched tool/);
  finish({ content: [{ type: 'text', text: 'completed' }] });
  assert.equal(
    ((await request) as any).content[0].type,
    'text',
    'logging failure must not turn success into a retry',
  );
  log.write = async () => {};
  await worker.stop();
});

test('persistence failures are visible, recover, and corrupt saved state is preserved', async () => {
  const path = process.env.DWB_BROKER_STATE_PATH!;
  await rm(path, { force: true });
  await mkdir(path);
  const f = fixture();
  try {
    await f.registry.attach(a, 1);
    assert.equal(f.registry.status.persistence.healthy, false);
    await rm(path, { recursive: true });
    await f.registry.attach(b, 2);
    assert.equal(f.registry.status.persistence.healthy, true);
    await writeFile(path, '{broken');
    await assert.rejects(loadBrokerState(), /STATE_LOAD_FAILED/);
    assert.equal(await readFile(path, 'utf8'), '{broken');
  } finally {
    await f.registry.shutdown();
  }
});
