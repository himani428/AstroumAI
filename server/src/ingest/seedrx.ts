import { run } from '../db/connection.js';
import { config } from '../config.js';
import { checkHeader, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

export function importSeedRx(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, ['rx_id', 'item_no', 'written_product', 'strength_as_written', 'dose_frequency', 'clinical_note', 'candidate_rail_output_state', 'candidate_evidence_note'])) return;
  for (const row of rows) {
    const r = row.record;
    if (row.cells.length !== header.length || !r.rx_id || !Number.isInteger(Number(r.item_no)) || !r.written_product) {
      recordRow(b, row.rowNumber, r, 'REJECTED', 'BAD_ROW');
      continue;
    }
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    run(b.db, `INSERT INTO seed_prescriptions (rx_id, item_no, written_product, strength_as_written, dose_frequency, clinical_note, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?)`,
      r.rx_id, Number(r.item_no), r.written_product, r.strength_as_written || null, r.dose_frequency || null, r.clinical_note || null, b.id, src);
  }
  upsertDatasetVersion(b.db, 'seedRx', b, file, { label: '10 draft prescriptions', sourceDate: null, basis: 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.seedRx.maxAgeDays });
}
