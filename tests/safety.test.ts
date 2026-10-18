import { describe, expect, it, beforeAll } from 'vitest';
import type { Db } from '../server/src/db/connection.js';
import { runPrescription, runSeededDemo } from '../server/src/safety/service.js';
import { CHECK_STATUSES, type RxLineInput } from '../server/src/safety/types.js';
import { runSafetyRail } from '../server/src/safety/engine.js';
import { SqliteRailData, OutageRailData } from '../server/src/safety/provider.js';
import { normalizePrescription } from '../server/src/master/normalizeRx.js';
import { parseFrequency } from '../server/src/safety/frequency.js';
import { loadedDb } from './helpers.js';

let db: Db;
beforeAll(async () => { db = await loadedDb(); });
const L = (p: string, strength?: string, freq?: string, n = 1): RxLineInput => ({ line_no: n, written_product: p, strength_as_written: strength ?? null, dose_frequency: freq ?? null });
const rx = (lines: RxLineInput[], o: Parameters<typeof runPrescription>[2] = {}) => runPrescription(db, lines.map((l, i) => ({ ...l, line_no: i + 1 })), { asOf: '2026-10-15', persist: false, ...o });
const check = (rep: ReturnType<typeof rx>, t: string) => rep.checks.find((c) => c.check_type === t)!;

describe('frequency parser', () => {
  it('parses slot notation and abbreviations, never invents a schedule', () => {
    expect(parseFrequency('1-0-1 x 5d')).toMatchObject({ kind: 'FIXED', unitsPerDay: 2, durationDays: 5 });
    expect(parseFrequency('1-1-1')).toMatchObject({ unitsPerDay: 3 });
    expect(parseFrequency('BD')).toMatchObject({ unitsPerDay: 2 });
    expect(parseFrequency('SOS').kind).toBe('AS_NEEDED');
    expect(parseFrequency('').kind).toBe('MISSING');
    expect(parseFrequency('as directed by physician').kind).toBe('UNPARSEABLE');
  });
});

describe('duplicate ingredient + FDC decomposition + cumulative exposure', () => {
  it('finds paracetamol hidden inside an FDC and shows aggregate evidence (RX01 pattern)', () => {
    const rep = rx([L('Dolo 650', '650 mg', '1-0-1 x 5d'), L('Sinarest Tablet', undefined, '1-0-1 x 5d')]);
    const d = check(rep, 'DUPLICATE_INGREDIENT');
    expect(d.status).toBe('HIT');
    const ev = d.evidence[0] as { ingredient: string; aggregate: { total_daily_mg: number; complete: boolean }; contributing_lines: unknown[] };
    expect(ev.ingredient).toBe('paracetamol');
    expect(ev.contributing_lines).toHaveLength(2);
    expect(ev.aggregate).toMatchObject({ total_daily_mg: 2300, complete: true });
    expect(d.source_references.some((s) => s.dataset === 'cdci' && s.source_row_id)).toBe(true);
  });
  it('flags a cumulative HIT when a cited reference ceiling is exceeded', () => {
    const rep = rx([L('Dolo 650', '650 mg', '1-1-1-1'), L('Calpol 650', '650 mg', '1-1-1')]);
    const c = check(rep, 'CUMULATIVE_EXPOSURE');
    expect(c.status).toBe('HIT');
    expect(c.severity).toBe('HIGH');
    expect(check(rep, 'DUPLICATE_INGREDIENT').severity).toBe('HIGH');
  });
  it('as-needed frequency yields PARTIAL_COVERAGE with a lower bound, not a clean result (RX07 pattern)', () => {
    const rep = rx([L('Calpol 650', '650 mg', '1-1-1'), L('Crocin 650', '650 mg', 'SOS')]);
    const c = check(rep, 'CUMULATIVE_EXPOSURE');
    expect(c.status).toBe('PARTIAL_COVERAGE');
    expect(JSON.stringify(c.evidence)).toContain('"is_lower_bound":true');
    expect(check(rep, 'DUPLICATE_INGREDIENT').status).toBe('HIT');
  });
  it('no shared ingredient: duplicate and cumulative are CHECKED_NO_HIT', () => {
    const rep = rx([L('Glycomet 500', '500 mg', '1-0-1'), L('Atorva 10', '10 mg', '0-0-1')]);
    expect(check(rep, 'DUPLICATE_INGREDIENT').status).toBe('CHECKED_NO_HIT');
    expect(check(rep, 'CUMULATIVE_EXPOSURE').status).toBe('CHECKED_NO_HIT');
  });
});

