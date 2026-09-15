type Mode = 'read' | 'write';
type Waiter = { resolve: () => void; owner: string; mode: Mode; queuedAt: number };

type LockState = {
  writer: string | null;
  writeDepth: number;
  readers: Map<string, number>;
  queue: Waiter[];
};

export type LockLease = {
  keys: string[];
  mode: Mode;
  waitMs: number;
  release: () => void;
};

export class LockManager {
  private readonly locks = new Map<string, LockState>();
  private conflictsPrevented = 0;

  get status() {
    let waiting = 0;
    let readers = 0;
    let writers = 0;
    for (const state of this.locks.values()) {
      waiting += state.queue.length;
      readers += state.readers.size;
      if (state.writer) writers += 1;
    }
    return {
      activeKeys: this.locks.size,
      readers,
      writers,
      waiting,
      conflictsPrevented: this.conflictsPrevented,
    };
  }

  markConflict(): void {
    this.conflictsPrevented += 1;
  }

  private state(key: string): LockState {
    let state = this.locks.get(key);
    if (!state) {
      state = { writer: null, writeDepth: 0, readers: new Map(), queue: [] };
      this.locks.set(key, state);
    }
    return state;
  }

  private canRead(state: LockState, owner: string): boolean {
    if (state.writer === owner) return true;
    if (state.writer) return false;
    if ((state.readers.get(owner) ?? 0) > 0) return true;
    return state.queue.length === 0;
  }

  private canWrite(state: LockState, owner: string): boolean {
    if (state.writer === owner) return true;
    return state.writer === null && state.readers.size === 0;
  }

  private grant(state: LockState, owner: string, mode: Mode): void {
    if (mode === 'write') {
      if (state.writer === owner) state.writeDepth += 1;
      else {
        state.writer = owner;
        state.writeDepth = 1;
      }
      return;
    }
    state.readers.set(owner, (state.readers.get(owner) ?? 0) + 1);
  }

  private async acquireOne(key: string, owner: string, mode: Mode): Promise<number> {
    const state = this.state(key);
    const canAcquire = mode === 'read' ? this.canRead(state, owner) : this.canWrite(state, owner);
    if (canAcquire) {
      this.grant(state, owner, mode);
      return 0;
    }
    const queuedAt = performance.now();
    await new Promise<void>((resolve) => state.queue.push({ resolve, owner, mode, queuedAt }));
    return Math.round(performance.now() - queuedAt);
  }

  private processQueue(key: string, state: LockState): void {
    if (state.writer || state.readers.size > 0 || state.queue.length === 0) return;
    const first = state.queue.shift()!;
    this.grant(state, first.owner, first.mode);
    first.resolve();
    if (first.mode === 'write') return;
    while (state.queue[0]?.mode === 'read' && !state.writer) {
      const next = state.queue.shift()!;
      this.grant(state, next.owner, 'read');
      next.resolve();
    }
  }

  private releaseOne(key: string, owner: string, mode: Mode): void {
    const state = this.locks.get(key);
    if (!state) return;
    if (mode === 'write' && state.writer === owner) {
      state.writeDepth -= 1;
      if (state.writeDepth === 0) state.writer = null;
    } else if (mode === 'read') {
      const depth = state.readers.get(owner) ?? 0;
      if (depth <= 1) state.readers.delete(owner);
      else state.readers.set(owner, depth - 1);
    }
    this.processQueue(key, state);
    if (!state.writer && state.readers.size === 0 && state.queue.length === 0)
      this.locks.delete(key);
  }

  async acquire(keys: string[], owner: string, mode: Mode = 'write'): Promise<LockLease> {
    const ordered = [...new Set(keys.filter(Boolean))].sort();
    const acquired: string[] = [];
    let waitMs = 0;
    try {
      for (const key of ordered) {
        waitMs += await this.acquireOne(key, owner, mode);
        acquired.push(key);
      }
    } catch (error) {
      for (const key of acquired.reverse()) this.releaseOne(key, owner, mode);
      throw error;
    }
    return {
      keys: ordered,
      mode,
      waitMs,
      release: () => {
        for (const key of [...ordered].reverse()) this.releaseOne(key, owner, mode);
      },
    };
  }
}
