import { resolve } from 'node:path';
import { defaultDataDir } from './platform.js';

export function dataDir(): string {
  return resolve(process.env.DWB_DATA_DIR || defaultDataDir());
}
export function runtimeDir(): string {
  return resolve(process.env.DWB_RUNTIME_DIR || resolve(dataDir(), 'runtime'));
}
