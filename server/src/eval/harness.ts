import type { Db } from '../db/connection.js';
import { run } from '../db/connection.js';
import { config } from '../config.js';
import { CorpusIndex } from '../corpus/retrieval.js';
import { answerQuestion } from '../qa/answer.js';
import type { Claim, QaResult } from '../qa/types.js';
import { nowIso } from '../util/text.js';
import { CRITERIA, type Criteria } from './criteria.js';

export type Outcome = 'CORRECT' | 'CORRECTLY_ABSTAINED' | 'WRONG';
export interface EvalResult {
  id: string; set: string; question: string; expected: string; outcome: Outcome; explanation: string; checks: { name: string; pass: boolean; detail?: string }[];
  response: QaResult; retrieved_evidence: { chunk_id: number; doc_code: string; version: string; anchor: string; score: number }[];
}
export interface EvalRun { created_at: string; versions: Record<string, string>; totals: Record<string, number>; core_totals: Record<string, number>; results: EvalResult[]; disclaimer: string }

const text = (cl: Claim[]) => cl.map((c) => c.text).join(' \n ');

export function evaluateOne(c: Criteria, r: QaResult): EvalResult {
  const checks: { name: string; pass: boolean; detail?: string }[] = [];
  const add = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail });
  add('citation guard passed (G6)', r.guard.passed, r.guard.ungrounded_numbers.join(', '));
  add('every claim has a citation', r.blocks.every((b) => b.claims.every((cl) => cl.citations.length > 0)));
  for (const be of c.blocks) {
    const b = r.blocks.find((x) => x.block_id === be.block_id);
    if (!b) { add(`block ${be.block_id} present`, false); continue; }
    add(`block ${be.block_id} is ${be.status}`, b.status === be.status, `actual ${b.status}`);
    if (be.status === 'ABSTAINED') add(`block ${be.block_id} states what is missing`, !!b.abstention && b.abstention.missing_evidence.length > 0);
    if (b.status === 'ANSWERED') {
      const t = text(b.claims);
      for (const re of be.include ?? []) add(`${be.block_id} includes ${re}`, re.test(t));
      for (const re of be.exclude ?? []) add(`${be.block_id} excludes ${re}`, !re.test(t));
      for (const ci of be.cite ?? []) add(`${be.block_id} cites ${ci.doc_code} v${ci.version}`, b.claims.some((cl) => cl.citations.some((x) => x.kind === 'CORPUS' && x.doc_code === ci.doc_code && x.version === ci.version)));
      if (be.block_id === 'local') add('local answer labelled as clinic protocol', b.source_type === 'LOCAL_PROTOCOL' && /clinic/i.test(b.source_label));
    }
  }
  if (c.conflict) {
    const cs = r.conflicts.find((x) => x.versions[0]?.doc_code === c.conflict!.doc_code);
    add('conflicting editions shown', !!cs && cs.versions.length >= 2);
    for (const [ver, res] of Object.entries(c.conflict.versions)) {
      const v = cs?.versions.find((x) => x.version === ver);
      add(`edition ${ver} shown with date`, !!v && !!v.effective_date);
      for (const re of res) add(`edition ${ver} includes ${re}`, !!v && re.test(text(v.claims)));
    }
  }
  for (const re of c.notes_include ?? []) add(`notes include ${re}`, r.notes.some((n) => re.test(n)));
  const failed = checks.filter((x) => !x.pass);
  let outcome: Outcome;
  let explanation: string;
  if (failed.length === 0) {
    outcome = c.expect === 'ABSTAIN' ? 'CORRECTLY_ABSTAINED' : 'CORRECT';
    explanation = c.expect === 'ABSTAIN' ? `Abstained as expected: ${c.rationale}` : `All ${checks.length} checks passed: ${c.rationale}`;
  } else {
    outcome = 'WRONG';
    const abstainedWrongly = c.expect !== 'ABSTAIN' && r.outcome === 'ABSTAINED';
    const answeredWrongly = c.expect === 'ABSTAIN' && r.outcome !== 'ABSTAINED';
    explanation = `${abstainedWrongly ? 'False abstention. ' : answeredWrongly ? 'Answered when the corpus cannot support an answer. ' : ''}Failed: ${failed.map((f) => f.name).join('; ')}`;
  }
  const top = r.retrieval.queries.flatMap((q) => q.top).slice(0, 8).map((t) => ({ chunk_id: t.chunk_id, doc_code: t.doc_code, version: t.version, anchor: t.anchor, score: t.score }));
  return { id: c.id, set: c.set, question: c.question, expected: c.expect, outcome, explanation, checks, response: r, retrieved_evidence: top };
}

const tally = (rs: EvalResult[]) => ({ total: rs.length, correct: rs.filter((x) => x.outcome === 'CORRECT').length, correctly_abstained: rs.filter((x) => x.outcome === 'CORRECTLY_ABSTAINED').length, wrong: rs.filter((x) => x.outcome === 'WRONG').length });

export function runEvaluation(db: Db, opts: { persist?: boolean } = {}): EvalRun {
  const index = CorpusIndex.build(db);
  const results = CRITERIA.map((c) => evaluateOne(c, answerQuestion({ db, index }, c.question)));
  const out: EvalRun = {
    created_at: nowIso(),
    versions: { retrieval: config.versions.retrieval, answerer: config.versions.answerer, criteria: config.versions.evalCriteria, chunker: config.versions.chunker },
    totals: tally(results), core_totals: tally(results.filter((r) => r.set === 'core')), results,
    disclaimer: 'Criteria were written by the builder from the supplied corpus. This measures retrieval, citation and abstention behaviour against that self-authored key; it is not an independent or clinical accuracy figure.',
  };
  if (opts.persist !== false) {
    const t = out.totals as Record<string, number>;
    run(db, 'INSERT INTO eval_runs (created_at, versions_json, total, correct, abstained, wrong, results_json) VALUES (?,?,?,?,?,?,?)', out.created_at, JSON.stringify(out.versions), t.total, t.correct, t.correctly_abstained, t.wrong, JSON.stringify(out));
  }
  return out;
}

export function evalMarkdown(e: EvalRun): string {
  const c = e.core_totals, t = e.totals;
  const lines = [
    '# Module B evaluation report', '', `Run at: ${e.created_at}`, `Versions: ${Object.entries(e.versions).map(([k, v]) => `${k}=${v}`).join(', ')}`, '',
    `**Core (11 sample questions):** ${c.correct} correct, ${c.correctly_abstained} correctly abstained, ${c.wrong} wrong (of ${c.total}).`,
    `**All (core + supplementary):** ${t.correct} correct, ${t.correctly_abstained} correctly abstained, ${t.wrong} wrong (of ${t.total}).`, '', `> ${e.disclaimer}`, '',
    '| ID | Set | Expected | Outcome | Explanation |', '|---|---|---|---|---|',
  ];
  for (const r of e.results) lines.push(`| ${r.id} | ${r.set} | ${r.expected} | ${r.outcome} | ${r.explanation.replace(/\|/g, '/')} |`);
  return lines.join('\n') + '\n';
}
