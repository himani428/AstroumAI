import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/connection.js';
import { all, get, run, tx } from '../../db/connection.js';
import { config } from '../../config.js';
import { paginate, nowIso, normBrand } from '../../util/text.js';
import { HttpError, jsonRow, parse } from '../http.js';
import { deriveTargets } from '../../regulatory/status.js';
import { matchProduct } from '../../regulatory/match.js';
import type { RegEvent } from '../../regulatory/types.js';
import { writeAudit } from '../../audit.js';
import { todayIso } from '../../safety/service.js';

export function loadEvents(db: Db): RegEvent[] {
  return all<Record<string, unknown>>(db, 'SELECT * FROM regulatory_events ORDER BY event_id').map((r) => ({
    event_id: r.event_id as string, notification_id: r.notification_id as string, date_published: r.date_published as string, effective_date: r.effective_date as string, action: r.action as string,
    target_type: r.target_type as string, target_description: r.target_description as string, supersedes_event_id: (r.supersedes_event_id as string) || null, note: (r.note as string) || null,
    target_key: r.target_key as string, target: JSON.parse(r.target_json as string), source_row_id: r.source_row_id as number, batch_id: r.batch_id as number,
  }));
}

interface ProdRow { product_id: string; brand_name: string; brand_norm: string; manufacturer: string; dose_form: string; strength_text: string; is_fdc: number; anomaly_flags: string; source: string; source_version: string; batch_id: number; source_row_id: number; effective_from: string }

/** Worst derived regulatory state per product (computed from events at asOf; never stored). */
function regStates(db: Db, asOf: string) {
  const targets = deriveTargets(loadEvents(db), asOf);
  const ings = all<{ product_id: string; ingredient_norm: string }>(db, 'SELECT product_id, ingredient_norm FROM product_ingredients');
  const prods = all<{ product_id: string; brand_name: string; dose_form: string }>(db, 'SELECT product_id, brand_name, dose_form FROM drug_products');
  const by = new Map<string, string[]>();
  for (const i of ings) by.set(i.product_id, [...(by.get(i.product_id) ?? []), i.ingredient_norm]);
  const rank = ['SOURCE_CONFLICT', 'PROHIBITED', 'WITHDRAWN', 'RESTRICTED', 'STAYED'];
  const out = new Map<string, { state: string; applicability: string }>();
  for (const p of prods) {
    const { matches } = matchProduct({ product_id: p.product_id, brand_name: p.brand_name, dose_form: p.dose_form, ingredient_norms: by.get(p.product_id) ?? [] }, targets);
    const live = matches.filter((m) => m.target.state !== 'NO_EVENT_IN_FORCE');
    if (!live.length) continue;
    live.sort((a, b) => rank.indexOf(a.target.state) - rank.indexOf(b.target.state));
    out.set(p.product_id, { state: live[0]!.target.state, applicability: live[0]!.applicability });
  }
  return { out, targets };
}

