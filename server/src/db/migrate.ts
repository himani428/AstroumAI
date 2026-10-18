import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { Db } from './connection.js';
import { log } from '../logger.js';

/** Applies numbered SQL migrations (NNN_name.sql) in order, exactly once each. */
export function migrate(db: Db): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );
  const files = fs
    .readdirSync(config.paths.migrations)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(config.paths.migrations, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`, { cause: e });
    }
    applied.push(f);
    log.info('migration applied', { file: f });
  }
  return applied;
}