describe('regulatory (event-sourced)', () => {
  it('prohibited FDC is a CRITICAL HIT citing the latest superseding notification', () => {
    const c = check(rx([L('NimuPar-P', undefined, '1-0-1')]), 'PROHIBITED_FDC');
    expect(c.status).toBe('HIT');
    expect(c.severity).toBe('CRITICAL');
    expect(JSON.stringify(c.evidence)).toContain('EV003');
  });
  it('the same product was only STAYED between the stay and the re-prohibition (time travel)', () => {
    const c = check(rx([L('NimuPar-P')], { asOf: '2020-06-01' }), 'PROHIBITED_FDC');
    expect(c.status).toBe('HIT');
    expect(c.severity).toBe('MODERATE');
    expect(JSON.stringify(c.evidence)).toContain('"derived_state":"STAYED"');
  });
});

describe('severe interactions', () => {
  it('detects warfarin + azithromycin from the seed list (RX03 pattern)', () => {
    const c = check(rx([L('Warf 5', '5 mg', '1-0-0'), L('Azee 500', '500 mg', '1-0-0')]), 'SEVERE_INTERACTION');
    expect(c.status).toBe('HIT');
    expect(c.severity).toBe('CRITICAL');
  });
  it('a clean result states it is seed-list scope and notes missing patient context', () => {
    const c = check(rx([L('Glycomet 500', '500 mg', '1-0-1'), L('Atorva 10', '10 mg', '0-0-1')]), 'SEVERE_INTERACTION');
    expect(c.status).toBe('CHECKED_NO_HIT');
    expect(c.limitations.join(' ')).toMatch(/seed list/i);
    expect(c.limitations.join(' ')).toMatch(/patient medication list/i);
  });
});

describe('unknown states are never rendered as safe', () => {
  it('ambiguous brand => UNVERIFIED_INPUT for every check and a queue item with reason codes (RX04)', () => {
    const rep = rx([L('Telma', undefined, '1-0-0')]);
    for (const c of rep.checks) expect(c.status).toBe('UNVERIFIED_INPUT');
    expect(rep.lines[0]!.resolution.reason_codes).toContain('NO_EXACT_BRAND_MATCH');
    expect(rep.lines[0]!.resolution.queue_id).toBeTruthy();
    expect(rep.summary.all_checks_clean).toBe(false);
  });
  it('unit mismatch between written and master strength is not auto-resolved (RX10)', () => {
    const rep = rx([L('Pan 40', '40 mg', '1-0-0'), L('Thyronorm 50', '50 mcg', '1-0-0')]);
    expect(rep.lines[1]!.resolution.status).toBe('NEEDS_REVIEW');
    expect(rep.lines[1]!.resolution.reason_codes).toContain('STRENGTH_UNIT_MISMATCH');
    expect(check(rep, 'SEVERE_INTERACTION').status).toBe('PARTIAL_COVERAGE');
  });
  it('a hit among resolved lines still reports the unresolved line as a limitation', () => {
    const rep = rx([L('Warf 5', '5 mg', '1-0-0'), L('Azee 500', '500 mg', '1-0-0'), L('Zqtrixon Forte')]);
    const c = check(rep, 'SEVERE_INTERACTION');
    expect(c.status).toBe('HIT');
    expect(c.unresolved_inputs).toHaveLength(1);
  });
});

