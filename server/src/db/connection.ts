import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type Db = DatabaseSync;

let shared: Db | null = null;

export function openDb(file: string = config.paths.db): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Process-wide handle for the API server. Tests open their own in-memory DBs. */
export function getDb(): Db {
  if (!shared) shared = openDb();
  return shared;
}

export function closeDb() {
  shared?.close();
  shared = null;
}

/** Run fn inside a transaction; commit unless `rollback` is returned true (dry-run). */
export function tx<T>(db: Db, fn: () => T, opts: { rollback?: boolean } = {}): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec(opts.rollback ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const all = <T = Record<string, unknown>>(db: Db, sql: string, ...p: unknown[]): T[] =>
  db.prepare(sql).all(...(p as never[])) as T[];
export const get = <T = Record<string, unknown>>(db: Db, sql: string, ...p: unknown[]): T | undefined =>
  db.prepare(sql).get(...(p as never[])) as T | undefined;
export const run = (db: Db, sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));
