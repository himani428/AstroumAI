import { all, run } from '../db/connection.js';
import { config } from '../config.js';
import { normIngredient } from '../util/text.js';
import { ProductIndex } from '../master/index.js';
import { checkHeader, enqueue, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

function ingredientKnown(idx: ProductIndex, name: string): boolean {
  const parts = name.split('+').map((p) => normIngredient(p));
  return parts.every((p) => idx.ingredientVocab.has(p));
}

export function importNlem(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, ['medicine', 'therapeutic_category', 'care_levels', 'nlem_edition'])) return;
  const idx = ProductIndex.build(b.db);
  const seen = new Map<string, number>();
  let edition: string | null = null;
  for (const row of rows) {
    const r = row.record;
    if (row.cells.length !== header.length || !r.medicine) {
      recordRow(b, row.rowNumber, r, 'REJECTED', row.cells.length !== header.length ? 'MALFORMED_COLUMN_COUNT' : 'MISSING_MEDICINE');
      continue;
    }
    const key = normIngredient(r.medicine!);
    if (seen.has(key)) { recordRow(b, row.rowNumber, r, 'DUPLICATE', 'DUPLICATE_MEDICINE', `first on row ${seen.get(key)}`); continue; }
    seen.set(key, row.rowNumber);
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    edition = r.nlem_edition || edition;
    const cat = r.therapeutic_category === '—' || r.therapeutic_category === '' ? null : r.therapeutic_category!;
    run(b.db, `INSERT INTO nlem_entries (medicine, medicine_norm, therapeutic_category, care_levels, nlem_edition, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?)`,
      r.medicine, key, cat, r.care_levels, r.nlem_edition, b.id, src);
    if (!ingredientKnown(idx, r.medicine!)) {
      b.counters.unresolved++;
      const q = enqueue(b.db, { item_type: 'REFERENCE_NAME', dedupe_key: `nlem:${key}`, input_text: `NLEM: ${r.medicine}`, reason_codes: ['NLEM_NAME_NOT_IN_DRUG_MASTER'],
        context: { dataset: 'nlem', note: 'Exact normalised name not present among drug-master ingredients; cross-reference not made.' }, method: 'exact_normalised_name', source_dataset: 'nlem', source_row_id: src, batch_id: b.id });
      if (q.created) b.counters.queue++;
    }
  }
  upsertDatasetVersion(b.db, 'nlem', b, file, { label: edition, sourceDate: null, basis: 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.nlem.maxAgeDays });
  b.warnings.push(`NLEM edition "${edition}" carries no date; freshness measured from load time only.`);
}

export function importJanAushadhi(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, ['generic_name', 'strength', 'pack', 'mrp_inr', 'catalog_version'])) return;
  const idx = ProductIndex.build(b.db);
  const seen = new Map<string, number>();
  let version: string | null = null;
  for (const row of rows) {
    const r = row.record;
    const mrp = Number(r.mrp_inr);
    if (row.cells.length !== header.length || !r.generic_name || Number.isNaN(mrp) || mrp < 0) {
      recordRow(b, row.rowNumber, r, 'REJECTED', row.cells.length !== header.length ? 'MALFORMED_COLUMN_COUNT' : 'BAD_VALUE');
      continue;
    }
    const key = `${normIngredient(r.generic_name!)}|${r.strength}|${r.pack}`;
    if (seen.has(key)) { recordRow(b, row.rowNumber, r, 'DUPLICATE', 'DUPLICATE_ENTRY', `first on row ${seen.get(key)}`); continue; }
    seen.set(key, row.rowNumber);
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    version = r.catalog_version || version;
    run(b.db, `INSERT INTO jan_aushadhi_entries (generic_name, generic_norm, strength, pack, mrp_inr, catalog_version, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?)`,
      r.generic_name, normIngredient(r.generic_name!), r.strength, r.pack, mrp, r.catalog_version, b.id, src);
    if (!ingredientKnown(idx, r.generic_name!)) {
      b.counters.unresolved++;
      const q = enqueue(b.db, { item_type: 'REFERENCE_NAME', dedupe_key: `ja:${normIngredient(r.generic_name!)}`, input_text: `Jan Aushadhi: ${r.generic_name}`, reason_codes: ['JA_NAME_NOT_IN_DRUG_MASTER'], method: 'exact_normalised_name', source_dataset: 'janAushadhi', source_row_id: src, batch_id: b.id });
      if (q.created) b.counters.queue++;
    }
  }
  const m = version?.match(/(\d{4})-(\d{2})$/);
  const date = m ? `${m[1]}-${m[2]}-01` : null;
  if (date) b.warnings.push(`Catalog date derived from version label "${version}" as ${date} (month granularity).`);
  upsertDatasetVersion(b.db, 'janAushadhi', b, file, { label: version, sourceDate: date, basis: date ? 'DECLARED_SOURCE_DATE' : 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.janAushadhi.maxAgeDays });
  void all;
}
