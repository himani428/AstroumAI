import { describe, expect, it } from 'vitest';
import { deriveTargets } from '../server/src/regulatory/status.js';
import { parseTarget, targetKey } from '../server/src/regulatory/parser.js';
import type { RegEvent } from '../server/src/regulatory/types.js';

const ev = (id: string, eff: string, action: string, sup: string | null = null, desc = 'A + B (all strengths)'): RegEvent => {
  const target = parseTarget('FDC', desc);
  return { event_id: id, notification_id: `N-${id}`, date_published: eff, effective_date: eff, action, target_type: 'FDC', target_description: desc, supersedes_event_id: sup, note: null, target_key: targetKey(target), target };
};
const chain = [ev('E1', '2019-01-01', 'PROHIBITED'), ev('E2', '2020-01-01', 'STAY_GRANTED', 'E1'), ev('E3', '2023-01-01', 'PROHIBITED', 'E2')];

describe('event-sourced status derivation', () => {
  it('derives state purely from dated events', () => {
    const at = (d: string) => deriveTargets(chain, d)[0]!.state;
    expect(at('2018-12-31')).toBe('NO_EVENT_IN_FORCE');
    expect(at('2019-06-01')).toBe('PROHIBITED');
    expect(at('2021-06-01')).toBe('STAYED');
    expect(at('2024-01-01')).toBe('PROHIBITED');
  });
  it('cites the latest active event and lists pending future events', () => {
    const t = deriveTargets(chain, '2021-06-01')[0]!;
    expect(t.citing_event?.event_id).toBe('E2');
    expect(t.pending_events.map((e) => e.event_id)).toEqual(['E3']);
  });
  it('reports a conflict when unlinked active events disagree', () => {
    const t = deriveTargets([ev('E1', '2024-01-01', 'PROHIBITED'), ev('E2', '2024-01-01', 'RESTRICTED')], '2025-01-01')[0]!;
    expect(t.state).toBe('SOURCE_CONFLICT');
    expect(t.conflicts.length).toBe(1);
  });
  it('surfaces data anomalies instead of hiding them', () => {
    const t = deriveTargets([ev('E1', '2024-01-01', 'PROHIBITED', 'MISSING')], '2025-01-01')[0]!;
    expect(t.anomalies.join(' ')).toMatch(/DANGLING_SUPERSEDES/);
  });
  it('parses scope qualifiers', () => {
    expect(parseTarget('FDC', 'Ibuprofen + Paracetamol (paediatric suspensions only)')).toMatchObject({ components: ['ibuprofen', 'paracetamol'], forms: ['suspension'], paediatric: true });
    expect(parseTarget('FDC', 'A + B + C + D (specific ratio)').ratio_specific).toBe(true);
    expect(parseTarget('FDC', 'Codeine-based cough FDCs (paediatric)')).toMatchObject({ descriptive: true, components: ['codeine'] });
  });
});
