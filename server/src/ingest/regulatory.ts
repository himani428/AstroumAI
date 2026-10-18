import { run } from '../db/connection.js';
import { config } from '../config.js';
import { parseTarget, targetKey } from '../regulatory/parser.js';
import { deriveTargets } from '../regulatory/status.js';
import type { RegEvent } from '../regulatory/types.js';
import { checkHeader, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

const REQUIRED = ['event_id', 'notification_id', 'date_published', 'effective_date', 'action', 'target_type', 'target_description', 'supersedes_event_id', 'note'];
const KNOWN_ACTIONS = ['PROHIBITED', 'RESTRICTED', 'WITHDRAWN', 'STAY_GRANTED'];
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function importRegulatory(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, REQUIRED)) return;
  const seen = new Map<string, number>();
  const events: RegEvent[] = [];
  for (const row of rows) {
    const r = row.record;
    const problems: string[] = [];
    if (row.cells.length !== header.length) problems.push('MALFORMED_COLUMN_COUNT');
    if (!r.event_id) problems.push('MISSING_EVENT_ID');
    if (!r.notification_id) problems.push('MISSING_NOTIFICATION_ID');
    if (!isDate(r.date_published!)) problems.push('BAD_PUBLISHED_DATE');
    if (!isDate(r.effective_date!)) problems.push('BAD_EFFECTIVE_DATE');
    if (!r.action || !r.target_description) problems.push('MISSING_ACTION_OR_TARGET');
    if (problems.length) { recordRow(b, row.rowNumber, r, 'REJECTED', problems[0], problems.join(',')); continue; }
    if (seen.has(r.event_id!)) { recordRow(b, row.rowNumber, r, 'DUPLICATE', 'DUPLICATE_EVENT_ID', `first on row ${seen.get(r.event_id!)}`); continue; }
    seen.set(r.event_id!, row.rowNumber);
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    if (!KNOWN_ACTIONS.includes(r.action!)) { b.warnings.push(`${r.event_id}: unknown action "${r.action}" imported; status derivation will report SOURCE_CONFLICT for it`); b.counters.unresolved++; }
    const target = parseTarget(r.target_type!, r.target_description!);
    if (target.descriptive) { b.warnings.push(`${r.event_id}: target "${r.target_description}" is descriptive and cannot be machine-matched to products`); b.counters.unresolved++; }
    const ev: RegEvent = {
      event_id: r.event_id!, notification_id: r.notification_id!, date_published: r.date_published!, effective_date: r.effective_date!, action: r.action!,
      target_type: r.target_type!, target_description: r.target_description!, supersedes_event_id: r.supersedes_event_id || null, note: r.note || null,
      target_key: targetKey(target), target, source_row_id: src, batch_id: b.id,
    };
    events.push(ev);
    run(b.db, `INSERT INTO regulatory_events (event_id, notification_id, date_published, effective_date, action, target_type, target_description, supersedes_event_id, note,
        target_key, target_json, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ev.event_id, ev.notification_id, ev.date_published, ev.effective_date, ev.action, ev.target_type, ev.target_description, ev.supersedes_event_id, ev.note,
      ev.target_key, JSON.stringify(target), b.id, src);
  }
  for (const t of deriveTargets(events, config.demo.asOf)) for (const a of t.anomalies) b.warnings.push(`REGISTER_ANOMALY ${a}`);
  upsertDatasetVersion(b.db, 'regulatory', b, file, { label: `${events.length} events`, sourceDate: null, basis: 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.regulatory.maxAgeDays });
  b.warnings.push('Register file carries no "as-of" date; freshness measured from load time only (see GAPS_REGISTER).');
}
