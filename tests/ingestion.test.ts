import { describe, expect, it } from 'vitest';
import { all, get } from '../server/src/db/connection.js';
import { runIngestion } from '../server/src/ingest/pipeline.js';
import { startBatch, type RawFile } from '../server/src/ingest/common.js';
import { importCdci, parseStrengthText } from '../server/src/ingest/cdci.js';
import { parseStockName } from '../server/src/ingest/stock.js';
import { freshDb } from './helpers.js';
import { sha256 } from '../server/src/util/text.js';

describe('ingestion pipeline', () => {
  it('loads every dataset with row-level provenance and counts that reconcile', async () => {
    const db = await freshDb();
    const batches = all<{ dataset: string; rows_total: number; rows_imported: number; rows_rejected: number; rows_duplicate: number }>(db, "SELECT * FROM ingestion_batches WHERE mode='COMMIT'");
    expect(batches.map((b) => b.dataset).sort()).toEqual(['cdci', 'interactions', 'janAushadhi', 'nlem', 'regulatory', 'seedRx', 'stock']);
    for (const b of batches) expect(b.rows_imported + b.rows_rejected + b.rows_duplicate).toBe(b.rows_total);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products WHERE source_row_id IS NULL OR batch_id IS NULL')!.n).toBe(0);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM product_ingredients WHERE source_row_id IS NULL')!.n).toBe(0);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM regulatory_events WHERE source_row_id IS NULL')!.n).toBe(0);
  });
  it('preserves the original source row verbatim', async () => {
    const db = await freshDb();
    const p = get<{ raw_json: string }>(db, "SELECT s.raw_json FROM source_rows s JOIN drug_products p ON p.source_row_id = s.id WHERE p.product_id = 'CD1000'")!;
    expect(JSON.parse(p.raw_json)).toHaveProperty('brand_name');
  });
  it('is idempotent: a second run skips unchanged files and creates no duplicate rows', async () => {
    const db = await freshDb();
    const before = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products')!.n;
    const rep = runIngestion(db);
    expect(rep.datasets.every((d) => d.status === 'SKIPPED_UNCHANGED')).toBe(true);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products')!.n).toBe(before);
    const forced = runIngestion(db, { force: true });
    expect(forced.datasets.every((d) => d.status === 'COMPLETED')).toBe(true);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products')!.n).toBe(before);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM review_queue')!.n).toBeGreaterThan(0);
  });
  it('dry-run reports results and writes nothing', async () => {
    const db = await freshDb({ ingest: false });
    const rep = runIngestion(db, { dryRun: true });
    expect(rep.datasets.length).toBe(7);
    expect(rep.datasets.find((d) => d.dataset === 'cdci')!.imported).toBeGreaterThan(1000);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM drug_products')!.n).toBe(0);
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM ingestion_batches')!.n).toBe(0);
  });
  it('rejects malformed and duplicate rows with reason codes instead of dropping them silently', async () => {
    const db = await freshDb({ ingest: false });
    const csv = [
      'product_id,brand_name,manufacturer,dose_form,strength_text,source,source_version,effective_from,ingredient_1,strength_1_mg,ingredient_2,strength_2_mg,ingredient_3,strength_3_mg',
      'CD1,Alpha,M,Tablet,Paracetamol 500 mg,S,2026-06-30,2026-07-01,Paracetamol,500,,,,',
      'CD1,Alpha,M,Tablet,Paracetamol 500 mg,S,2026-06-30,2026-07-01,Paracetamol,500,,,,',
      'CDX,Bad,M,Tablet,Paracetamol 500 mg,S,2026-06-30,2026-07-01,Paracetamol,500,,,,',
      'CD3,Short,M,Tablet',
      'CD4,Mismatch,M,Tablet,Paracetamol 650 mg,S,2026-06-30,2026-07-01,Paracetamol,500,,,,',
    ].join('\n');
    const file: RawFile = { fileName: 'x.csv', fullPath: 'x.csv', text: csv, sha256: sha256(csv) };
    const b = startBatch(db, 'cdci', file, { dryRun: false });
    importCdci(b, file);
    expect(b.counters).toMatchObject({ total: 5, imported: 2, rejected: 2, duplicate: 1 });
    const reasons = all<{ reason_code: string }>(db, "SELECT reason_code FROM source_rows WHERE status != 'IMPORTED' ORDER BY id").map((r) => r.reason_code);
    expect(reasons).toEqual(['DUPLICATE_PRODUCT_ID', 'BAD_PRODUCT_ID', 'MALFORMED_COLUMN_COUNT']);
    expect(get<{ verification_status: string }>(db, "SELECT verification_status FROM product_ingredients WHERE product_id='CD4'")!.verification_status).toBe('DISCREPANCY');
    expect(get<{ n: number }>(db, "SELECT COUNT(*) n FROM review_queue WHERE item_type='FDC_DECOMPOSITION'")!.n).toBe(1);
  });
  it('queues every brand-name collision with reason codes (G3)', async () => {
    const db = await freshDb();
    const coll = get<{ n: number }>(db, "SELECT COUNT(*) n FROM review_queue WHERE item_type='BRAND_COLLISION'")!.n;
    const groups = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT brand_norm FROM drug_products GROUP BY brand_norm HAVING COUNT(*) > 1)')!.n;
    expect(coll).toBe(groups);
    expect(get<{ n: number }>(db, "SELECT COUNT(*) n FROM review_queue WHERE reason_codes_json IS NULL OR reason_codes_json = '[]'")!.n).toBe(0);
    expect(get<{ n: number }>(db, "SELECT COUNT(*) n FROM stock_items WHERE mapping_status NOT IN ('MAPPED','QUEUED','UNMAPPED')")!.n).toBe(0);
    expect(get<{ n: number }>(db, "SELECT COUNT(DISTINCT parsed_brand_norm) n FROM stock_items WHERE mapping_status != 'MAPPED'")!.n).toBeGreaterThan(0);
  });
  it('FDC decomposition: structured columns and strength_text are parsed independently', () => {
    expect(parseStrengthText('Amoxicillin 500 mg + Clavulanic Acid 125 mg')).toEqual([{ name: 'Amoxicillin', value: 500, unit: 'mg' }, { name: 'Clavulanic Acid', value: 125, unit: 'mg' }]);
    expect(parseStrengthText('garbled')).toBeNull();
  });
  it('stock billing noise is stripped deterministically', () => {
    expect(parseStockName("MIVIN-FORTE TAB 15'S")).toMatchObject({ brandNorm: 'mivin forte', formHint: 'Tablet' });
    expect(parseStockName('KOFEN-2-DUO 100ML SYP')).toMatchObject({ formHint: 'Syrup' });
  });
});
