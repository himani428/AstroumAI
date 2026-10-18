import { run } from '../db/connection.js';
import { config } from '../config.js';
import { normIngredient } from '../util/text.js';
import { ProductIndex } from '../master/index.js';
import { checkHeader, enqueue, parseCsv, recordRow, upsertDatasetVersion, type Batch, type RawFile } from './common.js';

export function importInteractions(b: Batch, file: RawFile): void {
  const { header, rows } = parseCsv(file.text);
  if (!checkHeader(b, header, ['ingredient_a', 'ingredient_b', 'severity', 'note', 'source_tag'])) return;
  const idx = ProductIndex.build(b.db);
  const seen = new Map<string, number>();
  let tag: string | null = null;
  for (const row of rows) {
    const r = row.record;
    if (row.cells.length !== header.length || !r.ingredient_a || !r.ingredient_b || !r.severity) {
      recordRow(b, row.rowNumber, r, 'REJECTED', 'MISSING_FIELD');
      continue;
    }
    const a = normIngredient(r.ingredient_a!), c = normIngredient(r.ingredient_b!);
    const key = [a, c].sort().join('|');
    if (a === c) { recordRow(b, row.rowNumber, r, 'REJECTED', 'SELF_INTERACTION'); continue; }
    if (seen.has(key)) { recordRow(b, row.rowNumber, r, 'DUPLICATE', 'DUPLICATE_PAIR', `first on row ${seen.get(key)}`); continue; }
    seen.set(key, row.rowNumber);
    const src = recordRow(b, row.rowNumber, r, 'IMPORTED');
    tag = r.source_tag || tag;
    run(b.db, `INSERT INTO interaction_pairs (ingredient_a, ingredient_b, a_norm, b_norm, severity, note, source_tag, batch_id, source_row_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      r.ingredient_a, r.ingredient_b, a, c, r.severity, r.note || null, r.source_tag || null, b.id, src);
    for (const [raw, n] of [[r.ingredient_a!, a], [r.ingredient_b!, c]] as const) {
      if (!idx.ingredientVocab.has(n)) {
        const q = enqueue(b.db, { item_type: 'INTERACTION_TERM', dedupe_key: `ixterm:${n}`, input_text: `Interaction seed term: ${raw}`,
          context: { pair: `${r.ingredient_a} + ${r.ingredient_b}`, note: 'This name matches no drug-master ingredient (it may be a class term). Pairs using it can never fire.' },
          reason_codes: ['INTERACTION_TERM_NOT_IN_MASTER'], method: 'exact_normalised_name', source_dataset: 'interactions', source_row_id: src, batch_id: b.id });
        if (q.created) { b.counters.queue++; b.counters.unresolved++; }
      }
    }
  }
  upsertDatasetVersion(b.db, 'interactions', b, file, { label: tag, sourceDate: null, basis: 'LOAD_TIME_ONLY', maxAgeDays: config.datasets.interactions.maxAgeDays });
  b.warnings.push('Interaction seed has no as-of date; freshness measured from load time only. It is a 15-pair seed, not an exhaustive screen.');
}
