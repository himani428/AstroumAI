import type { Db } from './db/connection.js';
import { run } from './db/connection.js';
import { nowIso } from './util/text.js';

export function writeAudit(db: Db, actor: string, action: string, entity: string, entityId: string | number | null, detail: unknown = {}) {
  run(db, 'INSERT INTO audit_log (at, actor, action, entity, entity_id, detail_json) VALUES (?,?,?,?,?,?)', nowIso(), actor, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail));
}
