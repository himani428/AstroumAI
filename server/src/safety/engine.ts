import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { deriveTargets } from '../regulatory/status.js';
import { matchProduct } from '../regulatory/match.js';
import type { DerivedTarget } from '../regulatory/types.js';
import { daysBetween } from '../util/text.js';
import { parseFrequency } from './frequency.js';
import {
  CHECK_TYPES, type CheckResult, type CheckStatus, type CheckType, type DatasetVersionInfo, type RailData, type RailOptions, type RailReport,
  type ResolvedLine, type Severity, type SourceRef,
} from './types.js';

/**
 * DETERMINISTIC SAFETY RAIL. Pure lookup and arithmetic over versioned data.
 * Law 4: no model, embedding, network or probabilistic component may be imported here.
 * (tests/safety-isolation.test.ts enforces this by scanning this directory's imports.)
 */

interface Ctx {
  lines: ResolvedLine[];
  resolved: ResolvedLine[];
  unresolved: ResolvedLine[];
  data: RailData;
  versions: DatasetVersionInfo[];
  fingerprint: string;
  asOf: string;
  executedAt: string;
}

const unresolvedInputs = (c: Ctx) =>
  c.unresolved.map((l) => ({ line_no: l.line_no, written_product: l.input.written_product, status: l.resolution.status, reason_codes: l.resolution.reason_codes, queue_id: l.resolution.queue_id ?? null }));

const affected = (ls: ResolvedLine[]) => ls.filter((l) => l.product).map((l) => ({ line_no: l.line_no, product_id: l.product!.product_id, brand_name: l.product!.brand_name }));

function base(check: CheckType, ruleId: string, c: Ctx, deps: string[]): CheckResult {
  return {
    check_type: check, rule_id: ruleId, status: 'NOT_CHECKED', severity: 'INFO', explanation: '', evidence: [], affected_products: [], affected_ingredients: [],
    source_references: [], rule_version: config.versions.safetyRules, data_version: c.fingerprint, data_dependencies: deps, executed_at: c.executedAt,
    unresolved_inputs: unresolvedInputs(c), limitations: [],
  };
}

