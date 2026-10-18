import type { Db } from '../db/connection.js';
import { all, get, run, tx } from '../db/connection.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { nowIso } from '../util/text.js';
import { finishBatch, readInput, startBatch, type Batch, type RawFile } from './common.js';
import { importCdci } from './cdci.js';
import { importNlem, importJanAushadhi } from './reference.js';
import { importRegulatory } from './regulatory.js';
import { importInteractions } from './interactions.js';
import { importStock } from './stock.js';
import { importSeedRx } from './seedrx.js';
import { writeAudit } from '../audit.js';

type Importer = (b: Batch, f: RawFile) => void;
/** Order matters: the drug master must exist before reference/stock/interaction cross-checks. */
export const DATASET_ORDER: { key: string; cfg: { file: string }; run: Importer; tables: string[] }[] = [
  { key: 'cdci', cfg: config.datasets.cdci, run: importCdci, tables: [] },
  { key: 'nlem', cfg: config.datasets.nlem, run: importNlem, tables: ['nlem_entries'] },
  { key: 'janAushadhi', cfg: config.datasets.janAushadhi, run: importJanAushadhi, tables: ['jan_aushadhi_entries'] },
  { key: 'regulatory', cfg: config.datasets.regulatory, run: importRegulatory, tables: ['regulatory_events'] },
  { key: 'interactions', cfg: config.datasets.interactions, run: importInteractions, tables: ['interaction_pairs'] },
  { key: 'stock', cfg: config.datasets.stock, run: importStock, tables: ['stock_items'] },
  { key: 'seedRx', cfg: config.datasets.seedRx, run: importSeedRx, tables: ['seed_prescriptions'] },
];

export interface DatasetReport {
  dataset: string; file: string; sha256: string; batch_id: number | null; mode: 'COMMIT' | 'DRY_RUN';
  status: string; rows_total: number; imported: number; rejected: number; duplicate: number; unresolved: number;
  queue_items_created: number; warnings: string[]; ms: number;
}
export interface IngestionReport { dry_run: boolean; started_at: string; datasets: DatasetReport[]; pipeline_version: string }

export interface IngestOptions {
  dryRun?: boolean; force?: boolean; only?: string[];
  onProgress?: (p: { dataset: string; index: number; total: number; phase: 'start' | 'done'; report?: DatasetReport }) => void;
}

/**
 * Reproducible, idempotent ingestion. Unchanged files (same SHA-256 as the last committed batch) are skipped
 * unless forced. Dry-run executes the full pipeline inside a transaction that is rolled back.
 */
export function runIngestion(db: Db, opts: IngestOptions = {}): IngestionReport {
  const dryRun = !!opts.dryRun;
  const started = nowIso();
  const reports: DatasetReport[] = [];
  const list = DATASET_ORDER.filter((d) => !opts.only || opts.only.includes(d.key));
  const body = () => {
    list.forEach((d, i) => {
      opts.onProgress?.({ dataset: d.key, index: i, total: list.length, phase: 'start' });
      const t0 = Date.now();
      const file = readInput(d.cfg.file);
      const last = get<{ id: number }>(db, "SELECT id FROM ingestion_batches WHERE dataset=? AND mode='COMMIT' AND status='COMPLETED' AND source_sha256=? ORDER BY id DESC LIMIT 1", d.key, file.sha256);
      const b = startBatch(db, d.key, file, { dryRun });
      let rep: DatasetReport;
      if (last && !opts.force && !dryRun) {
        finishBatch(b, 'SKIPPED_UNCHANGED');
        rep = { dataset: d.key, file: file.fileName, sha256: file.sha256, batch_id: b.id, mode: 'COMMIT', status: 'SKIPPED_UNCHANGED', rows_total: 0, imported: 0, rejected: 0, duplicate: 0, unresolved: 0, queue_items_created: 0, warnings: [`Unchanged since batch ${last.id}`], ms: Date.now() - t0 };
      } else {
        if (!dryRun || d.key) for (const t of d.tables) run(db, `DELETE FROM ${t}`);
        try {
          d.run(b, file);
          finishBatch(b, 'COMPLETED');
        } catch (e) {
          finishBatch(b, 'FAILED', { error: (e as Error).message });
          throw e;
        }
        rep = { dataset: d.key, file: file.fileName, sha256: file.sha256, batch_id: b.id, mode: dryRun ? 'DRY_RUN' : 'COMMIT', status: 'COMPLETED', rows_total: b.counters.total, imported: b.counters.imported, rejected: b.counters.rejected, duplicate: b.counters.duplicate, unresolved: b.counters.unresolved, queue_items_created: b.counters.queue, warnings: b.warnings, ms: Date.now() - t0 };
      }
      reports.push(rep);
      opts.onProgress?.({ dataset: d.key, index: i + 1, total: list.length, phase: 'done', report: rep });
    });
  };
  if (dryRun) {
    // Capture reports, then roll back every write (including the batch rows themselves).
    tx(db, body, { rollback: true });
  } else {
    tx(db, body);
    writeAudit(db, 'system', 'INGESTION_RUN', 'ingestion', null, { datasets: reports.map((r) => ({ d: r.dataset, status: r.status, batch: r.batch_id })) });
  }
  log.info('ingestion finished', { dryRun, datasets: reports.map((r) => `${r.dataset}:${r.status}`) });
  void all;
  return { dry_run: dryRun, started_at: started, datasets: reports, pipeline_version: config.versions.ingestionPipeline };
}
