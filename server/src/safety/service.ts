import type { Db } from '../db/connection.js';
import { all, run } from '../db/connection.js';
import { config } from '../config.js';
import { normalizePrescription } from '../master/normalizeRx.js';
import type { RegEvent } from '../regulatory/types.js';
import { parseTarget, targetKey } from '../regulatory/parser.js';
import { nowIso } from '../util/text.js';
import { runSafetyRail } from './engine.js';
import { OutageRailData, SqliteRailData } from './provider.js';
import type { CheckType, RailReport, RxLineInput } from './types.js';

export interface RunOptions {
  asOf?: string; origin?: 'SEEDED_DEMO' | 'USER' | 'TRACE' | 'SIMULATION'; label?: string; persist?: boolean; checks?: CheckType[];
  simulateOutage?: 'regulatory' | 'interactions' | 'all'; extraEvents?: RegEvent[]; now?: Date;
}
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function runPrescription(db: Db, lines: RxLineInput[], opts: RunOptions = {}): RailReport {
  const asOf = opts.asOf ?? todayIso();
  const resolved = normalizePrescription(db, lines, { enqueueUnresolved: opts.origin !== 'SIMULATION' });
  let data = new SqliteRailData(db, opts.extraEvents ?? []) as SqliteRailData | OutageRailData;
  if (opts.simulateOutage) data = new OutageRailData(data, opts.simulateOutage);
  const report = runSafetyRail(resolved, data, { asOf, now: opts.now, checks: opts.checks });
  if (opts.persist !== false) {
    run(db, 'INSERT INTO safety_runs (created_at, origin, rx_label, as_of, rule_version, data_version, input_json, output_json) VALUES (?,?,?,?,?,?,?,?)',
      nowIso(), opts.origin ?? 'USER', opts.label ?? null, asOf, report.rule_version, report.data_version, JSON.stringify(lines), JSON.stringify(report));
  }
  return report;
}

export function seededPrescriptions(db: Db): Map<string, (RxLineInput & { rx_id: string })[]> {
  const rows = all<Record<string, unknown>>(db, 'SELECT * FROM seed_prescriptions ORDER BY rx_id, item_no');
  const m = new Map<string, (RxLineInput & { rx_id: string })[]>();
  for (const r of rows) {
    const l = m.get(r.rx_id as string) ?? [];
    l.push({ rx_id: r.rx_id as string, line_no: r.item_no as number, written_product: r.written_product as string, strength_as_written: r.strength_as_written as string | null, dose_frequency: r.dose_frequency as string | null, clinical_note: r.clinical_note as string | null });
    m.set(r.rx_id as string, l);
  }
  return m;
}

/** Re-runs all seeded prescriptions at the fixed demo date so outputs are reproducible. Replaces previous seeded runs. */
export function runSeededDemo(db: Db, opts: { asOf?: string; extraEvents?: RegEvent[]; origin?: 'SEEDED_DEMO' | 'SIMULATION'; persist?: boolean } = {}): Record<string, RailReport> {
  const asOf = opts.asOf ?? config.demo.asOf;
  const origin = opts.origin ?? 'SEEDED_DEMO';
  if (origin === 'SEEDED_DEMO' && opts.persist !== false) run(db, "DELETE FROM safety_runs WHERE origin = 'SEEDED_DEMO'");
  const out: Record<string, RailReport> = {};
  for (const [rx, lines] of seededPrescriptions(db)) {
    out[rx] = runPrescription(db, lines.map(({ rx_id: _r, ...l }) => l), { asOf, origin, label: rx, persist: opts.persist !== false && origin === 'SEEDED_DEMO', extraEvents: opts.extraEvents, now: new Date(`${asOf}T00:00:00.000Z`) });
  }
  return out;
}

/** What-if: add a hypothetical gazette event (never persisted) and diff seeded results against the baseline. */
export function simulateNewEvent(db: Db, ev: { notification_id: string; effective_date: string; date_published?: string; action: string; target_type: string; target_description: string; supersedes_event_id?: string | null }, asOf?: string) {
  const when = asOf ?? config.demo.asOf;
  const target = parseTarget(ev.target_type, ev.target_description);
  const sim: RegEvent = { event_id: 'SIM-001', notification_id: ev.notification_id, date_published: ev.date_published ?? ev.effective_date, effective_date: ev.effective_date, action: ev.action, target_type: ev.target_type, target_description: ev.target_description, supersedes_event_id: ev.supersedes_event_id ?? null, note: 'SIMULATED, not persisted', target_key: targetKey(target), target };
  const before = runSeededDemo(db, { asOf: when, origin: 'SIMULATION', persist: false });
  const after = runSeededDemo(db, { asOf: when, origin: 'SIMULATION', persist: false, extraEvents: [sim] });
  const changes = Object.keys(after).flatMap((rx) => after[rx]!.checks.flatMap((c, i) => {
    const b = before[rx]!.checks[i]!;
    return b.status !== c.status || b.severity !== c.severity ? [{ rx_id: rx, check_type: c.check_type, before: `${b.status}/${b.severity}`, after: `${c.status}/${c.severity}`, explanation: c.explanation }] : [];
  }));
  return { simulated_event: sim, as_of: when, persisted: false, prescriptions_evaluated: Object.keys(after).length, changes };
}
