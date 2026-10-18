import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Db } from '../db/connection.js';
import { run, get } from '../db/connection.js';
import { config } from '../config.js';
import { nowIso, sha256 } from '../util/text.js';

export interface Counters {
  total: number; imported: number; rejected: number; duplicate: number; unresolved: number; queue: number;
}
export interface Batch {
  id: number;
  dataset: string;
  db: Db;
  counters: Counters;
  warnings: string[];
  seenHashes: Map<string, number>;
}

export interface RawFile {
  fileName: string;
  fullPath: string;
  text: string;
  sha256: string;
}

export function readInput(fileName: string, dir = config.paths.inputData): RawFile {
  const fullPath = path.join(dir, fileName);
  const buf = fs.readFileSync(fullPath);
  return { fileName, fullPath, text: buf.toString('utf8').replace(/^\uFEFF/, ''), sha256: sha256(buf) };
}

export interface ParsedCsv {
  header: string[];
  rows: { rowNumber: number; cells: string[]; record: Record<string, string> }[];
}

/** Parses to raw cell arrays so malformed column counts are detectable instead of silently padded. */
export function parseCsv(text: string): ParsedCsv {
  const records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, info: true, trim: false }) as unknown as {
    record: string[];
    info: { lines: number };
  }[];
  const header = (records[0]?.record ?? []).map((h) => h.trim());
  const rows = records.slice(1).map((r) => ({
    rowNumber: r.info.lines,
    cells: r.record,
    record: Object.fromEntries(header.map((h, i) => [h, (r.record[i] ?? '').trim()])) as Record<string, string>,
  }));
  return { header, rows };
}

export function startBatch(
  db: Db,
  dataset: string,
  file: RawFile,
  opts: { dryRun: boolean; sourceVersion?: string | null; sourceDate?: string | null },
): Batch {
  const r = run(
    db,
    `INSERT INTO ingestion_batches (dataset, source_file, source_sha256, source_version, source_date, pipeline_version, mode, status, started_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    dataset, file.fileName, file.sha256, opts.sourceVersion ?? null, opts.sourceDate ?? null,
    config.versions.ingestionPipeline, opts.dryRun ? 'DRY_RUN' : 'COMMIT', 'RUNNING', nowIso(),
  );
  return {
    id: Number(r.lastInsertRowid), dataset, db,
    counters: { total: 0, imported: 0, rejected: 0, duplicate: 0, unresolved: 0, queue: 0 },
    warnings: [], seenHashes: new Map(),
  };
}

/** Persist the verbatim source row and its disposition. Returns source_rows.id for provenance links. */
export function recordRow(
  b: Batch, rowNumber: number, raw: unknown, status: 'IMPORTED' | 'REJECTED' | 'DUPLICATE', reason?: string, detail?: string,
): number {
  const json = JSON.stringify(raw);
  const r = run(
    b.db,
    `INSERT INTO source_rows (batch_id, dataset, row_number, raw_json, row_hash, status, reason_code, detail) VALUES (?,?,?,?,?,?,?,?)`,
    b.id, b.dataset, rowNumber, json, sha256(json), status, reason ?? null, detail ?? null,
  );
  b.counters.total++;
  if (status === 'IMPORTED') b.counters.imported++;
  else if (status === 'REJECTED') b.counters.rejected++;
  else b.counters.duplicate++;
  return Number(r.lastInsertRowid);
}

export function finishBatch(
  b: Batch, status: 'COMPLETED' | 'FAILED' | 'SKIPPED_UNCHANGED', extra: { error?: string; version?: string | null; date?: string | null } = {},
) {
  run(
    b.db,
    `UPDATE ingestion_batches SET status=?, finished_at=?, rows_total=?, rows_imported=?, rows_rejected=?, rows_duplicate=?, rows_unresolved=?,
       queue_items_created=?, warnings_json=?, error=?, source_version=COALESCE(?, source_version), source_date=COALESCE(?, source_date) WHERE id=?`,
    status, nowIso(), b.counters.total, b.counters.imported, b.counters.rejected, b.counters.duplicate, b.counters.unresolved,
    b.counters.queue, JSON.stringify(b.warnings), extra.error ?? null, extra.version ?? null, extra.date ?? null, b.id,
  );
}

export interface QueueInput {
  item_type: string;
  dedupe_key: string;
  input_text: string;
  context?: unknown;
  candidates?: unknown[];
  reason_codes: string[];
  confidence?: number | null;
  method: string;
  source_dataset?: string;
  source_row_id?: number | null;
  batch_id?: number | null;
}

/** Idempotent enqueue. Returns the queue id and whether a new item was created. */
export function enqueue(db: Db, q: QueueInput): { id: number; created: boolean } {
  const existing = get<{ id: number }>(db, 'SELECT id FROM review_queue WHERE dedupe_key = ?', q.dedupe_key);
  if (existing) return { id: existing.id, created: false };
  const at = nowIso();
  const r = run(
    db,
    `INSERT INTO review_queue (item_type, dedupe_key, input_text, context_json, candidates_json, reason_codes_json, confidence, method,
       status, source_dataset, source_row_id, batch_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, 'OPEN', ?,?,?,?,?)`,
    q.item_type, q.dedupe_key, q.input_text, JSON.stringify(q.context ?? {}), JSON.stringify(q.candidates ?? []),
    JSON.stringify(q.reason_codes), q.confidence ?? null, q.method, q.source_dataset ?? null, q.source_row_id ?? null, q.batch_id ?? null, at, at,
  );
  return { id: Number(r.lastInsertRowid), created: true };
}

export function checkHeader(b: Batch, header: string[], required: string[]): boolean {
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    b.warnings.push(`HEADER_MISSING: ${missing.join(', ')}`);
    return false;
  }
  const extra = header.filter((c) => !required.includes(c));
  if (extra.length) b.warnings.push(`UNEXPECTED_COLUMNS: ${extra.join(', ')} (preserved in raw row, not interpreted)`);
  return true;
}

export function upsertDatasetVersion(
  db: Db, dataset: string, b: Batch, file: RawFile,
  v: { label: string | null; sourceDate: string | null; basis: 'DECLARED_SOURCE_DATE' | 'LOAD_TIME_ONLY'; maxAgeDays: number },
) {
  run(
    db,
    `INSERT INTO dataset_versions (dataset, batch_id, version_label, source_date, freshness_basis, loaded_at, row_count, max_age_days, source_sha256)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(dataset) DO UPDATE SET batch_id=excluded.batch_id, version_label=excluded.version_label, source_date=excluded.source_date,
       freshness_basis=excluded.freshness_basis, loaded_at=excluded.loaded_at, row_count=excluded.row_count, max_age_days=excluded.max_age_days,
       source_sha256=excluded.source_sha256`,
    dataset, b.id, v.label, v.sourceDate, v.basis, nowIso(), b.counters.imported, v.maxAgeDays, file.sha256,
  );
}
