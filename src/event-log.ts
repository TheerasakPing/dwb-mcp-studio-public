import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { dataDir } from './paths.js';

export type BridgeEvent = {
  ts: string;
  type: string;
  workerPid?: number | null;
  tool?: string;
  durationMs?: number;
  ok?: boolean;
  bytes?: number;
  reason?: string;
  sessionId?: string;
  requestId?: string;
  workerId?: string;
  workspaceKey?: string;
  queueMs?: number;
  lockWaitMs?: number;
  conflict?: boolean;
  details?: Record<string, unknown>;
};

export class EventLog {
  readonly path: string;

  constructor(path = process.env.DWB_EVENT_LOG_PATH || resolve(dataDir(), 'logs', 'events.jsonl')) {
    this.path = path;
  }

  async write(event: Omit<BridgeEvent, 'ts'>): Promise<void> {
    const row: BridgeEvent = { ts: new Date().toISOString(), ...event };
    const line = JSON.stringify(row);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line + '\n', 'utf8');
  }
}
