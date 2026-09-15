import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runtimeDir } from './paths.js';
import type { FileFingerprint } from './file-observer.js';

export type PersistedSession = {
  id: string;
  workspaceKey: string;
  transportWorkspaceKey?: string;
  contextKey?: string | null;
  contextSource?: string | null;
  contextPreview?: string | null;
  transportSessionId?: string | null;
  createdAt: string;
  lastActivityAt: string;
  detachedAt: string | null;
  observations: Array<[string, FileFingerprint]>;
};

export type BrokerState = {
  version: 1;
  updatedAt: string;
  sessions: PersistedSession[];
};

export const brokerStatePath = process.env.DWB_BROKER_STATE_PATH
  ? resolve(process.env.DWB_BROKER_STATE_PATH)
  : resolve(runtimeDir(), 'broker-state.json');
export async function loadBrokerState(path = brokerStatePath): Promise<BrokerState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as BrokerState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions))
      throw new Error('Unsupported broker state');
    return parsed;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw new Error(
        'DWB_STATE_LOAD_FAILED: saved sessions could not be read; preserve and repair broker-state.json before restarting.',
        { cause: error },
      );
    }
    return { version: 1, updatedAt: new Date(0).toISOString(), sessions: [] };
  }
}

export async function saveBrokerState(
  sessions: PersistedSession[],
  path = brokerStatePath,
): Promise<void> {
  const state: BrokerState = { version: 1, updatedAt: new Date().toISOString(), sessions };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, path);
}
