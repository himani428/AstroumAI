import { all, get, run } from '../db/connection.js';
import { config } from '../config.js';
import { normBrand, normIngredient } from '../util/text.js';
import { checkHeader, enqueue, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

const REQUIRED = ['product_id', 'brand_name', 'manufacturer', 'dose_form', 'strength_text', 'source', 'source_version', 'effective_from',
  'ingredient_1', 'strength_1_mg', 'ingredient_2', 'strength_2_mg', 'ingredient_3', 'strength_3_mg'];

interface TextComponent { name: string; value: number; unit: string }

/** Independent second derivation: parse the human-readable strength_text. */
export function parseStrengthText(text: string): TextComponent[] | null {
  const out: TextComponent[] = [];
  for (const part of text.split('+')) {
    const m = part.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)$/i);
    if (!m) return null;
    out.push({ name: m[1]!.trim(), value: Number(m[2]), unit: m[3]!.toLowerCase() });
  }
  return out;
}

export function importCdci(b: Batch, file: RawFile): void {
  const db = b.db;
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, REQUIRED)) return;
  const seenIds = new Map<string, number>();
  const suspect = new Set<string>(config.safety.unitSuspectIngredients);
  const suspectCounts = new Map<string, { name: string; products: string[] }>();
  let sourceVersion: string | null = null;
  let sourceName: string | null = null;

  for (const row of rows) {
    const r = row.record;
    const raw = { ...r, __cells: row.cells.length };
    if (row.cells.length !== header.length) {
      recordRow(b, row.rowNumber, raw, 'REJECTED', 'MALFORMED_COLUMN_COUNT', `expected ${header.length} cells, got ${row.cells.length}`);
      continue;
    }
    const problems: string[] = [];
    if (!/^CD\d+$/.test(r.product_id!)) problems.push('BAD_PRODUCT_ID');
    if (!r.brand_name) problems.push('MISSING_BRAND');
    if (!r.dose_form) problems.push('MISSING_DOSE_FORM');
    if (!r.ingredient_1) problems.push('MISSING_INGREDIENT_1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effective_from!)) problems.push('BAD_EFFECTIVE_DATE');
    const cols: { name: string; value: number }[] = [];
    for (const i of ['1', '2', '3']) {
      const n = r[`ingredient_${i}`]!;
      const s = r[`strength_${i}_mg`]!;
      if (!n && !s) continue;
      if (!n || !s || Number.isNaN(Number(s)) || Number(s) <= 0) problems.push(`BAD_COMPONENT_${i}`);
      else cols.push({ name: n, value: Number(s) });
    }
    if (problems.length) {
      recordRow(b, row.rowNumber, raw, 'REJECTED', problems[0], problems.join(','));
      continue;
    }
    if (seenIds.has(r.product_id!)) {
      recordRow(b, row.rowNumber, raw, 'DUPLICATE', 'DUPLICATE_PRODUCT_ID', `first seen on row ${seenIds.get(r.product_id!)}`);
      continue;
    }
    seenIds.set(r.product_id!, row.rowNumber);
    sourceVersion = r.source_version!;
    sourceName = r.source!;
    const srcRow = recordRow(b, row.rowNumber, raw, 'IMPORTED');

    const text = parseStrengthText(r.strength_text!);
    const flags: string[] = [];
    const agree = !!text && text.length === cols.length &&
      text.every((t, i) => normIngredient(t.name) === normIngredient(cols[i]!.name) && t.value === cols[i]!.value && t.unit === 'mg');
    if (!agree) flags.push('DECOMPOSITION_DISCREPANCY');
    if (cols.some((c) => suspect.has(normIngredient(c.name)))) flags.push('UNIT_SUSPECT');
    const isFdc = cols.length >= 2 ? 1 : 0;

    run(db, `INSERT INTO drug_products (product_id, brand_name, brand_norm, manufacturer, dose_form, strength_text, source, source_version, effective_from,
              is_fdc, ingredient_count, anomaly_flags, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(product_id) DO UPDATE SET brand_name=excluded.brand_name, brand_norm=excluded.brand_norm, manufacturer=excluded.manufacturer,
              dose_form=excluded.dose_form, strength_text=excluded.strength_text, source=excluded.source, source_version=excluded.source_version,
              effective_from=excluded.effective_from, is_fdc=excluded.is_fdc, ingredient_count=excluded.ingredient_count,
              anomaly_flags=excluded.anomaly_flags, batch_id=excluded.batch_id, source_row_id=excluded.source_row_id`,
      r.product_id, r.brand_name, normBrand(r.brand_name!), r.manufacturer || null, r.dose_form, r.strength_text, r.source, r.source_version,
      r.effective_from, isFdc, cols.length, JSON.stringify(flags), b.id, srcRow);
    run(db, 'DELETE FROM product_ingredients WHERE product_id = ?', r.product_id);
    cols.forEach((c, idx) => {
      const isSuspect = suspect.has(normIngredient(c.name));
      run(db, `INSERT INTO product_ingredients (product_id, position, ingredient_name, ingredient_norm, strength_value, strength_unit, strength_unit_note,
                decomposition_method, decomposition_confidence, verification_status, verification_detail, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        r.product_id, idx + 1, c.name, normIngredient(c.name), c.value, 'mg',
        isSuspect ? 'UNIT_SUSPECT: source labels this strength mg; ingredient is normally dosed in mcg/IU. Unit not independently verified.' : null,
        agree ? 'structured_columns+strength_text_crosscheck' : 'structured_columns_only',
        agree ? 0.99 : 0.5,
        agree ? 'CROSS_CHECKED_SAME_SOURCE' : 'DISCREPANCY',
        agree ? 'Structured columns and strength_text agree on name, value and unit. Both derive from one source row; this is NOT independent verification.'
              : 'Structured columns and strength_text disagree or strength_text was not parseable.',
        b.id, srcRow);
      if (isSuspect) {
        const k = normIngredient(c.name);
        const e = suspectCounts.get(k) ?? { name: c.name, products: [] };
        e.products.push(r.product_id!);
        suspectCounts.set(k, e);
      }
    });
    if (!agree) {
      const q = enqueue(db, {
        item_type: 'FDC_DECOMPOSITION', dedupe_key: `fdc:${r.product_id}`, input_text: `${r.brand_name} (${r.strength_text})`,
        context: { product_id: r.product_id, strength_text: r.strength_text, structured: cols },
        reason_codes: ['DECOMPOSITION_DISCREPANCY'], confidence: 0.5, method: 'structured_vs_text_crosscheck',
        source_dataset: 'cdci', source_row_id: srcRow, batch_id: b.id,
      });
      if (q.created) { b.counters.queue++; b.counters.unresolved++; }
    }
  }

  // Unit anomalies: one queue item per ingredient (not per product) to keep the queue reviewable.
  for (const [norm, e] of suspectCounts) {
    const q = enqueue(db, {
      item_type: 'UNIT_ANOMALY', dedupe_key: `unit:${norm}`, input_text: `${e.name}: strengths labelled "mg" in source`,
      context: { ingredient: e.name, affected_products: e.products.length, sample_products: e.products.slice(0, 10) },
      reason_codes: ['UNIT_LABEL_SUSPECT'], confidence: null, method: 'ingredient_unit_expectation_list',
      source_dataset: 'cdci', batch_id: b.id,
    });
    if (q.created) b.counters.queue++;
  }

  // Brand-name collisions: the same brand string maps to several distinct products (composition differs).
  const groups = all<{ brand_norm: string; n: number }>(db, 'SELECT brand_norm, COUNT(*) n FROM drug_products GROUP BY brand_norm HAVING n > 1');
  for (const g of groups) {
    const prods = all<{ product_id: string; brand_name: string; manufacturer: string; dose_form: string; strength_text: string }>(
      db, 'SELECT product_id, brand_name, manufacturer, dose_form, strength_text FROM drug_products WHERE brand_norm = ? ORDER BY product_id', g.brand_norm);
    const q = enqueue(db, {
      item_type: 'BRAND_COLLISION', dedupe_key: `collision:${g.brand_norm}`, input_text: prods[0]!.brand_name,
      context: { brand_norm: g.brand_norm, product_count: prods.length },
      candidates: prods.map((p) => ({ product_id: p.product_id, label: `${p.brand_name} | ${p.manufacturer} | ${p.dose_form} | ${p.strength_text}` })),
      reason_codes: ['BRAND_NAME_MAPS_TO_MULTIPLE_PRODUCTS'], confidence: null, method: 'exact_brand_norm_group',
      source_dataset: 'cdci', batch_id: b.id,
    });
    if (q.created) { b.counters.queue++; b.counters.unresolved++; }
  }
  const maxAge = config.datasets.cdci.maxAgeDays;
  upsertDatasetVersion(db, 'cdci', b, file, { label: sourceName && sourceVersion ? `${sourceName}@${sourceVersion}` : null, sourceDate: sourceVersion, basis: 'DECLARED_SOURCE_DATE', maxAgeDays: maxAge });
  void get;
}
