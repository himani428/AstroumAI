import type { Db } from '../db/connection.js';
import { config } from '../config.js';
import { normBrand } from '../util/text.js';
import { enqueue } from '../ingest/common.js';
import { ProductIndex } from './index.js';
import { resolveProduct } from './resolver.js';
import type { ResolvedLine, RxLineInput } from '../safety/types.js';

/**
 * Normalization stage for draft prescriptions. Anything not uniquely and consistently resolved is
 * placed in the review queue with reason codes; the line is then excluded from checks as unresolved.
 */
export function normalizePrescription(db: Db, lines: RxLineInput[], opts: { enqueueUnresolved?: boolean } = {}): ResolvedLine[] {
  const idx = ProductIndex.build(db);
  const doEnqueue = opts.enqueueUnresolved !== false;
  return lines.map((input) => {
    const res = resolveProduct(db, idx, { written: input.written_product, strength: input.strength_as_written });
    let queueId: number | null = null;
    if (res.status !== 'RESOLVED' && doEnqueue) {
      const q = enqueue(db, {
        item_type: 'RX_LINE', dedupe_key: `rx:${normBrand(input.written_product)}|${(input.strength_as_written ?? '').toLowerCase().replace(/\s+/g, '')}`,
        input_text: `${input.written_product}${input.strength_as_written ? ' ' + input.strength_as_written : ''}`,
        context: { line_no: input.line_no, dose_frequency: input.dose_frequency ?? null, warnings: res.warnings, normalizer: config.versions.normalizer },
        candidates: res.candidates, reason_codes: res.reason_codes, confidence: res.confidence, method: res.method, source_dataset: 'draft_prescription',
      });
      queueId = q.id;
    }
    const p = res.product_id ? idx.byId.get(res.product_id) ?? null : null;
    return {
      line_no: input.line_no, input,
      resolution: { status: res.status, confidence: res.confidence, method: res.method, reason_codes: res.reason_codes, warnings: res.warnings, candidates: res.candidates.map((c) => ({ product_id: c.product_id, label: c.label, score: c.score, basis: c.basis })), queue_id: queueId },
      product: p ? { product_id: p.product_id, brand_name: p.brand_name, dose_form: p.dose_form, strength_text: p.strength_text, ingredients: p.ingredients, source: p.source, source_version: p.source_version, batch_id: p.batch_id, source_row_id: p.source_row_id, anomaly_flags: p.anomaly_flags } : null,
    };
  });
}
