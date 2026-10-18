import type { ParsedTarget } from './types.js';
import { normIngredient } from '../util/text.js';

const FORM_WORDS = ['suspension', 'syrup', 'tablet', 'capsule'];

/**
 * Deterministic parse of a free-text gazette target description into structured scope.
 * Anything not understood is kept in `qualifiers` and flagged, never silently dropped.
 */
export function parseTarget(targetType: string, description: string): ParsedTarget {
  const qualifiers: string[] = [];
  let main = description;
  const paren = description.match(/\(([^)]*)\)\s*$/);
  if (paren) {
    qualifiers.push(paren[1]!.trim());
    main = description.slice(0, paren.index).trim();
  }
  const q = qualifiers.join(' ').toLowerCase();
  const forms: string[] = [];
  const parts = main.split('+').map((s) => s.trim()).filter(Boolean);
  const components: string[] = [];
  let descriptive = false;
  for (const raw of parts) {
    let name = raw;
    const words = name.split(/\s+/);
    const last = words[words.length - 1]!.toLowerCase();
    if (words.length > 1 && FORM_WORDS.includes(last)) {
      forms.push(last);
      name = words.slice(0, -1).join(' ');
    }
    if (/\b(based|fdcs?|cough)\b/i.test(name)) {
      descriptive = true;
      // Class-style description: keep only the leading keyword (e.g. "codeine-based cough FDCs" -> "codeine").
      name = name.split(/[\s-]/)[0]!;
    }
    components.push(normIngredient(name));
  }
  const suspOnly = /suspensions?\s+only/.test(q);
  if (suspOnly && !forms.includes('suspension')) forms.push('suspension');
  return {
    target_type: targetType,
    components: [...components].sort(),
    forms: [...new Set(forms)].sort(),
    paediatric: /paediatric|pediatric/.test(q) || /paediatric|pediatric/i.test(description),
    ratio_specific: /specific ratio/.test(q),
    descriptive,
    qualifiers,
  };
}

export function targetKey(t: ParsedTarget): string {
  return [t.target_type, t.components.join('+'), t.forms.join(','), t.paediatric ? 'paed' : 'all', t.ratio_specific ? 'ratio' : ''].join('|');
}