export function drugRoutes(db: Db): Router {
  const r = Router();

  r.get('/drugs', (req, res) => {
    const q = parse(z.object({ q: z.string().optional(), form: z.string().optional(), fdc: z.enum(['true', 'false']).optional(), mapping: z.enum(['unique', 'collision']).optional(), flag: z.string().optional(), reg: z.string().optional(),
      sort: z.enum(['brand', 'product_id', 'manufacturer', 'ingredients']).optional(), dir: z.enum(['asc', 'desc']).optional(), page: z.coerce.number().optional(), size: z.coerce.number().optional(), as_of: z.string().optional() }), req.query);
    const where: string[] = []; const p: unknown[] = [];
    if (q.q) { where.push('(p.brand_name LIKE ? OR p.product_id LIKE ? OR p.strength_text LIKE ? OR p.manufacturer LIKE ?)'); const l = `%${q.q}%`; p.push(l, l, l, l); }
    if (q.form) { where.push('p.dose_form = ?'); p.push(q.form); }
    if (q.fdc) { where.push('p.is_fdc = ?'); p.push(q.fdc === 'true' ? 1 : 0); }
    if (q.mapping === 'collision') where.push('(SELECT COUNT(*) FROM drug_products x WHERE x.brand_norm = p.brand_norm) > 1');
    if (q.mapping === 'unique') where.push('(SELECT COUNT(*) FROM drug_products x WHERE x.brand_norm = p.brand_norm) = 1');
    if (q.flag) { where.push('p.anomaly_flags LIKE ?'); p.push(`%${q.flag}%`); }
    const { out: states } = regStates(db, q.as_of ?? todayIso());
    if (q.reg) {
      const ids = new Set([...states].filter(([, v]) => (q.reg === 'ANY' ? true : v.state === q.reg)).map(([k]) => k));
      if (!ids.size) return void res.json({ items: [], total: 0, page: 1, size: 25 });
      where.push(`p.product_id IN (${[...ids].map(() => '?').join(',')})`); p.push(...ids);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortCol = { brand: 'p.brand_name', product_id: 'p.product_id', manufacturer: 'p.manufacturer', ingredients: 'p.strength_text' }[q.sort ?? 'product_id'];
    const pg = paginate(q.page, q.size, config.pagination.defaultPageSize, config.pagination.maxPageSize);
    const total = get<{ n: number }>(db, `SELECT COUNT(*) n FROM drug_products p ${w}`, ...p)!.n;
    const rows = all<ProdRow & { collisions: number }>(db, `SELECT p.*, (SELECT COUNT(*) FROM drug_products x WHERE x.brand_norm = p.brand_norm) collisions FROM drug_products p ${w} ORDER BY ${sortCol} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, p.product_id LIMIT ? OFFSET ?`, ...p, pg.size, pg.offset);
    const ing = rows.length ? all<Record<string, unknown>>(db, `SELECT * FROM product_ingredients WHERE product_id IN (${rows.map(() => '?').join(',')}) ORDER BY product_id, position`, ...rows.map((x) => x.product_id)) : [];
    res.json({
      total, page: pg.page, size: pg.size,
      items: rows.map((x) => ({ ...x, anomaly_flags: JSON.parse(x.anomaly_flags), mapping_status: x.collisions > 1 ? 'BRAND_COLLISION' : 'UNIQUE_BRAND', reg_state: states.get(x.product_id)?.state ?? null, reg_applicability: states.get(x.product_id)?.applicability ?? null,
        ingredients: ing.filter((i) => i.product_id === x.product_id).map((i) => ({ name: i.ingredient_name, value: i.strength_value, unit: i.strength_unit, confidence: i.decomposition_confidence, method: i.decomposition_method, verification_status: i.verification_status })) })),
    });
  });

  r.get('/drugs/facets', (_req, res) => {
    res.json({ forms: all<{ dose_form: string; n: number }>(db, 'SELECT dose_form, COUNT(*) n FROM drug_products GROUP BY dose_form ORDER BY n DESC'), flags: ['UNIT_SUSPECT', 'DECOMPOSITION_DISCREPANCY'], reg_states: ['ANY', 'PROHIBITED', 'RESTRICTED', 'WITHDRAWN', 'STAYED', 'SOURCE_CONFLICT'] });
  });

  r.get('/drugs/:id', (req, res) => {
    const p = get<ProdRow>(db, 'SELECT * FROM drug_products WHERE product_id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'NOT_FOUND', `Product ${req.params.id} not found`);
    const ings = all<Record<string, unknown>>(db, 'SELECT * FROM product_ingredients WHERE product_id = ? ORDER BY position', p.product_id);
    const asOf = String(req.query.as_of ?? todayIso());
    const targets = deriveTargets(loadEvents(db), asOf);
    const { matches } = matchProduct({ product_id: p.product_id, brand_name: p.brand_name, dose_form: p.dose_form, ingredient_norms: ings.map((i) => i.ingredient_norm as string) }, targets);
    const names = ings.map((i) => i.ingredient_norm as string);
    const nlem = all(db, `SELECT * FROM nlem_entries WHERE medicine_norm IN (${[...names, names.slice().sort().join(' + ')].map(() => '?').join(',')})`, ...names, names.slice().sort().join(' + '));
    const ja = names.length ? all(db, `SELECT * FROM jan_aushadhi_entries WHERE generic_norm IN (${names.map(() => '?').join(',')})`, ...names) : [];
    const stock = all(db, 'SELECT * FROM stock_items WHERE mapped_product_id = ? ORDER BY expiry', p.product_id);
    const stockCandidates = all<Record<string, unknown>>(db, "SELECT id, item_name_as_billed, expiry, qty_units, mapping_status FROM stock_items WHERE mapping_status != 'MAPPED' AND parsed_brand_norm = ?", p.brand_norm);
    const siblings = all(db, 'SELECT product_id, manufacturer, dose_form, strength_text FROM drug_products WHERE brand_norm = ? AND product_id != ?', p.brand_norm, p.product_id);
    const src = get<{ raw_json: string; row_number: number; row_hash: string }>(db, 'SELECT raw_json, row_number, row_hash FROM source_rows WHERE id = ?', p.source_row_id);
    const batch = get(db, 'SELECT * FROM ingestion_batches WHERE id = ?', p.batch_id);
    res.json({
      product: { ...p, anomaly_flags: JSON.parse(p.anomaly_flags) }, ingredients: ings, as_of: asOf,
      regulatory: matches.map((m) => ({ target: m.target.target_description, derived_state: m.target.state, applicability: m.applicability, notes: m.reasons, citing_event: m.target.citing_event, timeline: m.target.timeline })),
      nlem, jan_aushadhi: ja, stock, stock_unmapped_with_same_brand: stockCandidates, brand_collisions: siblings,
      provenance: { source_row: src ? { row_number: src.row_number, row_hash: src.row_hash, raw: JSON.parse(src.raw_json) } : null, batch },
      stock_note: 'Stock rows are shown only when mapped without ambiguity or confirmed by a reviewer. Unmapped rows sharing this brand string are listed separately and are NOT assumed to be this product.',
    });
  });

  // ---------- FDC explorer ----------
  r.get('/fdc', (req, res) => {
    const q = parse(z.object({ q: z.string().optional(), verification: z.string().optional(), page: z.coerce.number().optional(), size: z.coerce.number().optional() }), req.query);
    const where = ['p.is_fdc = 1']; const p: unknown[] = [];
    if (q.q) { where.push('(p.brand_name LIKE ? OR p.strength_text LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.verification) { where.push('EXISTS (SELECT 1 FROM product_ingredients i WHERE i.product_id = p.product_id AND i.verification_status = ?)'); p.push(q.verification); }
    const pg = paginate(q.page, q.size);
    const w = `WHERE ${where.join(' AND ')}`;
    const total = get<{ n: number }>(db, `SELECT COUNT(*) n FROM drug_products p ${w}`, ...p)!.n;
    const rows = all<ProdRow>(db, `SELECT p.* FROM drug_products p ${w} ORDER BY p.product_id LIMIT ? OFFSET ?`, ...p, pg.size, pg.offset);
    const ings = rows.length ? all<Record<string, unknown>>(db, `SELECT * FROM product_ingredients WHERE product_id IN (${rows.map(() => '?').join(',')}) ORDER BY product_id, position`, ...rows.map((x) => x.product_id)) : [];
    res.json({ total, page: pg.page, size: pg.size, items: rows.map((x) => ({ ...x, anomaly_flags: JSON.parse(x.anomaly_flags), ingredients: ings.filter((i) => i.product_id === x.product_id) })) });
  });

  r.get('/fdc/stats', (_req, res) => {
    const by = all<{ verification_status: string; n: number }>(db, `SELECT verification_status, COUNT(DISTINCT product_id) n FROM product_ingredients WHERE product_id IN (SELECT product_id FROM drug_products WHERE is_fdc=1) GROUP BY verification_status`);
    const total = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products WHERE is_fdc = 1')!.n;
    const distinct = get<{ n: number }>(db, `SELECT COUNT(*) n FROM (SELECT DISTINCT GROUP_CONCAT(ingredient_norm, '+') c FROM (SELECT product_id, ingredient_norm FROM product_ingredients ORDER BY ingredient_norm) WHERE product_id IN (SELECT product_id FROM drug_products WHERE is_fdc=1) GROUP BY product_id)`)!.n;
    const cross = by.find((b) => b.verification_status === 'CROSS_CHECKED_SAME_SOURCE')?.n ?? 0;
    const reviewer = by.find((b) => b.verification_status === 'REVIEWER_VERIFIED')?.n ?? 0;
    res.json({
      total_fdc_products: total, distinct_compositions: distinct, by_verification: by, target_minimum: 100,
      meets_minimum_decomposed: total >= 100,
      internal_consistency_rate: total ? cross / total : null,
      clinician_verified: reviewer,
      g2_statement: `Measured: ${cross} of ${total} FDC rows have structured columns and strength_text agreeing (${total ? ((cross / total) * 100).toFixed(1) : 0}%). That is a self-consistency check on one source, NOT accuracy against a clinician key. Clinician-verified count: ${reviewer}. The 95% G2 target is therefore UNVERIFIED.`,
    });
  });

  r.post('/fdc/:id/verify', (req, res) => {
    const b = parse(z.object({ actor: z.string().min(1), decision: z.enum(['VERIFIED', 'DISPUTED']), note: z.string().optional() }), req.body);
    const p = get<ProdRow>(db, 'SELECT * FROM drug_products WHERE product_id = ? AND is_fdc = 1', req.params.id);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'FDC product not found');
    const before = all(db, 'SELECT id, verification_status FROM product_ingredients WHERE product_id = ?', p.product_id);
    const status = b.decision === 'VERIFIED' ? 'REVIEWER_VERIFIED' : 'DISPUTED_BY_REVIEWER';
    tx(db, () => {
      run(db, 'UPDATE product_ingredients SET verification_status = ?, verification_detail = ? WHERE product_id = ?', status, `${status} by ${b.actor} at ${nowIso()}${b.note ? ': ' + b.note : ''}`, p.product_id);
      writeAudit(db, b.actor, `FDC_${b.decision}`, 'drug_product', p.product_id, { before, note: b.note ?? null });
    });
    res.json({ product_id: p.product_id, verification_status: status });
  });

  // ---------- review queue ----------
  r.get('/review-queue', (req, res) => {
    const q = parse(z.object({ status: z.string().optional(), type: z.string().optional(), reason: z.string().optional(), q: z.string().optional(), page: z.coerce.number().optional(), size: z.coerce.number().optional() }), req.query);
    const where: string[] = []; const p: unknown[] = [];
    if (q.status) { where.push('status = ?'); p.push(q.status); }
    if (q.type) { where.push('item_type = ?'); p.push(q.type); }
    if (q.reason) { where.push('reason_codes_json LIKE ?'); p.push(`%${q.reason}%`); }
    if (q.q) { where.push('input_text LIKE ?'); p.push(`%${q.q}%`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pg = paginate(q.page, q.size);
    const total = get<{ n: number }>(db, `SELECT COUNT(*) n FROM review_queue ${w}`, ...p)!.n;
    const items = all<Record<string, unknown>>(db, `SELECT * FROM review_queue ${w} ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END, id LIMIT ? OFFSET ?`, ...p, pg.size, pg.offset).map((x) => jsonRow(x, ['context_json', 'candidates_json', 'reason_codes_json', 'resolution_json']));
    const facets = { types: all(db, 'SELECT item_type, status, COUNT(*) n FROM review_queue GROUP BY item_type, status'), reasons: all<{ reason_codes_json: string; n: number }>(db, 'SELECT reason_codes_json, COUNT(*) n FROM review_queue GROUP BY reason_codes_json ORDER BY n DESC') };
    res.json({ total, page: pg.page, size: pg.size, items, facets });
  });

  r.get('/review-queue/:id', (req, res) => {
    const it = get<Record<string, unknown>>(db, 'SELECT * FROM review_queue WHERE id = ?', req.params.id);
    if (!it) throw new HttpError(404, 'NOT_FOUND', 'Queue item not found');
    const decisions = all<Record<string, unknown>>(db, 'SELECT * FROM review_decisions WHERE queue_id = ? ORDER BY id', it.id).map((d) => jsonRow(d, ['before_json', 'after_json']));
    const src = it.source_row_id ? get<{ raw_json: string; dataset: string; row_number: number }>(db, 'SELECT raw_json, dataset, row_number FROM source_rows WHERE id = ?', it.source_row_id) : undefined;
    res.json({ item: jsonRow(it, ['context_json', 'candidates_json', 'reason_codes_json', 'resolution_json']), decisions, source_row: src ? { dataset: src.dataset, row_number: src.row_number, raw: JSON.parse(src.raw_json) } : null });
  });

  r.post('/review-queue/:id/decision', (req, res) => {
    const b = parse(z.object({ actor: z.string().min(1, 'A reviewer name is required'), decision: z.enum(['ACCEPT_CANDIDATE', 'ACKNOWLEDGE', 'REJECT', 'DEFER', 'REOPEN']), candidate_product_id: z.string().optional(), note: z.string().optional() }), req.body);
    const it = get<Record<string, unknown>>(db, 'SELECT * FROM review_queue WHERE id = ?', req.params.id);
    if (!it) throw new HttpError(404, 'NOT_FOUND', 'Queue item not found');
    const cands = JSON.parse(it.candidates_json as string) as { product_id: string }[];
    const type = it.item_type as string;
    if (b.decision === 'ACCEPT_CANDIDATE') {
      if (!['RX_LINE', 'STOCK_LINE'].includes(type)) throw new HttpError(400, 'DECISION_NOT_ALLOWED', `${type} items cannot be resolved to a single product; use ACKNOWLEDGE, REJECT or DEFER`);
      if (!b.candidate_product_id || !cands.some((c) => c.product_id === b.candidate_product_id)) throw new HttpError(400, 'CANDIDATE_REQUIRED', 'candidate_product_id must be one of the listed candidates');
    }
    const before = { status: it.status, resolution: it.resolution_json };
    const statusMap = { ACCEPT_CANDIDATE: 'RESOLVED', ACKNOWLEDGE: 'RESOLVED', REJECT: 'REJECTED', DEFER: 'DEFERRED', REOPEN: 'OPEN' } as const;
    const after = { status: statusMap[b.decision], resolution: b.decision === 'REOPEN' ? null : { decision: b.decision, candidate_product_id: b.candidate_product_id ?? null, actor: b.actor, note: b.note ?? null } };
    tx(db, () => {
      const d = run(db, 'INSERT INTO review_decisions (queue_id, decided_at, actor, decision, note, before_json, after_json) VALUES (?,?,?,?,?,?,?)', it.id, nowIso(), b.actor, b.decision, b.note ?? null, JSON.stringify(before), JSON.stringify(after));
      run(db, 'UPDATE review_queue SET status = ?, resolution_json = ?, updated_at = ? WHERE id = ?', after.status, after.resolution ? JSON.stringify(after.resolution) : null, nowIso(), it.id);
      if (b.decision === 'REOPEN') run(db, 'DELETE FROM alias_confirmations WHERE decision_id IN (SELECT id FROM review_decisions WHERE queue_id = ?)', it.id);
      if (b.decision === 'ACCEPT_CANDIDATE' && type === 'RX_LINE') {
        const m = String(it.dedupe_key).match(/^rx:(.*)\|(.*)$/)!;
        run(db, 'INSERT OR REPLACE INTO alias_confirmations (alias_norm, strength_norm, product_id, decision_id, created_at) VALUES (?,?,?,?,?)', m[1], m[2], b.candidate_product_id, Number(d.lastInsertRowid), nowIso());
      }
      if (b.decision === 'ACCEPT_CANDIDATE' && type === 'STOCK_LINE') {
        const ctx = JSON.parse(it.context_json as string) as { parsed_brand: string; form_hint: string | null };
        run(db, "UPDATE stock_items SET mapped_product_id = ?, mapping_status = 'MAPPED', mapping_method = 'reviewer_confirmed', mapping_confidence = 1 WHERE parsed_brand_norm = ? AND COALESCE(parsed_form_hint,'') = ?", b.candidate_product_id, normBrand(ctx.parsed_brand), ctx.form_hint ?? '');
      }
      writeAudit(db, b.actor, `REVIEW_${b.decision}`, 'review_queue', it.id as number, { type, candidate: b.candidate_product_id ?? null, note: b.note ?? null, before, after });
    });
    res.json({ id: it.id, status: after.status });
  });
  return r;
}
