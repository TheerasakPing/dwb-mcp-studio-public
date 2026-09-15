import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { WorkerContext, WorkerSupervisor } from './worker-supervisor.js';

const testRoot = resolve('logs', `workspace-binding-${randomUUID()}`);
process.env.DWB_BROKER_STATE_PATH = resolve(testRoot, 'broker-state.json');
process.env.DWB_WORKER_CAP = '4';
const { CoreStore } = await import('./core-store.js');
const { WorkspaceStore } = await import('./workspace-store.js');
const { SessionRegistry } = await import('./session-registry.js');
const { EventLog } = await import('./event-log.js');

async function fixture() {
  const root = resolve(testRoot, randomUUID());
  const a = resolve(root, 'one', 'project');
  const b = resolve(root, 'two', 'project');
  await Promise.all([mkdir(a, { recursive: true }), mkdir(b, { recursive: true })]);
  const db = new CoreStore(resolve(root, 'workspaces.db'));
  const store = new WorkspaceStore(db);
  const workers: FakeWorker[] = [];
  class FakeWorker {
    active = false;
    probeGate: Promise<void> = Promise.resolve();
    stopped = false;
    status = { workerPid: workers.length + 1 };
    constructor(readonly context: WorkerContext) {}
    async start() {}
    async stop() {
      this.stopped = true;
    }
    async hasActiveWork() {
      await this.probeGate;
      return this.active;
    }
    async listTools() {
      return { tools: [] };
    }
  }
  const log = new EventLog();
  log.write = async () => {};
  const factory = (_: InstanceType<typeof EventLog>, context: WorkerContext) => {
    const worker = new FakeWorker(context);
    workers.push(worker);
    return worker as unknown as WorkerSupervisor;
  };
  const registry = new SessionRegistry(log, store, factory);
  return { root, a, b, db, store, workers, registry, log, factory };
}

test('explicit directory registers and binds the exact child, leaving unspecified chats unbound', async () => {
  const f = await fixture();
  try {
    const id = await f.registry.attach(f.root, 1);
    assert.equal(f.store.current(id), null);
    await f.store.register({ path: f.root });
    await f.registry.workspace(id, { action: 'bind', path: f.a });
    assert.equal(f.store.current(id)?.root, f.a);
    assert.equal(f.registry.sessionStatus(id).workingDirectory, f.a);
    assert.equal(
      f.registry.sessionStatus(id).workspaceKey,
      f.root,
      'Keep transport identity separate',
    );
    await f.registry.listTools(id);
    assert.equal(f.workers[0].context.workspaceKey, f.a);
    const workspaceId = f.store.current(id)?.id;
    await f.registry.workspace(id, { action: 'bind', path: f.a });
    assert.equal(f.store.current(id)?.id, workspaceId);
    assert.equal(f.workers[0].stopped, false, 'Same directory must not replace a warm worker');
    await assert.rejects(
      f.registry.workspace(id, { action: 'bind', path: resolve(f.root, 'missing') }),
      /existing directory/,
    );
    await assert.rejects(
      f.registry.workspace(id, { action: 'bind', path: 'relative' }),
      /absolute/,
    );
    assert.equal(f.store.current(id)?.root, f.a);
  } finally {
    await f.registry.shutdown();
    f.db.close();
  }
});

test('directory changes replace only the current idle worker; busy work is preserved', async () => {
  const f = await fixture();
  try {
    const a = await f.registry.attach(f.root, 1);
    const b = await f.registry.attach(f.root, 2);
    // Both projects have the same basename: paths must still bind without alias collisions.
    await f.registry.workspace(a, { action: 'bind', path: f.a });
    await f.registry.workspace(b, { action: 'bind', path: f.b });
    await f.registry.listTools(a);
    await f.registry.listTools(b);
    f.workers[0].active = true;
    await assert.rejects(
      f.registry.workspace(a, { action: 'bind', path: f.b }),
      /active processes/,
    );
    assert.equal(f.store.current(a)?.root, f.a);
    assert.equal(f.workers[0].stopped, false);
    f.workers[0].active = false;
    let release!: () => void;
    f.workers[0].probeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const changing = f.registry.workspace(a, { action: 'bind', path: f.b });
    try {
      await assert.rejects(f.registry.listTools(a), /Workspace is changing/);
      await assert.rejects(f.registry.restartWorker(a), /busy/);
    } finally {
      release();
    }
    await changing;
    await f.registry.listTools(a);
    assert.equal(f.workers[0].stopped, true);
    assert.equal(f.workers[1].stopped, false);
    assert.equal(f.workers[2].context.workspaceKey, f.b);
    await f.registry.workspace(a, { action: 'unbind' });
    await f.registry.listTools(a);
    assert.equal(f.workers[3].context.workspaceKey, f.root);
    assert.equal(f.store.current(b)?.root, f.b);
  } finally {
    await f.registry.shutdown();
    f.db.close();
  }
});

test('workspace binding survives broker recovery and launches the next worker in the bound directory', async () => {
  const f = await fixture();
  let restored: InstanceType<typeof SessionRegistry> | undefined;
  try {
    const id = await f.registry.attach(f.root, 1);
    await f.registry.workspace(id, { action: 'bind', path: f.a });
    await f.registry.shutdown();
    restored = new SessionRegistry(f.log, f.store, f.factory);
    await restored.restore();
    assert.equal(await restored.attach(f.root, 2, id), id);
    await restored.listTools(id);
    assert.equal(f.workers[0].context.workspaceKey, f.a);
  } finally {
    await restored?.shutdown();
    await f.registry.shutdown();
    f.db.close();
  }
});
