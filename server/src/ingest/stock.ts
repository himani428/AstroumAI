import { run } from '../db/connection.js';
import { config } from '../config.js';
import { normBrand } from '../util/text.js';
import { ProductIndex } from '../master/index.js';
import { resolveProduct } from '../master/resolver.js';
import { checkHeader, enqueue, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

export interface StockParse { brand: string; brandNorm: string; formHint: string | null; pack: string | null; leftovers: string[] }

/** Strip billing noise (pack tokens like 15S / 10'S / 100ML, form tokens like TAB/SYP/STRIP). Pure, deterministic. */
export function parseStockName(billed: string): StockParse {
  let s = billed.toUpperCase().trim();
  const packs: string[] = [];
  s = s.replace(/\b\d+\s*'?\s*S\b/g, (m) => { packs.push(m.trim()); return ' '; });
  s = s.replace(/\b\d+\s*ML\b/g, (m) => { packs.push(m.trim()); return ' '; });
  let form: string | null = null;
  const tokens = s.split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  for (const t of tokens) {
    if ((config.normalization.stockPackTokens as readonly string[]).includes(t)) {
      const f = config.normalization.stockFormTokenMap[t];
      if (f) form = f;
    } else keep.push(t);
  }
  const brand = keep.join(' ');
  const leftovers = keep.filter((t) => /[^A-Z0-9'\-.]/.test(t));
  return { brand, brandNorm: normBrand(brand), formHint: form, pack: packs.join(' ') || null, leftovers };
}

const validExpiry = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function importStock(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, ['item_name_as_billed', 'qty_units', 'mrp_inr', 'batch', 'expiry'])) return;
  const idx = ProductIndex.build(b.db);
  const seenRow = new Map<string, number>();
  for (const row of rows) {
    const r = row.record;
    const qty = Number(r.qty_units), mrp = Number(r.mrp_inr);
    const problems: string[] = [];
    if (row.cells.length !== header.length) problems.push('MALFORMED_COLUMN_COUNT');
    if (!r.item_name_as_billed) problems.push('MISSING_ITEM_NAME');
    if (!Number.isInteger(qty) || qty < 0) problems.push('BAD_QTY');
    if (Number.isNaN(mrp) || mrp < 0) problems.push('BAD_MRP');
    if (!validExpiry(r.expiry!)) problems.push('BAD_EXPIRY');
    if (problems.length) { recordRow(b, row.rowNumber, r, 'REJECTED', problems[0], problems.join(',')); continue; }
    const k = JSON.stringify(r);
    if (seenRow.has(k)) { recordRow(b, row.rowNumber, r, 'DUPLICATE', 'DUPLICATE_ROW_IDENTICAL', `identical to row ${seenRow.get(k)}`); continue; }
    seenRow.set(k, row.rowNumber);
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    const p = parseStockName(r.item_name_as_billed!);
    const res = resolveProduct(b.db, idx, { written: p.brand, formHint: p.formHint });
    let status = 'QUEUED';
    let productId: string | null = null;
    if (res.status === 'RESOLVED') { status = 'MAPPED'; productId = res.product_id; }
    else {
      b.counters.unresolved++;
      const q = enqueue(b.db, {
        item_type: 'STOCK_LINE', dedupe_key: `stock:${p.brandNorm}|${p.formHint ?? ''}`, input_text: r.item_name_as_billed!,
        context: { parsed_brand: p.brand, form_hint: p.formHint, pack: p.pack, leftovers: p.leftovers, warnings: res.warnings },
        candidates: res.candidates, reason_codes: res.reason_codes, confidence: res.confidence, method: res.method,
        source_dataset: 'stock', source_row_id: src, batch_id: b.id,
      });
      if (q.created) b.counters.queue++;
      if (res.status === 'UNRESOLVED') status = 'UNMAPPED';
    }
    run(b.db, `INSERT INTO stock_items (item_name_as_billed, parsed_brand, parsed_brand_norm, parsed_form_hint, parsed_pack, qty_units, mrp_inr, batch_no, expiry,
        mapped_product_id, mapping_status, mapping_method, mapping_confidence, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.item_name_as_billed, p.brand, p.brandNorm, p.formHint, p.pack, qty, mrp, r.batch, r.expiry, productId, status, res.method, res.confidence, b.id, src);
  }
  upsertDatasetVersion(b.db, 'stock', b, file, { label: 'clinic stock file', sourceDate: null, basis: 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.stock.maxAgeDays });
}
