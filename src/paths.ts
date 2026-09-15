import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function dataDir(): string {
  return resolve(
    process.env.DWB_DATA_DIR ||
      resolve(process.env.LOCALAPPDATA || resolve(homedir(), '.local', 'share'), 'DWB-MCP-Studio'),
  );
}
export function runtimeDir(): string {
  return resolve(process.env.DWB_RUNTIME_DIR || resolve(dataDir(), 'runtime'));
}
