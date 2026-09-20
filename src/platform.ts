import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function defaultDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (platform === 'win32')
    return resolve(env.LOCALAPPDATA || resolve(home, '.local', 'share'), 'DWB-MCP-Studio');
  if (platform === 'darwin')
    return resolve(home, 'Library', 'Application Support', 'DWB-MCP-Studio');
  return resolve(env.XDG_DATA_HOME || resolve(home, '.local', 'share'), 'DWB-MCP-Studio');
}

export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') return 'powershell.exe';
  if (platform === 'darwin') return '/bin/zsh';
  return env.SHELL || '/bin/sh';
}

export function pathIdentity(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let physical: string;
  try {
    physical = realpathSync.native(resolve(value));
  } catch {
    physical = resolve(value);
  }
  return platform === 'win32' ? physical.toLowerCase() : physical;
}

export function samePath(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return pathIdentity(left, platform) === pathIdentity(right, platform);
}
