import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/connection.js';
import { all, get } from '../../db/connection.js';
import { config } from '../../config.js';
import { deriveTargets } from '../../regulatory/status.js';
import { HttpError, jsonRow, parse } from '../http.js';
import { loadEvents } from './drugs.js';
import { runPrescription, runSeededDemo, simulateNewEvent, todayIso, seededPrescriptions } from '../../safety/service.js';
import { freshness } from '../../safety/engine.js';
import type { DatasetVersionInfo } from '../../safety/types.js';

const lineSchema = z.object({
  line_no: z.number().int().positive().optional(), written_product: z.string().min(1).max(200), strength_as_written: z.string().max(50).nullish(),
  dose_frequency: z.string().max(80).nullish(), clinical_note: z.string().max(200).nullish(),
});
export const rxSchema = z.array(lineSchema).min(1).max(30).transform((ls) => ls.map((l, i) => ({ ...l, line_no: l.line_no ?? i + 1 })));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export function regSafetyRoutes(db: Db): Router {
  const r = Router();

  // ---------- regulatory ----------
  r.get('/regulatory/events', (_req, res) => {
    const items = all<Record<string, unknown>>(db, 'SELECT * FROM regulatory_events ORDER BY effective_date, event_id').map((x) => jsonRow(x, ['target_json']));
    const src = all<Record<string, unknown>>(db, 'SELECT id, row_number, row_hash FROM source_rows WHERE dataset = ? AND status = ?', 'regulatory', 'IMPORTED');
    res.json({ total: items.length, items: items.map((e) => ({ ...e, source_row: src.find((s) => s.id === e.source_row_id) ?? null })) });
  });

  r.get('/regulatory/targets', (req, res) => {
    const q = parse(z.object({ as_of: dateStr.optional() }), req.query);
    const asOf = q.as_of ?? todayIso();
    const targets = deriveTargets(loadEvents(db), asOf);
    const v = get<DatasetVersionInfo>(db, "SELECT * FROM dataset_versions WHERE dataset = 'regulatory'");
    const f = v ? freshness(v, asOf) : null;
    const states = targets.reduce<Record<string, number>>((a, t) => ({ ...a, [t.state]: (a[t.state] ?? 0) + 1 }), {});
    res.json({ as_of: asOf, targets, state_counts: states, freshness: f ? { ...f, status: f.expired ? 'STALE' : 'FRESH', max_age_days: v!.max_age_days, loaded_at: v!.loaded_at } : null,
      notes: ['Status is derived from effective-dated events and supersession links; there is no stored banned flag.', 'The register file declares no as-of date, so freshness is measured from load time.'] });
  });

  r.post('/regulatory/simulate', (req, res) => {
    const b = parse(z.object({ notification_id: z.string().min(1), effective_date: dateStr, date_published: dateStr.optional(), action: z.enum(['PROHIBITED', 'RESTRICTED', 'WITHDRAWN', 'STAY_GRANTED']), target_type: z.enum(['FDC', 'INGREDIENT', 'PRODUCT']), target_description: z.string().min(3), supersedes_event_id: z.string().nullish(), as_of: dateStr.optional() }), req.body);
    res.json(simulateNewEvent(db, b, b.as_of));
  });

  // ---------- safety ----------
  r.post('/safety/run', (req, res) => {
    const b = parse(z.object({ prescription: rxSchema, as_of: dateStr.optional(), simulate_outage: z.enum(['regulatory', 'interactions', 'all']).optional(), label: z.string().max(80).optional() }), req.body);
    res.json(runPrescription(db, b.prescription, { asOf: b.as_of, origin: 'USER', label: b.label, simulateOutage: b.simulate_outage }));
  });

  r.get('/safety/demo', (_req, res) => {
    const rx = seededPrescriptions(db);
    const runs = all<Record<string, unknown>>(db, "SELECT * FROM safety_runs WHERE origin = 'SEEDED_DEMO' ORDER BY rx_label");
    res.json({
      origin: 'SEEDED_DEMO', note: 'Synthetic demonstration prescriptions from seed_prescriptions_template.csv. Not real patients. Evaluated at the fixed demo date for reproducibility.', as_of: config.demo.asOf,
      items: [...rx].map(([id, lines]) => { const run = runs.find((x) => x.rx_label === id); return { rx_id: id, lines, report: run ? JSON.parse(run.output_json as string) : null, run_id: run?.id ?? null }; }),
    });
  });

  r.post('/safety/demo/run', (_req, res) => {
    const out = runSeededDemo(db);
    res.json({ count: Object.keys(out).length, as_of: config.demo.asOf });
  });

  r.get('/safety/runs', (req, res) => {
    const origin = req.query.origin ? String(req.query.origin) : null;
    const rows = all<Record<string, unknown>>(db, `SELECT id, created_at, origin, rx_label, as_of, rule_version, data_version, output_json FROM safety_runs ${origin ? 'WHERE origin = ?' : ''} ORDER BY id DESC LIMIT 100`, ...(origin ? [origin] : []));
    res.json({ items: rows.map((x) => { const o = JSON.parse(x.output_json as string); return { id: x.id, created_at: x.created_at, origin: x.origin, label: x.rx_label, as_of: x.as_of, rule_version: x.rule_version, data_version: x.data_version, counts: o.summary.counts }; }) });
  });

  r.get('/safety/runs/:id', (req, res) => {
    const x = get<Record<string, unknown>>(db, 'SELECT * FROM safety_runs WHERE id = ?', req.params.id);
    if (!x) throw new HttpError(404, 'NOT_FOUND', 'Run not found');
    res.json({ id: x.id, origin: x.origin, created_at: x.created_at, input: JSON.parse(x.input_json as string), report: JSON.parse(x.output_json as string) });
  });
  return r;
}
