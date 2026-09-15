import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

// Resolve junctions, including the existing parent of a file not created yet.
// Never fall back to a lexical path on access errors or broken links.
export function physicalPath(path: string): string {
  let parent = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      const result = join(realpathSync.native(parent), ...missing);
      return process.platform === 'win32' ? result.toLowerCase() : result;
    } catch (error: any) {
      if (error?.code !== 'ENOENT' || dirname(parent) === parent) throw error;
      if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
      missing.unshift(basename(parent));
      parent = dirname(parent);
    }
  }
}

export type FileFingerprint = {
  exists: boolean;
  size: number;
  mtimeMs: number;
  sha256?: string;
};

export class StaleFileConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expected: FileFingerprint,
    readonly current: FileFingerprint,
  ) {
    super(`File changed since this MCP session last observed it: ${path}`);
    this.name = 'StaleFileConflictError';
  }
}

export function canonicalPath(value: unknown, cwd: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^https?:\/\//i.test(value)) return null;
  return physicalPath(normalize(isAbsolute(value) ? value : resolve(cwd, value)));
}

export async function fingerprint(path: string): Promise<FileFingerprint> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { exists: true, size: info.size, mtimeMs: info.mtimeMs };
    const result: FileFingerprint = { exists: true, size: info.size, mtimeMs: info.mtimeMs };
    if (info.size <= 16 * 1024 * 1024) {
      const data = await readFile(path);
      result.sha256 = createHash('sha256').update(data).digest('hex');
    }
    return result;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { exists: false, size: 0, mtimeMs: 0 };
    throw error;
  }
}

export function sameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
  if (a.exists !== b.exists || a.size !== b.size) return false;
  if (a.sha256 && b.sha256) return a.sha256 === b.sha256;
  return a.mtimeMs === b.mtimeMs;
}

export type ToolPlan = {
  locks: string[];
  observe: string[];
  mutate: string[];
  kind: 'read' | 'file-mutation' | 'workspace-mutation' | 'global-mutation' | 'other';
};

function pathArg(args: Record<string, unknown>, key: string, cwd: string): string | null {
  return canonicalPath(args[key], cwd);
}

export function planTool(
  name: string,
  args: Record<string, unknown>,
  workspaceKey: string,
): ToolPlan {
  if (name === 'read_file') {
    const path = args.isUrl === true ? null : pathArg(args, 'path', workspaceKey);
    return {
      locks: path ? [`file:${path}`] : [],
      observe: path ? [path] : [],
      mutate: [],
      kind: 'read',
    };
  }
  if (name === 'read_multiple_files') {
    const paths = Array.isArray(args.paths)
      ? args.paths.map((p) => canonicalPath(p, workspaceKey)).filter((p): p is string => Boolean(p))
      : [];
    return { locks: paths.map((p) => `file:${p}`), observe: paths, mutate: [], kind: 'read' };
  }
  if (name === 'write_file') {
    const path = pathArg(args, 'path', workspaceKey);
    return {
      locks: path ? [`file:${path}`] : [],
      observe: [],
      mutate: path ? [path] : [],
      kind: 'file-mutation',
    };
  }
  if (name === 'edit_block') {
    const path = pathArg(args, 'file_path', workspaceKey);
    return {
      locks: path ? [`file:${path}`] : [],
      observe: [],
      mutate: path ? [path] : [],
      kind: 'file-mutation',
    };
  }
  if (name === 'move_file') {
    const source = pathArg(args, 'source', workspaceKey);
    const destination = pathArg(args, 'destination', workspaceKey);
    const paths = [source, destination].filter((p): p is string => Boolean(p));
    return {
      locks: paths.map((p) => `file:${p}`),
      observe: [],
      mutate: paths,
      kind: 'file-mutation',
    };
  }
  if (name === 'create_directory') {
    const path = pathArg(args, 'path', workspaceKey);
    return { locks: path ? [`file:${path}`] : [], observe: [], mutate: [], kind: 'file-mutation' };
  }
  if (name === 'write_pdf') {
    const path = pathArg(args, 'outputPath', workspaceKey) ?? pathArg(args, 'path', workspaceKey);
    return {
      locks: path ? [`file:${path}`] : [],
      observe: [],
      mutate: path ? [path] : [],
      kind: 'file-mutation',
    };
  }
  if (name === 'set_config_value') {
    return {
      locks: ['global:desktop-commander-config'],
      observe: [],
      mutate: [],
      kind: 'global-mutation',
    };
  }
  if (
    ['start_process', 'interact_with_process', 'force_terminate', 'kill_process'].includes(name)
  ) {
    return {
      locks: [`workspace-process:${physicalPath(workspaceKey)}`],
      observe: [],
      mutate: [],
      kind: 'workspace-mutation',
    };
  }
  return { locks: [], observe: [], mutate: [], kind: 'other' };
}
