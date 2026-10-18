import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/connection.js';
import { all, get } from '../../db/connection.js';
import { config } from '../../config.js';
import { runIngestion, type IngestionReport } from '../../ingest/pipeline.js';
import { ingestCorpus } from '../../corpus/store.js';
import { HttpError, jsonRow, parse } from '../http.js';
import { deriveTargets } from '../../regulatory/status.js';
import { loadEvents } from './drugs.js';
import { freshness } from '../../safety/engine.js';
import type { DatasetVersionInfo } from '../../safety/types.js';
import { todayIso } from '../../safety/service.js';
import { paginate } from '../../util/text.js';
import { listPrompts } from '../../prompts.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODEL, deleteSetting, getLlmSettings, maskKey, setSetting } from '../../secrets.js';
import { testAnthropicKey } from '../../qa/llm.js';
import { writeAudit } from '../../audit.js';

interface Job { id: string; kind: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; progress: { dataset: string; phase: string; index: number; total: number }[]; result?: IngestionReport | unknown; error?: string; started_at: string }
const jobs = new Map<string, Job>();

export function systemRoutes(db: Db): Router {
  const r = Router();
  const today = () => todayIso();

  r.get('/health', (_req, res) => {
    const degraded: { component: string; message: string; severity: 'ERROR' | 'WARN' | 'INFO' }[] = [];
    let dbOk = true;
    try { get(db, 'SELECT 1'); } catch (e) { dbOk = false; degraded.push({ component: 'database', message: (e as Error).message, severity: 'ERROR' }); }
    const versions = dbOk ? all<DatasetVersionInfo>(db, 'SELECT * FROM dataset_versions') : [];
    const loaded = new Set(versions.map((v) => v.dataset));
    for (const d of ['cdci', 'regulatory', 'interactions']) if (!loaded.has(d)) degraded.push({ component: `dataset:${d}`, message: 'required dataset not loaded; the safety rail will return SERVICE_UNAVAILABLE', severity: 'ERROR' });
    const fresh = versions.map((v) => ({ dataset: v.dataset, ...freshness(v, today()), max_age_days: v.max_age_days, version_label: v.version_label, loaded_at: v.loaded_at }));
    for (const f of fresh) if (f.expired) degraded.push({ component: `freshness:${f.dataset}`, message: `${f.ageDays} days old (limit ${f.max_age_days}); checks relying on it return DATA_EXPIRED`, severity: 'WARN' });
    const chunks = dbOk ? get<{ n: number }>(db, 'SELECT COUNT(*) n FROM corpus_chunks')!.n : 0;
    if (!chunks) degraded.push({ component: 'corpus', message: 'clinical corpus not ingested; Q&A unavailable', severity: 'ERROR' });
    degraded.push({ component: 'neural-embeddings', message: 'not configured; retrieval uses BM25 plus a local character n-gram semantic approximation (optional upgrade)', severity: 'INFO' });
    degraded.push({ component: 'llm-composer', message: dbOk && getLlmSettings(db).apiKey ? 'API key configured (optional, Module B wording only, never the safety rail)' : 'no API key saved; answers are extractive and verbatim (default)', severity: 'INFO' });
    res.json({ status: degraded.some((d) => d.severity === 'ERROR') ? 'DEGRADED' : degraded.some((d) => d.severity === 'WARN') ? 'DEGRADED_WARN' : 'OK', time: new Date().toISOString(), components: { database: dbOk, corpus_chunks: chunks, datasets_loaded: [...loaded] }, freshness: fresh, degraded });
  });

  r.get('/dashboard', (_req, res) => {
    const n = (sql: string, ...p: unknown[]) => get<{ n: number }>(db, sql, ...p)!.n;
    const asOf = today();
    const targets = deriveTargets(loadEvents(db), asOf);
    const fdcTotal = n('SELECT COUNT(*) n FROM drug_products WHERE is_fdc = 1');
    const cross = n("SELECT COUNT(DISTINCT product_id) n FROM product_ingredients WHERE verification_status='CROSS_CHECKED_SAME_SOURCE' AND product_id IN (SELECT product_id FROM drug_products WHERE is_fdc=1)");
    const qa = all<{ outcome: string; n: number }>(db, 'SELECT outcome, COUNT(*) n FROM qa_runs GROUP BY outcome');
    const ev = get<{ id: number; created_at: string; total: number; correct: number; abstained: number; wrong: number; results_json: string }>(db, 'SELECT * FROM eval_runs ORDER BY id DESC LIMIT 1');
    const runsBy = all<{ origin: string; n: number }>(db, 'SELECT origin, COUNT(*) n FROM safety_runs GROUP BY origin');
    const prov = {
      products_with_source_row: n('SELECT COUNT(*) n FROM drug_products WHERE source_row_id IS NOT NULL AND batch_id IS NOT NULL'), products: n('SELECT COUNT(*) n FROM drug_products'),
      ingredients_with_source_row: n('SELECT COUNT(*) n FROM product_ingredients WHERE source_row_id IS NOT NULL'), ingredients: n('SELECT COUNT(*) n FROM product_ingredients'),
      events_with_source_row: n('SELECT COUNT(*) n FROM regulatory_events WHERE source_row_id IS NOT NULL'), events: n('SELECT COUNT(*) n FROM regulatory_events'),
    };
    const versions = all<DatasetVersionInfo>(db, 'SELECT * FROM dataset_versions ORDER BY dataset');
    res.json({
      as_of: asOf,
      drug_master: { products: prov.products, ingredients_rows: prov.ingredients, fdc_products: fdcTotal, fdc_cross_checked: cross, brand_collisions: n("SELECT COUNT(*) n FROM review_queue WHERE item_type='BRAND_COLLISION'") },
      mappings: { stock_total: n('SELECT COUNT(*) n FROM stock_items'), stock_mapped: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='MAPPED'"), stock_queued: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='QUEUED'"), stock_unmapped: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='UNMAPPED'") },
      review: { open: n("SELECT COUNT(*) n FROM review_queue WHERE status='OPEN'"), resolved: n("SELECT COUNT(*) n FROM review_queue WHERE status='RESOLVED'"), by_type: all(db, "SELECT item_type, COUNT(*) n FROM review_queue WHERE status='OPEN' GROUP BY item_type") },
      regulatory: { events: prov.events, targets: targets.length, by_state: targets.reduce<Record<string, number>>((a, t) => ({ ...a, [t.state]: (a[t.state] ?? 0) + 1 }), {}), pending_effective: targets.reduce((s, t) => s + t.pending_events.length, 0), anomalies: targets.flatMap((t) => t.anomalies).length },
      safety: { runs_by_origin: runsBy, user_runs: runsBy.find((x) => x.origin === 'USER')?.n ?? 0, seeded_demo_runs: runsBy.find((x) => x.origin === 'SEEDED_DEMO')?.n ?? 0 },
      qa: { answered: qa.find((x) => x.outcome === 'ANSWERED')?.n ?? 0, abstained: qa.find((x) => x.outcome === 'ABSTAINED')?.n ?? 0, partial: qa.find((x) => x.outcome === 'PARTIAL')?.n ?? 0, corpus_documents: n('SELECT COUNT(*) n FROM corpus_documents'), corpus_chunks: n('SELECT COUNT(*) n FROM corpus_chunks') },
      evaluation: ev ? { id: ev.id, created_at: ev.created_at, total: ev.total, correct: ev.correct, abstained: ev.abstained, wrong: ev.wrong, core: JSON.parse(ev.results_json).core_totals } : null,
      provenance: prov,
      freshness: versions.map((v) => ({ dataset: v.dataset, version_label: v.version_label, ...freshness(v, asOf), max_age_days: v.max_age_days })),
      recent_batches: all(db, 'SELECT id, dataset, mode, status, started_at, rows_total, rows_imported, rows_rejected, rows_duplicate, rows_unresolved FROM ingestion_batches ORDER BY id DESC LIMIT 8'),
      recent_activity: all(db, 'SELECT at, actor, action, entity, entity_id FROM audit_log ORDER BY id DESC LIMIT 8'),
      label_note: 'Counts of runs are labelled by origin; SEEDED_DEMO runs are synthetic demonstration data, not usage.',
    });
  });

  // ---------- ingestion ----------
  r.post('/ingestion/run', (req, res) => {
    const b = parse(z.object({ dry_run: z.boolean().default(true), force: z.boolean().default(false), datasets: z.array(z.string()).optional(), include_corpus: z.boolean().default(false) }), req.body);
    const job: Job = { id: randomUUID(), kind: b.dry_run ? 'INGESTION_DRY_RUN' : 'INGESTION', status: 'RUNNING', progress: [], started_at: new Date().toISOString() };
    jobs.set(job.id, job);
    setImmediate(async () => {
      try {
        job.result = runIngestion(db, { dryRun: b.dry_run, force: b.force, only: b.datasets, onProgress: (p) => job.progress.push({ dataset: p.dataset, phase: p.phase, index: p.index, total: p.total }) });
        if (b.include_corpus && !b.dry_run) { job.progress.push({ dataset: 'corpus', phase: 'start', index: 0, total: 1 }); await ingestCorpus(db); job.progress.push({ dataset: 'corpus', phase: 'done', index: 1, total: 1 }); }
        job.status = 'COMPLETED';
      } catch (e) { job.status = 'FAILED'; job.error = (e as Error).message; }
    });
    res.status(202).json({ job_id: job.id });
  });
  r.get('/jobs/:id', (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
    res.json(j);
  });
  r.get('/ingestion/batches', (_req, res) => {
    res.json({ items: all<Record<string, unknown>>(db, 'SELECT * FROM ingestion_batches ORDER BY id DESC LIMIT 100').map((x) => jsonRow(x, ['warnings_json'])) });
  });
  r.get('/ingestion/batches/:id', (req, res) => {
    const b = get<Record<string, unknown>>(db, 'SELECT * FROM ingestion_batches WHERE id = ?', req.params.id);
    if (!b) throw new HttpError(404, 'NOT_FOUND', 'Batch not found');
    const rows = all<Record<string, unknown>>(db, "SELECT id, row_number, status, reason_code, detail, raw_json FROM source_rows WHERE batch_id = ? AND status != 'IMPORTED' ORDER BY row_number LIMIT 200", b.id);
    res.json({ batch: jsonRow(b, ['warnings_json']), non_imported_rows: rows.map((x) => jsonRow(x, ['raw_json'])) });
  });

  r.get('/audit', (req, res) => {
    const q = parse(z.object({ q: z.string().optional(), action: z.string().optional(), page: z.coerce.number().optional(), size: z.coerce.number().optional() }), req.query);
    const where: string[] = []; const p: unknown[] = [];
    if (q.q) { where.push('(actor LIKE ? OR entity LIKE ? OR entity_id LIKE ? OR detail_json LIKE ?)'); p.push(...Array(4).fill(`%${q.q}%`)); }
    if (q.action) { where.push('action = ?'); p.push(q.action); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pg = paginate(q.page, q.size);
    res.json({ total: get<{ n: number }>(db, `SELECT COUNT(*) n FROM audit_log ${w}`, ...p)!.n, page: pg.page, size: pg.size, actions: all(db, 'SELECT DISTINCT action FROM audit_log ORDER BY action'),
      items: all<Record<string, unknown>>(db, `SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, pg.size, pg.offset).map((x) => jsonRow(x, ['detail_json'])) });
  });

  r.get('/data-quality', (_req, res) => {
    const n = (sql: string, ...p: unknown[]) => get<{ n: number }>(db, sql, ...p)!.n;
    const cols = ['manufacturer', 'ingredient_2', 'ingredient_3'];
    const raw = all<{ raw_json: string }>(db, "SELECT raw_json FROM source_rows WHERE dataset='cdci' AND status='IMPORTED'").map((x) => JSON.parse(x.raw_json) as Record<string, string>);
    const blanks = Object.fromEntries(Object.keys(raw[0] ?? {}).filter((k) => !k.startsWith('__')).map((k) => [k, raw.filter((x) => !String(x[k] ?? '').trim()).length]));
    const spread = all<{ ingredient_norm: string; mn: number; mx: number; distinct_strengths: number; products: number }>(db, 'SELECT ingredient_norm, MIN(strength_value) mn, MAX(strength_value) mx, COUNT(DISTINCT strength_value) distinct_strengths, COUNT(*) products FROM product_ingredients GROUP BY ingredient_norm ORDER BY (MAX(strength_value)/MIN(strength_value)) DESC').map((x) => ({ ...x, ratio: x.mx / x.mn, flag: x.mx / x.mn > 50 ? 'WIDE_STRENGTH_SPREAD' : null }));
    const asOfMonth = today().slice(0, 7);
    res.json({
      cdci: { rows: raw.length, blank_values_by_column: blanks, brand_name_collisions: n("SELECT COUNT(*) n FROM review_queue WHERE item_type='BRAND_COLLISION'"), products_in_collision: n('SELECT COUNT(*) n FROM drug_products WHERE brand_norm IN (SELECT brand_norm FROM drug_products GROUP BY brand_norm HAVING COUNT(*)>1)'), unit_suspect_products: n("SELECT COUNT(*) n FROM drug_products WHERE anomaly_flags LIKE '%UNIT_SUSPECT%'"), all_units_mg: n("SELECT COUNT(*) n FROM product_ingredients WHERE strength_unit != 'mg'") === 0, decomposition_discrepancies: n("SELECT COUNT(*) n FROM drug_products WHERE anomaly_flags LIKE '%DECOMPOSITION_DISCREPANCY%'") },
      strength_spread: spread.filter((x) => x.flag).slice(0, 20), strength_spread_note: 'Strength ratio max/min above 50 within one ingredient is flagged for review. It is a statistical flag, not a clinical judgement.',
      stock: { rows: n('SELECT COUNT(*) n FROM stock_items'), distinct_billed_names: n('SELECT COUNT(DISTINCT item_name_as_billed) n FROM stock_items'), expired_before_as_of: n('SELECT COUNT(*) n FROM stock_items WHERE expiry < ?', asOfMonth), non_latin_script: n("SELECT COUNT(*) n FROM review_queue WHERE reason_codes_json LIKE '%NON_LATIN_SCRIPT%'"), mapped: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='MAPPED'"), queued: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='QUEUED'"), unmapped: n("SELECT COUNT(*) n FROM stock_items WHERE mapping_status='UNMAPPED'"), by_method: all(db, 'SELECT mapping_method, COUNT(*) n FROM stock_items GROUP BY mapping_method') },
      reference: { nlem_rows: n('SELECT COUNT(*) n FROM nlem_entries'), nlem_without_category: n('SELECT COUNT(*) n FROM nlem_entries WHERE therapeutic_category IS NULL'), nlem_not_in_master: n("SELECT COUNT(*) n FROM review_queue WHERE item_type='REFERENCE_NAME' AND dedupe_key LIKE 'nlem:%'"), ja_rows: n('SELECT COUNT(*) n FROM jan_aushadhi_entries'), interaction_terms_not_in_master: n("SELECT COUNT(*) n FROM review_queue WHERE item_type='INTERACTION_TERM'") },
      seed_prescriptions: { lines: n('SELECT COUNT(*) n FROM seed_prescriptions'), prescriptions: n('SELECT COUNT(DISTINCT rx_id) n FROM seed_prescriptions'), brief_states_18_lines: true },
      batch_warnings: all<{ dataset: string; warnings_json: string }>(db, "SELECT dataset, warnings_json FROM ingestion_batches WHERE mode='COMMIT' AND status='COMPLETED' ORDER BY id DESC").filter((x, i, a) => a.findIndex((y) => y.dataset === x.dataset) === i).map((x) => ({ dataset: x.dataset, warnings: JSON.parse(x.warnings_json) })),
      unused: cols,
    });
  });

  r.get('/search', (req, res) => {
    const { q } = parse(z.object({ q: z.string().min(2) }), req.query);
    const like = `%${q}%`;
    res.json({
      q,
      drugs: all(db, 'SELECT product_id, brand_name, dose_form, strength_text, is_fdc FROM drug_products WHERE brand_name LIKE ? OR strength_text LIKE ? OR product_id LIKE ? ORDER BY brand_name LIMIT 8', like, like, like),
      regulatory: all(db, 'SELECT event_id, notification_id, action, effective_date, target_description FROM regulatory_events WHERE notification_id LIKE ? OR target_description LIKE ? OR event_id LIKE ? LIMIT 8', like, like, like),
      evidence: all(db, 'SELECT c.id chunk_id, d.doc_code, d.version, d.status, c.anchor, c.text FROM corpus_chunks c JOIN corpus_documents d ON d.id = c.doc_id WHERE c.text LIKE ? OR d.title LIKE ? LIMIT 8', like, like),
      review: all(db, 'SELECT id, item_type, status, input_text FROM review_queue WHERE input_text LIKE ? LIMIT 5', like),
    });
  });

  r.get('/provenance/:kind/:id', (req, res) => {
    const { kind, id } = req.params;
    let srcRowId: number | null;
    if (kind === 'product') srcRowId = get<{ source_row_id: number }>(db, 'SELECT source_row_id FROM drug_products WHERE product_id = ?', id)?.source_row_id ?? null;
    else if (kind === 'event') srcRowId = get<{ source_row_id: number }>(db, 'SELECT source_row_id FROM regulatory_events WHERE event_id = ?', id)?.source_row_id ?? null;
    else if (kind === 'stock') srcRowId = get<{ source_row_id: number }>(db, 'SELECT source_row_id FROM stock_items WHERE id = ?', id)?.source_row_id ?? null;
    else throw new HttpError(400, 'BAD_KIND', 'kind must be product, event or stock');
    if (!srcRowId) throw new HttpError(404, 'NOT_FOUND', 'No provenance found');
    const row = get<Record<string, unknown>>(db, 'SELECT * FROM source_rows WHERE id = ?', srcRowId)!;
    const batch = get<Record<string, unknown>>(db, 'SELECT * FROM ingestion_batches WHERE id = ?', row.batch_id)!;
    const dv = get(db, 'SELECT * FROM dataset_versions WHERE dataset = ?', row.dataset);
    res.json({ chain: ['derived record', 'source row', 'ingestion batch', 'source file + SHA-256', 'dataset version'], source_row: jsonRow(row, ['raw_json']), batch: jsonRow(batch, ['warnings_json']), dataset_version: dv });
  });

  // ---------- optional Anthropic key (entered in the UI, stored encrypted, never returned) ----------
  const llmStatus = () => { const l = getLlmSettings(db); return { configured: !!l.apiKey, masked: l.apiKey ? maskKey(l.apiKey) : null, model: l.model, default_model: DEFAULT_MODEL, source: l.source, updated_at: l.updated_at }; };
  r.get('/settings/llm', (_req, res) => void res.json(llmStatus()));
  r.put('/settings/llm', (req, res) => {
    const b = parse(z.object({ api_key: z.string().trim().min(20, 'That does not look like an Anthropic API key').max(300).regex(/^sk-ant-/, 'Anthropic keys start with sk-ant-').optional(), model: z.string().trim().min(3).max(100).optional() }), req.body);
    if (!b.api_key && !b.model) throw new HttpError(400, 'NOTHING_TO_SAVE', 'Provide an API key, a model, or both');
    if (b.api_key) setSetting(db, 'llm.api_key', b.api_key, true);
    if (b.model) setSetting(db, 'llm.model', b.model);
    writeAudit(db, 'user', 'LLM_SETTINGS_SAVED', 'settings', 'llm', { key_changed: !!b.api_key, model: b.model ?? null });
    res.json(llmStatus());
  });
  r.delete('/settings/llm', (_req, res) => {
    deleteSetting(db, 'llm.api_key');
    writeAudit(db, 'user', 'LLM_KEY_REMOVED', 'settings', 'llm', {});
    res.json(llmStatus());
  });
  r.post('/settings/llm/test', async (req, res) => {
    const b = parse(z.object({ api_key: z.string().trim().optional(), model: z.string().trim().optional() }), req.body ?? {});
    const l = getLlmSettings(db);
    const key = b.api_key || l.apiKey;
    if (!key) throw new HttpError(400, 'NO_KEY', 'No API key is saved yet. Paste a key and save it, or enter one to test.');
    res.json(await testAnthropicKey(key, b.model || l.model));
  });

  r.get('/settings', (_req, res) => {
    res.json({
      versions: config.versions, datasets: config.datasets, freshness_policy_note: 'Freshness limits are placeholders pending the product owner policy (see GAPS_REGISTER).', demo: config.demo,
      safety: { countable_dose_forms: config.safety.countableDoseForms, unit_suspect_ingredients: config.safety.unitSuspectIngredients, reference_ceilings: config.safety.referenceCeilings, interaction_coverage_scope: config.safety.interactionCoverageScope },
      retrieval: { topK: config.retrieval.topK, weights: config.retrieval.weights, docPriorWeight: config.retrieval.docPriorWeight, minDocSupport: config.retrieval.minDocSupport },
      llm: (() => { const l = getLlmSettings(db); return { enabled: !!l.apiKey, provider: 'anthropic', model: l.apiKey ? l.model : null, source: l.source, scope: 'Module B composition only. Never imported by the safety rail.' }; })(),
      prompts: listPrompts(), node: process.version, db_path: config.paths.db,
    });
  });
  return r;
}
