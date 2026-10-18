export type Frequency =
  | { kind: 'FIXED'; unitsPerDay: number; durationDays: number | null; raw: string }
  | { kind: 'AS_NEEDED'; raw: string }
  | { kind: 'MISSING'; raw: '' }
  | { kind: 'UNPARSEABLE'; raw: string };

const ABBREV: Record<string, number> = { od: 1, qd: 1, bd: 2, bid: 2, tds: 3, tid: 3, qid: 4 };

/**
 * Parses conventional Indian slot notation ("1-0-1", "1-1-1 x 3d", "1-0-1-1") and common abbreviations.
 * Anything else is reported as UNPARSEABLE/AS_NEEDED/MISSING; a schedule is never invented.
 */
export function parseFrequency(input: string | null | undefined): Frequency {
  const raw = (input ?? '').trim();
  if (!raw) return { kind: 'MISSING', raw: '' };
  const lower = raw.toLowerCase();
  const dur = lower.match(/(?:x|for)\s*(\d+)\s*d(?:ays?)?\b/);
  const durationDays = dur ? Number(dur[1]) : null;
  const head = lower.replace(/(?:x|for)\s*\d+\s*d(?:ays?)?\b/, '').trim();
  if (/^(sos|prn|as needed|when required|if needed)$/.test(head)) return { kind: 'AS_NEEDED', raw };
  const slots = head.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?)){1,3}$/);
  if (slots) {
    const n = head.split('-').map((s) => Number(s.trim()));
    if (n.every((v) => Number.isFinite(v))) return { kind: 'FIXED', unitsPerDay: n.reduce((a, c) => a + c, 0), durationDays, raw };
  }
  if (ABBREV[head] != null) return { kind: 'FIXED', unitsPerDay: ABBREV[head]!, durationDays, raw };
  return { kind: 'UNPARSEABLE', raw };
}
