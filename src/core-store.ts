import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runtimeDir } from './paths.js';

// Only workspace bindings; no imported history, chat archive, or Work database.
export class CoreStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  constructor(path = process.env.DWB_WORKSPACE_DB || resolve(runtimeDir(), 'workspaces.db')) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_aliases (
        workspace_id TEXT NOT NULL, alias TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,alias), UNIQUE(alias));
      CREATE TABLE IF NOT EXISTS session_workspace_bindings (
        session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, bound_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_events (
        id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL,
        session_id TEXT, details_json TEXT);
    `);
  }
  close() {
    this.db.close();
  }
  run(sql: string, params: any[] = []) {
    return this.db.prepare(sql).run(...params);
  }
  query<T = Record<string, unknown>>(sql: string, params: any[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, params: any[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
}