export function fingerprintOf(versions: DatasetVersionInfo[]): string {
  const key = versions.map((v) => `${v.dataset}:${v.batch_id}:${v.source_sha256}`).sort().join('|');
  return 'dv-' + createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Freshness is measured from the declared source date when one exists, otherwise from load time. */
export function freshness(v: DatasetVersionInfo, asOf: string): { expired: boolean; ageDays: number; basis: string; basisDate: string } {
  const basisDate = v.source_date ?? v.loaded_at.slice(0, 10);
  const ageDays = daysBetween(basisDate, asOf);
  return { expired: ageDays > v.max_age_days, ageDays, basis: v.source_date ? 'DECLARED_SOURCE_DATE' : 'LOAD_TIME_ONLY', basisDate };
}

/** Status for a check that found nothing actionable: never CHECKED_NO_HIT unless fully covered. */
function noHitStatus(c: Ctx, r: CheckResult, opts: { conflict?: boolean; expiredNotes: string[]; partialReasons: string[] }): CheckStatus {
  if (opts.conflict) return 'SOURCE_CONFLICT';
  if (opts.expiredNotes.length) return 'DATA_EXPIRED';
  if (c.unresolved.length) return c.resolved.length === 0 ? 'UNVERIFIED_INPUT' : 'PARTIAL_COVERAGE';
  if (opts.partialReasons.length) return 'PARTIAL_COVERAGE';
  void r;
  return 'CHECKED_NO_HIT';
}

const needVersions = (c: Ctx, deps: string[]) => deps.map((d) => c.versions.find((v) => v.dataset === d));

function unavailable(r: CheckResult, msg: string): CheckResult {
  r.status = 'SERVICE_UNAVAILABLE';
  r.severity = 'HIGH';
  r.explanation = `This check could not run: ${msg}. Absence of a finding must NOT be read as safe.`;
  r.limitations.push(msg);
  return r;
}

function dataGuards(c: Ctx, r: CheckResult, deps: string[]): { early: boolean; expiredNotes: string[] } {
  const found = needVersions(c, deps);
  const missing = deps.filter((_, i) => !found[i]);
  if (missing.length) {
    unavailable(r, `required dataset(s) not loaded: ${missing.join(', ')}`);
    return { early: true, expiredNotes: [] };
  }
  const expiredNotes: string[] = [];
  for (const v of found as DatasetVersionInfo[]) {
    const f = freshness(v, c.asOf);
    r.source_references.push({ dataset: v.dataset, ref: v.version_label ?? v.dataset, version: v.source_date ?? v.loaded_at, batch_id: v.batch_id, detail: `freshness ${f.ageDays}d vs limit ${v.max_age_days}d (${f.basis})` });
    if (f.expired) expiredNotes.push(`${v.dataset} is ${f.ageDays} days old at ${c.asOf} (limit ${v.max_age_days}d, basis ${f.basis}: ${f.basisDate})`);
    if (f.basis === 'LOAD_TIME_ONLY') r.limitations.push(`${v.dataset} has no declared as-of date; freshness is measured from load time only`);
  }
  return { early: false, expiredNotes };
}

const prov = (l: ResolvedLine): SourceRef => ({ dataset: 'cdci', ref: l.product!.product_id, version: l.product!.source_version, batch_id: l.product!.batch_id, source_row_id: l.product!.source_row_id, detail: `${l.product!.brand_name} (${l.product!.strength_text})` });

// ---------- exposure arithmetic (shared by duplicate + cumulative checks) ----------
interface LineExposure {
  line_no: number; brand: string; product_id: string; dose_form: string | null; strength_per_unit: string; frequency_raw: string;
  units_per_day: number | null; daily_mg: number | null; computable: boolean; reasons: string[]; flags: string[];
}

function exposureFor(l: ResolvedLine, ingNorm: string): LineExposure {
  const p = l.product!;
  const ing = p.ingredients.find((i) => i.norm === ingNorm)!;
  const f = parseFrequency(l.input.dose_frequency);
  const reasons: string[] = [];
  const flags: string[] = [];
  let units: number | null = null;
  if (f.kind === 'FIXED') units = f.unitsPerDay;
  else if (f.kind === 'AS_NEEDED') reasons.push(`frequency "${f.raw}" is as-needed; units per day unknown`);
  else if (f.kind === 'MISSING') reasons.push('no dose frequency supplied');
  else reasons.push(`frequency "${f.raw}" could not be parsed`);
  if (!p.dose_form || !(config.safety.countableDoseForms as readonly string[]).includes(p.dose_form)) {
    reasons.push(`dose form "${p.dose_form}" is not a countable unit form; amount per dose unknown`);
    units = null;
  }
  if (ing.value == null || ing.unit !== 'mg') {
    reasons.push(`ingredient strength unit "${ing.unit}" is not mg`);
    units = null;
  }
  if (ing.unitNote || (config.safety.unitSuspectIngredients as readonly string[]).includes(ingNorm)) flags.push('UNIT_UNVERIFIED');
  const daily = units != null && ing.value != null ? units * ing.value : null;
  if (daily != null && flags.includes('UNIT_UNVERIFIED')) reasons.push('source labels this strength "mg" but the ingredient is normally dosed in mcg/IU; total unverified');
  return {
    line_no: l.line_no, brand: p.brand_name, product_id: p.product_id, dose_form: p.dose_form, strength_per_unit: `${ing.value ?? '?'} ${ing.unit ?? ''}`.trim(),
    frequency_raw: f.raw, units_per_day: units, daily_mg: daily, computable: daily != null && !flags.includes('UNIT_UNVERIFIED'), reasons, flags,
  };
}

interface IngredientGroup {
  ingredient: string; lines: ResolvedLine[]; exposures: LineExposure[]; complete: boolean; totalDailyMg: number; lowerBound: boolean;
  ceiling: { value: number; unit: string; basis: string } | null; exceeds: boolean; unitUnverified: boolean;
}

function groupShared(c: Ctx): IngredientGroup[] {
  const map = new Map<string, ResolvedLine[]>();
  for (const l of c.resolved) {
    for (const ing of new Set(l.product!.ingredients.map((i) => i.norm))) {
      const arr = map.get(ing) ?? [];
      arr.push(l);
      map.set(ing, arr);
    }
  }
  const groups: IngredientGroup[] = [];
  for (const [ingredient, lines] of map) {
    if (lines.length < 2) continue;
    const exposures = lines.map((l) => exposureFor(l, ingredient));
    const complete = exposures.every((e) => e.computable);
    const total = exposures.reduce((s, e) => s + (e.daily_mg != null ? e.daily_mg : 0), 0);
    const ref = config.safety.referenceCeilings[ingredient] ?? null;
    groups.push({
      ingredient, lines, exposures, complete, totalDailyMg: total, lowerBound: !complete,
      ceiling: ref ? { value: ref.value, unit: ref.unit, basis: ref.basis } : null,
      exceeds: !!ref && total > ref.value, unitUnverified: exposures.some((e) => e.flags.includes('UNIT_UNVERIFIED')),
    });
  }
  return groups.sort((a, b) => a.ingredient.localeCompare(b.ingredient));
}

const aggregateEvidence = (g: IngredientGroup) => ({
  ingredient: g.ingredient,
  contributing_lines: g.exposures,
  aggregate: {
    total_daily_mg: g.totalDailyMg, is_lower_bound: g.lowerBound, complete: g.complete,
    note: g.complete ? 'Sum over all lines of (units/day x mg per unit), from CDCI strengths and the written dose_frequency.' : 'Lower bound: only lines with a computable schedule are summed; excluded lines are listed with reasons.',
  },
  reference_ceiling: g.ceiling ? { ...g.ceiling, exceeded: g.exceeds, context: 'Cited population reference from the supplied corpus; not patient-specific.', sources: config.safety.referenceCeilings[g.ingredient]!.sources } : null,
});

// ---------- the four checks ----------
function checkDuplicate(c: Ctx): CheckResult {
  const r = base('DUPLICATE_INGREDIENT', 'RAIL.DUP.1', c, ['cdci']);
  const g = dataGuards(c, r, ['cdci']);
  if (g.early) return r;
  const groups = groupShared(c);
  if (groups.length) {
    r.status = 'HIT';
    r.severity = groups.some((x) => x.exceeds) ? 'HIGH' : 'MODERATE';
    r.evidence = groups.map(aggregateEvidence);
    r.affected_ingredients = groups.map((x) => x.ingredient);
    r.affected_products = affected([...new Set(groups.flatMap((x) => x.lines))]);
    r.explanation = groups.map((x) => `${x.ingredient} appears in ${x.lines.length} lines (${x.lines.map((l) => `#${l.line_no} ${l.product!.brand_name}`).join(', ')}); ${x.complete ? `aggregate ${x.totalDailyMg} mg/day` : `aggregate incomplete (lower bound ${x.totalDailyMg} mg/day)`}`).join('. ') + '.';
    r.source_references.push(...[...new Set(groups.flatMap((x) => x.lines))].map(prov));
    if (g.expiredNotes.length) r.limitations.push(...g.expiredNotes.map((n) => `Stale data: ${n}`));
    if (c.unresolved.length) r.limitations.push(`${c.unresolved.length} line(s) could not be resolved and were not examined`);
    return r;
  }
  r.status = noHitStatus(c, r, { expiredNotes: g.expiredNotes, partialReasons: [] });
  r.severity = r.status === 'CHECKED_NO_HIT' ? 'NONE' : r.status === 'DATA_EXPIRED' ? 'MODERATE' : 'INFO';
  r.explanation = {
    CHECKED_NO_HIT: `No active ingredient is shared between any of the ${c.resolved.length} resolved line(s) after decomposition.`,
    DATA_EXPIRED: `No shared ingredient found, but the drug master is past its freshness window: ${g.expiredNotes.join('; ')}.`,
    UNVERIFIED_INPUT: 'No line could be resolved to a drug-master product, so duplicates cannot be assessed.',
    PARTIAL_COVERAGE: `No shared ingredient among the ${c.resolved.length} resolved line(s), but ${c.unresolved.length} line(s) are unresolved and were not examined.`,
  }[r.status as 'CHECKED_NO_HIT'] ?? '';
  r.affected_products = affected(c.resolved);
  r.source_references.push(...c.resolved.map(prov));
  return r;
}

function checkCumulative(c: Ctx): CheckResult {
  const r = base('CUMULATIVE_EXPOSURE', 'RAIL.CUM.1', c, ['cdci']);
  const g = dataGuards(c, r, ['cdci']);
  if (g.early) return r;
  const groups = groupShared(c);
  const partial: string[] = [];
  for (const x of groups) {
    if (!x.complete) partial.push(`${x.ingredient}: ${x.exposures.filter((e) => !e.computable).map((e) => `#${e.line_no} (${e.reasons.join('; ')})`).join(' | ')}`);
    else if (!x.ceiling) partial.push(`${x.ingredient}: total ${x.totalDailyMg} mg/day computed, but the supplied materials give no reference ceiling to judge it against`);
  }
  r.evidence = groups.map(aggregateEvidence);
  r.affected_ingredients = groups.map((x) => x.ingredient);
  r.affected_products = affected([...new Set(groups.flatMap((x) => x.lines))]);
  r.source_references.push(...c.resolved.map(prov));
  const exceeding = groups.filter((x) => x.exceeds);
  if (exceeding.length) {
    r.status = 'HIT';
    r.severity = 'HIGH';
    r.explanation = exceeding.map((x) => `${x.ingredient}: ${x.lowerBound ? 'at least ' : ''}${x.totalDailyMg} mg/day across lines ${x.lines.map((l) => '#' + l.line_no).join(', ')} exceeds the cited reference ${x.ceiling!.value} ${x.ceiling!.unit}/day (${x.ceiling!.basis})`).join('. ') + '.';
    r.limitations.push('Reference ceiling is quoted from the corpus for adults; patient age and weight are not part of the draft.');
    return r;
  }
  r.limitations.push(...partial);
  if (!groups.length) r.explanation = 'No ingredient is shared across lines, so there is nothing to total.';
  else r.explanation = groups.map((x) => `${x.ingredient}: ${x.lowerBound ? 'at least ' : ''}${x.totalDailyMg} mg/day (${x.complete ? 'complete' : 'incomplete'})${x.ceiling ? `; ceiling ${x.ceiling.value} ${x.ceiling.unit}/day ${x.exceeds ? 'EXCEEDED' : 'not exceeded'}` : '; no reference ceiling available'}`).join('. ') + '.';
  r.status = noHitStatus(c, r, { expiredNotes: g.expiredNotes, partialReasons: partial });
  r.severity = r.status === 'CHECKED_NO_HIT' ? 'NONE' : r.status === 'DATA_EXPIRED' ? 'MODERATE' : 'INFO';
  if (r.status === 'DATA_EXPIRED') r.explanation += ` Data past freshness window: ${g.expiredNotes.join('; ')}.`;
  if (r.status === 'PARTIAL_COVERAGE' || r.status === 'UNVERIFIED_INPUT') r.explanation += ' Coverage is incomplete; this is not an all-clear.';
  return r;
}

const REG_SEVERITY: Record<string, Severity> = { PROHIBITED: 'CRITICAL', WITHDRAWN: 'HIGH', RESTRICTED: 'MODERATE', STAYED: 'MODERATE' };

function checkRegulatory(c: Ctx): CheckResult {
  const r = base('PROHIBITED_FDC', 'RAIL.REG.1', c, ['cdci', 'regulatory']);
  const g = dataGuards(c, r, ['cdci', 'regulatory']);
  if (g.early) return r;
  const events = c.data.getRegulatoryEvents();
  if (events.length === 0) return unavailable(r, 'regulatory register is empty');
  const targets: DerivedTarget[] = deriveTargets(events, c.asOf);
  const hits: unknown[] = [];
  const possible: string[] = [];
  const conflicts: string[] = [];
  let top: Severity = 'NONE';
  const rank: Severity[] = ['NONE', 'INFO', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
  const hitLines = new Set<ResolvedLine>();
  for (const l of c.resolved) {
    const { matches } = matchProduct({ product_id: l.product!.product_id, brand_name: l.product!.brand_name, dose_form: l.product!.dose_form, ingredient_norms: l.product!.ingredients.map((i) => i.norm) }, targets);
    for (const m of matches) {
      const t = m.target;
      const ev = {
        line_no: l.line_no, brand: l.product!.brand_name, product_id: l.product!.product_id, target: t.target_description, derived_state: t.state, as_of: c.asOf,
        applicability: m.applicability, applicability_notes: m.reasons, citing_event: t.citing_event, timeline: t.timeline, anomalies: t.anomalies, conflicts: t.conflicts,
      };
      if (t.state === 'SOURCE_CONFLICT') { conflicts.push(`${t.target_description}: ${t.conflicts.join('; ')}`); r.evidence.push(ev); continue; }
      if (t.state === 'NO_EVENT_IN_FORCE') { r.limitations.push(`${t.target_description}: event(s) not yet in force at ${c.asOf}`); continue; }
      if (m.applicability === 'POSSIBLE') {
        possible.push(`#${l.line_no} ${l.product!.brand_name} possibly within "${t.target_description}" (${t.state}): ${m.reasons.join('; ')}`);
        r.evidence.push(ev);
        if (t.citing_event) r.source_references.push({ dataset: 'regulatory', ref: `${t.citing_event.notification_id} (${t.citing_event.event_id})`, version: t.citing_event.effective_date, detail: 'applicability unconfirmed' });
        continue;
      }
      hits.push(ev);
      hitLines.add(l);
      const sev = REG_SEVERITY[t.state] ?? 'MODERATE';
      if (rank.indexOf(sev) > rank.indexOf(top)) top = sev;
      if (t.citing_event) r.source_references.push({ dataset: 'regulatory', ref: `${t.citing_event.notification_id} (${t.citing_event.event_id})`, version: t.citing_event.effective_date, detail: `${t.citing_event.action}, published ${t.citing_event.date_published}, effective ${t.citing_event.effective_date}` });
    }
  }
  r.source_references.push(...c.resolved.map(prov));
  if (hits.length) {
    r.status = 'HIT';
    r.severity = top;
    r.evidence = [...hits, ...r.evidence];
    r.affected_products = affected([...hitLines]);
    r.affected_ingredients = [...new Set([...hitLines].flatMap((l) => l.product!.ingredients.map((i) => i.norm)))];
    r.explanation = (hits as { line_no: number; brand: string; target: string; derived_state: string; citing_event: { notification_id: string; effective_date: string } | null }[])
      .map((h) => `#${h.line_no} ${h.brand} matches "${h.target}": derived status ${h.derived_state} as of ${c.asOf}${h.citing_event ? ` per ${h.citing_event.notification_id}, effective ${h.citing_event.effective_date}` : ''}`).join('. ') + '.';
    if (possible.length) r.limitations.push(...possible);
    if (conflicts.length) r.limitations.push(...conflicts.map((x) => `Source conflict: ${x}`));
    if (g.expiredNotes.length) r.limitations.push(...g.expiredNotes.map((n) => `Stale data: ${n}`));
    return r;
  }
  r.limitations.push(...possible.map((p) => `Unconfirmed: ${p}`));
  r.limitations.push(`Register coverage: ${events.length} loaded events across ${targets.length} targets; this is not the complete national list.`);
  r.status = noHitStatus(c, r, { conflict: conflicts.length > 0, expiredNotes: g.expiredNotes, partialReasons: possible });
  r.severity = r.status === 'CHECKED_NO_HIT' ? 'NONE' : r.status === 'SOURCE_CONFLICT' || r.status === 'DATA_EXPIRED' ? 'MODERATE' : 'INFO';
  r.affected_products = affected(c.resolved);
  r.explanation = {
    CHECKED_NO_HIT: `No resolved product matches any of the ${targets.length} register targets in force at ${c.asOf}.`,
    SOURCE_CONFLICT: `Register events disagree for a matching target: ${conflicts.join('; ')}.`,
    DATA_EXPIRED: `No match, but data is past its freshness window: ${g.expiredNotes.join('; ')}.`,
    UNVERIFIED_INPUT: 'No line could be resolved to a drug-master product, so the register cannot be consulted.',
    PARTIAL_COVERAGE: possible.length ? `Possible matches could not be confirmed: ${possible.join('; ')}.` : `${c.unresolved.length} line(s) are unresolved and were not examined.`,
  }[r.status as 'CHECKED_NO_HIT'] ?? '';
  return r;
}

function checkInteractions(c: Ctx): CheckResult {
  const r = base('SEVERE_INTERACTION', 'RAIL.INT.1', c, ['cdci', 'interactions']);
  const g = dataGuards(c, r, ['cdci', 'interactions']);
  if (g.early) return r;
  const pairs = c.data.getInteractionPairs();
  const vocab = c.data.getIngredientVocab();
  const key = (a: string, b: string) => [a, b].sort().join('|');
  const map = new Map(pairs.map((p) => [key(p.a_norm, p.b_norm), p]));
  const hits: unknown[] = [];
  const hitLines = new Set<ResolvedLine>();
  for (let i = 0; i < c.resolved.length; i++) {
    for (let j = i + 1; j < c.resolved.length; j++) {
      const A = c.resolved[i]!, B = c.resolved[j]!;
      for (const ia of A.product!.ingredients) for (const ib of B.product!.ingredients) {
        if (ia.norm === ib.norm) continue;
        const p = map.get(key(ia.norm, ib.norm));
        if (!p) continue;
        hitLines.add(A); hitLines.add(B);
        hits.push({ pair: [p.a, p.b], seed_severity: p.severity, note: p.note, source_tag: p.source_tag, lines: [{ line_no: A.line_no, brand: A.product!.brand_name, ingredient: ia.name }, { line_no: B.line_no, brand: B.product!.brand_name, ingredient: ib.name }] });
        r.source_references.push({ dataset: 'interactions', ref: `${p.a} + ${p.b}`, version: p.source_tag, batch_id: p.batch_id, source_row_id: p.source_row_id });
      }
    }
  }
  const evaluable = pairs.filter((p) => vocab.has(p.a_norm) && vocab.has(p.b_norm));
  const covered = new Set(pairs.flatMap((p) => [p.a_norm, p.b_norm]));
  const prescribed = [...new Set(c.resolved.flatMap((l) => l.product!.ingredients.map((i) => i.norm)))];
  const uncovered = prescribed.filter((i) => !covered.has(i));
  const coverage = {
    scope: config.safety.interactionCoverageScope, seed_pairs_total: pairs.length, seed_pairs_evaluable_against_drug_master: evaluable.length,
    seed_pairs_not_evaluable: pairs.filter((p) => !vocab.has(p.a_norm) || !vocab.has(p.b_norm)).map((p) => `${p.a} + ${p.b}`),
    prescribed_ingredients_without_any_seed_coverage: uncovered,
  };
  r.limitations.push(`Coverage is the ${pairs.length}-pair seed list only (${evaluable.length} pairs reference ingredients present in the drug master); it is not an exhaustive interaction screen.`);
  r.limitations.push('Draft-only input: no patient medication list, allergies or conditions were supplied, so interactions with medicines outside this draft were not evaluated.');
  r.source_references.push(...c.resolved.map(prov));
  r.affected_products = affected([...hitLines]);
  if (hits.length) {
    r.status = 'HIT';
    r.severity = 'CRITICAL';
    r.evidence = [...hits, { coverage }];
    r.affected_ingredients = [...new Set((hits as { pair: string[] }[]).flatMap((h) => h.pair.map((x) => x.toLowerCase())))];
    r.explanation = (hits as { pair: string[]; note: string; seed_severity: string; lines: { line_no: number; brand: string }[] }[]).map((h) => `${h.pair.join(' + ')} (${h.seed_severity}: ${h.note}) between #${h.lines[0]!.line_no} ${h.lines[0]!.brand} and #${h.lines[1]!.line_no} ${h.lines[1]!.brand}`).join('. ') + '.';
    if (c.unresolved.length) r.limitations.push(`${c.unresolved.length} line(s) could not be resolved and were not examined`);
    if (g.expiredNotes.length) r.limitations.push(...g.expiredNotes.map((n) => `Stale data: ${n}`));
    return r;
  }
  r.evidence = [{ coverage }];
  r.status = noHitStatus(c, r, { expiredNotes: g.expiredNotes, partialReasons: [] });
  r.severity = r.status === 'CHECKED_NO_HIT' ? 'NONE' : r.status === 'DATA_EXPIRED' ? 'MODERATE' : 'INFO';
  r.affected_products = affected(c.resolved);
  r.explanation = {
    CHECKED_NO_HIT: `No pair among the ${c.resolved.length} resolved line(s) appears in the ${pairs.length}-pair severe-interaction seed list. This is a seed-list result, not an exhaustive screen.`,
    DATA_EXPIRED: `No seed-list pair found, but the data is past its freshness window: ${g.expiredNotes.join('; ')}.`,
    UNVERIFIED_INPUT: 'No line could be resolved to a drug-master product, so interactions cannot be assessed.',
    PARTIAL_COVERAGE: `No seed-list pair among resolved lines, but ${c.unresolved.length} line(s) are unresolved and were not examined.`,
    SOURCE_CONFLICT: '',
  }[r.status as 'CHECKED_NO_HIT'] ?? '';
  return r;
}

const RUNNERS: Record<CheckType, (c: Ctx) => CheckResult> = {
  DUPLICATE_INGREDIENT: checkDuplicate,
  PROHIBITED_FDC: checkRegulatory,
  SEVERE_INTERACTION: checkInteractions,
  CUMULATIVE_EXPOSURE: checkCumulative,
};
const RULE_IDS: Record<CheckType, string> = { DUPLICATE_INGREDIENT: 'RAIL.DUP.1', PROHIBITED_FDC: 'RAIL.REG.1', SEVERE_INTERACTION: 'RAIL.INT.1', CUMULATIVE_EXPOSURE: 'RAIL.CUM.1' };

export function runSafetyRail(lines: ResolvedLine[], data: RailData, opts: RailOptions): RailReport {
  const now = opts.now ?? new Date();
  const executedAt = now.toISOString();
  let versions: DatasetVersionInfo[] = [];
  let versionError: string | null = null;
  try {
    versions = data.getDataVersions();
  } catch (e) {
    versionError = (e as Error).message;
  }
  const fingerprint = versionError ? 'dv-unavailable' : fingerprintOf(versions);
  const resolved = lines.filter((l) => l.product && l.resolution.status === 'RESOLVED');
  const ctx: Ctx = { lines, resolved, unresolved: lines.filter((l) => !(l.product && l.resolution.status === 'RESOLVED')), data, versions, fingerprint, asOf: opts.asOf, executedAt };
  const wanted = opts.checks ?? [...CHECK_TYPES];
  const checks: CheckResult[] = CHECK_TYPES.map((t) => {
    const r0 = base(t, RULE_IDS[t], ctx, []);
    if (!wanted.includes(t)) {
      r0.explanation = 'This check was not requested for this run.';
      r0.limitations.push('NOT_CHECKED: excluded by the caller');
      return r0;
    }
    if (lines.length === 0) {
      r0.explanation = 'The draft prescription is empty; nothing was checked.';
      return r0;
    }
    if (versionError) return unavailable(r0, `data store unavailable (${versionError})`);
    try {
      return RUNNERS[t](ctx);
    } catch (e) {
      return unavailable(r0, `check raised an error: ${(e as Error).message}`);
    }
  });
  const counts: Record<string, number> = {};
  for (const ch of checks) counts[ch.status] = (counts[ch.status] ?? 0) + 1;
  const allClean = checks.every((x) => x.status === 'CHECKED_NO_HIT');
  return {
    report_type: 'BRAHMO_SAFETY_RAIL_REPORT',
    rule_version: config.versions.safetyRules, data_version: fingerprint, as_of: opts.asOf, executed_at: executedAt, llm_used_in_safety_path: false,
    data_versions: versions,
    lines: lines.map((l) => ({
      line_no: l.line_no, written_product: l.input.written_product, strength_as_written: l.input.strength_as_written ?? null, dose_frequency: l.input.dose_frequency ?? null,
      resolution: l.resolution, product_id: l.product?.product_id ?? null, resolved_brand: l.product?.brand_name ?? null,
      ingredients: (l.product?.ingredients ?? []).map((i) => ({ name: i.name, strength: `${i.value ?? '?'} ${i.unit ?? ''}`.trim() })),
    })),
    checks,
    summary: {
      counts, critical_findings: checks.filter((x) => x.status === 'HIT' && x.severity === 'CRITICAL').length, all_checks_clean: allClean,
      statement: allClean
        ? 'All four checks ran with the stated coverage and found nothing. This is a statement about the loaded data only, not clinical clearance; the doctor remains responsible for the prescription.'
        : 'One or more checks produced a finding or could not run to completion. Absence of a finding in any other check is not clearance. The doctor remains responsible for the prescription.',
    },
  };
}
