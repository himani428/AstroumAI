import type { DerivedTarget } from './types.js';

export interface ProductForMatch {
  product_id: string;
  brand_name: string;
  dose_form: string | null;
  ingredient_norms: string[];
}

export interface TargetMatch {
  target: DerivedTarget;
  applicability: 'DEFINITE' | 'POSSIBLE';
  reasons: string[];
}

/**
 * Deterministic product-to-register matching. A scope that cannot be confirmed from product data
 * (paediatric use, ratio) yields POSSIBLE, never a silent pass and never an unqualified HIT.
 */
export function matchProduct(p: ProductForMatch, targets: DerivedTarget[]): { matches: TargetMatch[]; unmatchable: DerivedTarget[] } {
  const set = new Set(p.ingredient_norms);
  const matches: TargetMatch[] = [];
  const unmatchable: DerivedTarget[] = [];
  for (const t of targets) {
    const tg = t.target;
    const comps = tg.components;
    let ok: boolean;
    if (tg.descriptive) ok = comps.some((c) => [...set].some((i) => i.includes(c)));
    else if (tg.target_type === 'INGREDIENT') ok = comps.length === 1 && set.has(comps[0]!);
    else ok = comps.length === set.size && comps.every((c) => set.has(c));
    if (!ok) continue;
    const reasons: string[] = [];
    let applicability: 'DEFINITE' | 'POSSIBLE' = 'DEFINITE';
    if (tg.descriptive) {
      applicability = 'POSSIBLE';
      reasons.push('target is a class-style description; only a keyword match on the ingredient name could be made');
    }
    if (tg.forms.length > 0) {
      if (!p.dose_form || !tg.forms.includes(p.dose_form.toLowerCase())) continue; // scope excludes this dose form
      reasons.push(`dose form ${p.dose_form} is within the target scope (${tg.forms.join(', ')})`);
    }
    if (tg.paediatric) {
      applicability = 'POSSIBLE';
      reasons.push('target is limited to paediatric use; patient age is not part of the draft, so applicability cannot be confirmed');
    }
    if (tg.ratio_specific) {
      applicability = 'POSSIBLE';
      reasons.push('target is limited to a specific ratio that is not stated in the register; ingredient set matches but the ratio cannot be verified');
    }
    matches.push({ target: t, applicability, reasons });
  }
  return { matches, unmatchable };
}
