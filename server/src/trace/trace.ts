import type { Db } from '../db/connection.js';
import { all, get, run } from '../db/connection.js';
import { config } from '../config.js';
import { CorpusIndex } from '../corpus/retrieval.js';
import { answerQuestion } from '../qa/answer.js';
import { listPrompts } from '../prompts.js';
import { normalizePrescription } from '../master/normalizeRx.js';
import { SqliteRailData } from '../safety/provider.js';
import { runSafetyRail } from '../safety/engine.js';
import type { RxLineInput } from '../safety/types.js';
import { nowIso } from '../util/text.js';
import { todayIso } from '../safety/service.js';
import { randomUUID } from 'node:crypto';

export interface TraceInput { prescription: RxLineInput[]; question: string; as_of?: string }

/** Module C: one reproducible JSON trace across normalization, safety rail and grounded Q&A. */
export function buildTrace(db: Db, input: TraceInput, opts: { persist?: boolean; origin?: string } = {}) {
  const t0 = Date.now();
  const errors: { stage: string; message: string }[] = [];
  const timings: Record<string, number> = {};
  const asOf = input.as_of ?? todayIso();
  const time = <T>(stage: string, fn: () => T, fallback: T): T => {
    const s = Date.now();
    try { return fn(); } catch (e) { errors.push({ stage, message: (e as Error).message }); return fallback; } finally { timings[stage] = Date.now() - s; }
  };
  const resolved = time('normalization', () => normalizePrescription(db, input.prescription), []);
  const rail = time('safety_rail', () => runSafetyRail(resolved, new SqliteRailData(db), { asOf, now: new Date() }), null);
  const index = time('index_build', () => CorpusIndex.build(db), null);
  const qa = time('grounded_qa', () => (index ? answerQuestion({ db, index, asOf }, input.question) : null), null);
  const datasets = all<Record<string, unknown>>(db, 'SELECT dataset, version_label, source_date, freshness_basis, loaded_at, batch_id, source_sha256, row_count FROM dataset_versions ORDER BY dataset');
  const corpus = all<Record<string, unknown>>(db, 'SELECT doc_code, version, status, effective_date, file_name, file_sha256 FROM corpus_documents ORDER BY doc_code, version');
  const unresolved = resolved.filter((l) => l.resolution.status !== 'RESOLVED').map((l) => ({
    line_no: l.line_no, written_product: l.input.written_product, status: l.resolution.status, reason_codes: l.resolution.reason_codes, candidates: l.resolution.candidates, review_queue_id: l.resolution.queue_id ?? null,
  }));
  const trace = {
    trace_type: 'BRAHMO_E2E_TRACE',
    trace_id: randomUUID(),
    trace_schema_version: config.versions.traceSchema,
    generated_at: nowIso(),
    as_of: asOf,
    input: { prescription: input.prescription, question: input.question },
    stages: {
      '1_normalization': { version: config.versions.normalizer, lines: resolved.map((l) => ({ line_no: l.line_no, written_product: l.input.written_product, strength_as_written: l.input.strength_as_written ?? null, resolution: l.resolution, product: l.product ? { product_id: l.product.product_id, brand_name: l.product.brand_name, dose_form: l.product.dose_form, strength_text: l.product.strength_text, ingredients: l.product.ingredients.map((i) => ({ name: i.name, value: i.value, unit: i.unit })), provenance: { source: l.product.source, source_version: l.product.source_version, batch_id: l.product.batch_id, source_row_id: l.product.source_row_id } } : null })), unresolved_mappings: unresolved },
      '2_safety_rail': rail ? { rule_version: rail.rule_version, llm_used_in_safety_path: false as const, report: rail } : { error: 'safety rail did not run' },
      '3_grounded_answer': qa ?? { error: 'grounded answering did not run' },
    },
    conflicting_evidence: qa?.conflicts ?? [],
    versions: {
      datasets, data_fingerprint: rail?.data_version ?? null, corpus_documents: corpus,
      rules: { safety_rail: config.versions.safetyRules, regulatory_derivation: config.versions.regulatoryDerivation },
      prompts: listPrompts(),
      pipeline: { normalizer: config.versions.normalizer, chunker: config.versions.chunker, retrieval: config.versions.retrieval, answerer: config.versions.answerer },
      models: { safety_rail: 'none (deterministic lookup; no model in this path)', grounded_answer: qa?.composer ?? null },
    },
    retrieval_metadata: qa?.retrieval ?? null,
    execution: { duration_ms: Date.now() - t0, stage_ms: timings, errors, node: process.version },
  };
  if (opts.persist !== false) run(db, 'INSERT INTO trace_runs (created_at, origin, trace_json) VALUES (?,?,?)', trace.generated_at, opts.origin ?? 'USER', JSON.stringify(trace));
  void get;
  return trace;
}
