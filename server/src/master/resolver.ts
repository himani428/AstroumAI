import type { Db } from '../db/connection.js';
import { get } from '../db/connection.js';
import { config } from '../config.js';
import { levenshtein, normBrand, parseStrength, toMg } from '../util/text.js';
import { ProductIndex, type IndexedProduct } from './index.js';

export interface Candidate {
  product_id: string;
  label: string;
  brand_name: string;
  dose_form: string | null;
  strength_text: string | null;
  score: number;
  basis: string;
}

export interface ResolveInput { written: string; strength?: string | null; formHint?: string | null }

export interface ResolveResult {
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'UNRESOLVED';
  product_id: string | null;
  candidates: Candidate[];
  reason_codes: string[];
  warnings: string[];
  confidence: number;
  method: string;
}

const cand = (p: IndexedProduct, score: number, basis: string): Candidate => ({
  product_id: p.product_id, brand_name: p.brand_name, dose_form: p.dose_form, strength_text: p.strength_text,
  label: `${p.brand_name} | ${p.manufacturer ?? '?'} | ${p.dose_form ?? '?'} | ${p.strength_text ?? '?'}`, score: Math.round(score * 100) / 100, basis,
});

/** Compares written strength with the product's component strengths. Returns a reason code on conflict. */
function strengthCheck(p: IndexedProduct, written: string | null | undefined): { ok: boolean; reason?: string; note?: string } {
  if (!written || !written.trim()) return { ok: true, note: 'STRENGTH_NOT_WRITTEN' };
  const w = parseStrength(written);
  if (!w) return { ok: false, reason: 'STRENGTH_UNPARSEABLE', note: `strength "${written}" could not be parsed` };
  const wMg = toMg(w);
  for (const i of p.ingredients) {
    if (i.value == null) continue;
    if (wMg != null && Math.abs(i.value - wMg) < 1e-9) return { ok: true };
  }
  // Same number but a different unit (mcg vs mg) is a suspected unit anomaly in the source, not a plain mismatch.
  if (p.ingredients.some((i) => i.value === w.value && i.unit && w.unit && i.unit !== w.unit))
    return { ok: false, reason: 'STRENGTH_UNIT_MISMATCH', note: `written ${w.raw} vs master ${p.strength_text}: same number, different unit` };
  return { ok: false, reason: 'STRENGTH_MISMATCH', note: `written ${w.raw} does not match any component of ${p.strength_text}` };
}

export function resolveProduct(db: Db, idx: ProductIndex, input: ResolveInput): ResolveResult {
  const norm = normBrand(input.written);
  const strengthKey = (input.strength ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!norm) return { status: 'UNRESOLVED', product_id: null, candidates: [], reason_codes: ['EMPTY_INPUT'], warnings: [], confidence: 0, method: 'none' };

  // 1. Human-confirmed alias (audited decision) always wins over heuristics.
  const confirmed =
    get<{ product_id: string }>(db, 'SELECT product_id FROM alias_confirmations WHERE alias_norm = ? AND strength_norm = ?', norm, strengthKey) ??
    get<{ product_id: string }>(db, "SELECT product_id FROM alias_confirmations WHERE alias_norm = ? AND strength_norm = ''", norm);
  if (confirmed && idx.byId.has(confirmed.product_id))
    return { status: 'RESOLVED', product_id: confirmed.product_id, candidates: [cand(idx.byId.get(confirmed.product_id)!, 1, 'reviewer_confirmed')], reason_codes: [], warnings: [], confidence: 1, method: 'reviewer_confirmed' };

  const exact = idx.byBrand.get(norm) ?? [];
  if (exact.length === 1) {
    const p = exact[0]!;
    const sc = strengthCheck(p, input.strength);
    const warnings: string[] = [];
    if (sc.note === 'STRENGTH_NOT_WRITTEN') warnings.push('STRENGTH_NOT_WRITTEN');
    if (input.formHint && p.dose_form && input.formHint.toLowerCase() !== p.dose_form.toLowerCase()) {
      return { status: 'NEEDS_REVIEW', product_id: null, candidates: [cand(p, 0.6, 'exact_brand_form_conflict')], reason_codes: ['FORM_HINT_CONFLICT'], warnings: [`billed form ${input.formHint} vs master ${p.dose_form}`], confidence: 0.6, method: 'exact_brand' };
    }
    if (!sc.ok) {
      return { status: 'NEEDS_REVIEW', product_id: null, candidates: [cand(p, 0.7, 'exact_brand_strength_conflict')], reason_codes: [sc.reason!], warnings: sc.note ? [sc.note] : [], confidence: 0.7, method: 'exact_brand' };
    }
    const conf = input.strength ? config.normalization.resolvedConfidence.exactUniqueWithStrength : config.normalization.resolvedConfidence.exactUniqueNoStrength;
    return { status: 'RESOLVED', product_id: p.product_id, candidates: [cand(p, conf, 'exact_brand_unique')], reason_codes: [], warnings, confidence: conf, method: 'exact_brand_unique' };
  }
  if (exact.length > 1) {
    const ranked = exact.map((p) => {
      const sc = strengthCheck(p, input.strength);
      const formOk = !input.formHint || (p.dose_form ?? '').toLowerCase() === input.formHint.toLowerCase();
      return cand(p, 0.4 + (sc.ok && input.strength ? 0.2 : 0) + (formOk && input.formHint ? 0.2 : 0), `brand_collision${formOk && input.formHint ? '+form_hint' : ''}${sc.ok && input.strength ? '+strength' : ''}`);
    }).sort((a, b) => b.score - a.score);
    return { status: 'NEEDS_REVIEW', product_id: null, candidates: ranked, reason_codes: ['BRAND_NAME_MAPS_TO_MULTIPLE_PRODUCTS'], warnings: ['Ranking is a hint for the reviewer only; it never selects a product.'], confidence: ranked[0]!.score, method: 'exact_brand_collision' };
  }

  // 3. No exact match: fuzzy/prefix suggestions are assistance for a human, never truth.
  const maxD = config.normalization.fuzzyMaxDistance;
  const found: Candidate[] = [];
  for (const [bn, prods] of idx.byBrand) {
    const prefix = bn.startsWith(norm + ' ') || norm.startsWith(bn + ' ');
    const d = prefix ? 0 : levenshtein(norm, bn, maxD);
    if (prefix || d <= maxD) {
      const score = prefix ? 0.7 : 1 - d / Math.max(norm.length, bn.length);
      for (const p of prods) found.push(cand(p, score, prefix ? 'prefix_match' : `edit_distance_${d}`));
    }
  }
  found.sort((a, b) => b.score - a.score || a.product_id.localeCompare(b.product_id));
  const top = found.slice(0, config.normalization.fuzzyMaxCandidates);
  if (top.length) return { status: 'NEEDS_REVIEW', product_id: null, candidates: top, reason_codes: ['NO_EXACT_BRAND_MATCH', 'FUZZY_CANDIDATES_ONLY'], warnings: [], confidence: top[0]!.score, method: 'fuzzy_assist' };
  const nonLatin = /\P{ASCII}/u.test(norm);
  return { status: 'UNRESOLVED', product_id: null, candidates: [], reason_codes: nonLatin ? ['NO_EXACT_BRAND_MATCH', 'NON_LATIN_SCRIPT', 'NO_CANDIDATE_FOUND'] : ['NO_EXACT_BRAND_MATCH', 'NO_CANDIDATE_FOUND'], warnings: nonLatin ? ['Input is not in Latin script; no transliteration is attempted. A reviewer can confirm an alias.'] : [], confidence: 0, method: 'none' };
}
