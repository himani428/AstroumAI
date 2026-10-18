import { createHash } from 'node:crypto';

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Lowercase, alnum-only, single-spaced. Used for brand/alias matching (assist only, never truth). */
export function normBrand(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normIngredient(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string, max = 99): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[n]!;
}

export interface ParsedStrength {
  value: number;
  unit: string;
  raw: string;
}

/** Parse "650 mg", "50 mcg", "12.5mg". Returns null when not parseable (never guesses). */
export function parseStrength(raw: string | undefined | null): ParsedStrength | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([\d]+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g|iu|ml|%)?$/i);
  if (!m) return null;
  let unit = (m[2] ?? '').toLowerCase();
  if (unit === 'µg' || unit === 'ug') unit = 'mcg';
  return { value: Number(m[1]), unit, raw: raw.trim() };
}

export function toMg(s: ParsedStrength): number | null {
  if (s.unit === 'mg' || s.unit === '') return s.value;
  if (s.unit === 'mcg') return s.value / 1000;
  if (s.unit === 'g') return s.value * 1000;
  return null;
}

export const nowIso = () => new Date().toISOString();

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function paginate(page: unknown, size: unknown, def = 25, max = 200) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(max, Math.max(1, Number(size) || def));
  return { page: p, size: s, offset: (p - 1) * s };
}