describe('statuses driven by data state', () => {
  it('DATA_EXPIRED when the clean result rests on data older than its window', () => {
    const rep = rx([L('Glycomet 500', '500 mg', '1-0-1'), L('Atorva 10', '10 mg', '0-0-1')], { asOf: '2027-08-01' });
    expect(check(rep, 'DUPLICATE_INGREDIENT').status).toBe('DATA_EXPIRED');
    expect(rep.summary.all_checks_clean).toBe(false);
  });
  it('SOURCE_CONFLICT when active register events disagree and are not linked', () => {
    const sim = { event_id: 'SIM-9', notification_id: 'SIM', date_published: '2025-02-01', effective_date: '2025-02-01', action: 'RESTRICTED', target_type: 'FDC', target_description: 'Nimesulide + Paracetamol (all strengths)', supersedes_event_id: null, note: null, target_key: ['FDC', 'nimesulide+paracetamol', '', 'all', ''].join('|'), target: { target_type: 'FDC', components: ['nimesulide', 'paracetamol'], forms: [], paediatric: false, ratio_specific: false, descriptive: false, qualifiers: [] } };
    const c = check(rx([L('NimuPar-P')], { extraEvents: [sim] }), 'PROHIBITED_FDC');
    expect(c.status).toBe('SOURCE_CONFLICT');
  });
  it('SERVICE_UNAVAILABLE when a dependency fails (never a silent pass)', () => {
    const rep = rx([L('NimuPar-P')], { simulateOutage: 'regulatory' });
    expect(check(rep, 'PROHIBITED_FDC').status).toBe('SERVICE_UNAVAILABLE');
    expect(check(rep, 'DUPLICATE_INGREDIENT').status).not.toBe('SERVICE_UNAVAILABLE');
    const all = rx([L('NimuPar-P')], { simulateOutage: 'all' });
    expect(all.checks.every((c) => c.status === 'SERVICE_UNAVAILABLE')).toBe(true);
  });
  it('NOT_CHECKED for an empty draft or checks the caller did not request', () => {
    const lines = normalizePrescription(db, [{ line_no: 1, written_product: 'Dolo 650' }]);
    const rep = runSafetyRail(lines, new SqliteRailData(db), { asOf: '2026-10-15', checks: ['DUPLICATE_INGREDIENT'] });
    expect(rep.checks.filter((c) => c.status === 'NOT_CHECKED')).toHaveLength(3);
    const empty = runSafetyRail([], new SqliteRailData(db), { asOf: '2026-10-15' });
    expect(empty.checks.every((c) => c.status === 'NOT_CHECKED')).toBe(true);
  });
  it('a failed version lookup yields SERVICE_UNAVAILABLE with an explicit fingerprint label', () => {
    const rep = runSafetyRail(normalizePrescription(db, [{ line_no: 1, written_product: 'Dolo 650' }]), new OutageRailData(new SqliteRailData(db), 'all'), { asOf: '2026-10-15' });
    expect(rep.data_version).toBe('dv-unavailable');
  });
});

describe('contract: every result carries the required fields', () => {
  it('all ten seeded prescriptions produce 4 results with a status from the fixed vocabulary', () => {
    const out = runSeededDemo(db, { origin: 'SIMULATION', persist: false });
    expect(Object.keys(out)).toHaveLength(10);
    const seen = new Set<string>();
    for (const rep of Object.values(out)) {
      expect(rep.llm_used_in_safety_path).toBe(false);
      expect(rep.checks).toHaveLength(4);
      for (const c of rep.checks) {
        expect(CHECK_STATUSES).toContain(c.status);
        for (const k of ['check_type', 'severity', 'explanation', 'evidence', 'affected_products', 'affected_ingredients', 'source_references', 'rule_version', 'data_version', 'executed_at', 'unresolved_inputs', 'limitations']) expect(c).toHaveProperty(k);
        expect(c.source_references.length).toBeGreaterThan(0);
        seen.add(c.status);
      }
    }
    for (const s of ['HIT', 'CHECKED_NO_HIT', 'PARTIAL_COVERAGE', 'UNVERIFIED_INPUT']) expect(seen.has(s)).toBe(true);
  });
  it('seeded outputs are reproducible: identical results across two runs (ignoring queue ids)', () => {
    const strip = (o: unknown) => JSON.stringify(o).replace(/"queue_id":(\d+|null)/g, '');
    const a = runSeededDemo(db, { origin: 'SIMULATION', persist: false });
    const b = runSeededDemo(db, { origin: 'SIMULATION', persist: false });
    expect(strip(a)).toBe(strip(b));
  });
  it('known-bad seeds hit and clean seeds are clean', () => {
    const out = runSeededDemo(db, { origin: 'SIMULATION', persist: false });
    const st = (id: string, t: string) => out[id]!.checks.find((c) => c.check_type === t)!.status;
    expect(st('RX01', 'DUPLICATE_INGREDIENT')).toBe('HIT');
    expect(st('RX02', 'PROHIBITED_FDC')).toBe('HIT');
    expect(st('RX03', 'SEVERE_INTERACTION')).toBe('HIT');
    expect(st('RX07', 'DUPLICATE_INGREDIENT')).toBe('HIT');
    expect(st('RX09', 'DUPLICATE_INGREDIENT')).toBe('HIT');
    for (const id of ['RX05', 'RX06']) expect(out[id]!.summary.all_checks_clean).toBe(true);
  });
});
