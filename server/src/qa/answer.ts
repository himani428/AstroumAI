import type { Db } from '../db/connection.js';
import { all } from '../db/connection.js';
import { config } from '../config.js';
import { CorpusIndex, expand, stem, tokenize, type Filters, type Hit, type IndexedChunk } from '../corpus/retrieval.js';
import { deriveTargets } from '../regulatory/status.js';
import type { RegEvent } from '../regulatory/types.js';
import type { AnswerBlock, Abstention, Citation, Claim, ConflictSet, QaResult, RegisterCitation } from './types.js';

const SOURCE_LABEL = {
  NATIONAL_STW: 'National workflow (STW one-pager pack)',
  LOCAL_PROTOCOL: "Clinic's own protocol (Sunrise Multi-speciality Clinic), NOT national guidance",
  REGISTER: 'Regulatory register (event-sourced)',
} as const;

const GENERIC = new Set(config.retrieval.genericTerms.map((t) => stem(t.toLowerCase())));
const CHILD_RE = /\b(child|children|paediatric|pediatric|infant|toddler|neonate|kids?)\b|\b([0-9]|1[0-7])\s*-?\s*year[s]?\s*-?\s*old\b|\bage[d]?\s*([0-9]|1[0-7])\b/i;
const ADULT_RE = /\b(adults?|grown-?ups?)\b|\b(1[89]|[2-9][0-9])\s*-?\s*year[s]?\s*-?\s*old\b/i;

export const cite = (c: IndexedChunk): Citation => ({
  kind: 'CORPUS', chunk_id: c.chunk_id, doc_code: c.doc_code, title: c.title, version: c.version, effective_date: c.effective_date, doc_status: c.status, source_type: c.source_type,
  source_label: SOURCE_LABEL[c.source_type as 'NATIONAL_STW'] ?? c.source_type, page: c.page, section: c.section, anchor: c.anchor, excerpt: c.text,
});

interface Selection {
  ok: boolean; chunks: IndexedChunk[]; coverage: number; salient: string[]; unmatched: string[]; hits: Hit[]; reason?: string; bestDocCode?: string;
  nearest: { doc_code: string; title: string; version: string }[];
}

function populationOf(c: IndexedChunk): 'child' | 'adult' | 'unknown' {
  const t = `${c.title} ${c.condition_label}`;
  if (/\bchild|paediatric|pediatric\b/i.test(t)) return 'child';
  if (/\badult\b/i.test(t) || c.source_type === 'LOCAL_PROTOCOL') return 'adult';
  return 'unknown';
}

/** Topic-coverage + population gate, then decision-unit selection inside the best-supported document. */
export function selectEvidence(index: CorpusIndex, query: string, filters: Filters, opts: { preferStatus?: string[]; docCode?: string } = {}): Selection {
  const hits = index.search(query, { ...filters, ...(opts.docCode ? { doc_code: opts.docCode } : {}) }, 40);
  const qTokens = tokenize(query);
  const salient = [...new Set(qTokens.filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length > 1))];
  const nearest = (h: Hit[]) => [...new Map(h.slice(0, 3).map((x) => [x.chunk.doc_id, { doc_code: x.chunk.doc_code, title: x.chunk.title, version: x.chunk.version }])).values()];
  if (!hits.length) return { ok: false, chunks: [], coverage: 0, salient, unmatched: salient, hits, reason: 'NO_RETRIEVAL_RESULT', nearest: [] };

  const byDoc = new Map<number, Hit[]>();
  for (const h of hits) byDoc.set(h.chunk.doc_id, [...(byDoc.get(h.chunk.doc_id) ?? []), h]);
  const ranked = [...byDoc.entries()].map(([id, hs]) => {
    const preferred = opts.preferStatus && opts.preferStatus.includes(hs[0]!.chunk.status) ? 0.001 : 0;
    return { id, hs, s: hs[0]!.score + 0.5 * (hs[1]?.score ?? 0) + preferred };
  }).sort((a, b) => b.s - a.s);
  const best = ranked[0]!;
  const doc0 = best.hs[0]!.chunk;
  const matchTerm = (t: string) => doc0.docTokens.has(t) || expand([t]).some((x) => doc0.docTokens.has(x));
  const unmatched = salient.filter((t) => !matchTerm(t));
  const coverage = salient.length ? (salient.length - unmatched.length) / salient.length : 1;
  const scopeVocab = index.vocabFor(filters);
  const absentEverywhere = unmatched.filter((t) => !expand([t]).some((x) => scopeVocab.has(x)));
  const base = { coverage, salient, unmatched: absentEverywhere.length ? absentEverywhere : unmatched, hits, nearest: nearest(hits), bestDocCode: doc0.doc_code };

  // A long, specific topic word that exists nowhere in the corpus (e.g. "undifferentiated", "prophylactic") means no workflow covers it.
  const specificAbsent = absentEverywhere.filter((t) => t.length >= config.retrieval.topicTermMinLength - 1 && !config.retrieval.abstentionExemptTerms.includes(t));
  if (specificAbsent.length) return { ok: false, chunks: [], reason: 'TOPIC_NOT_IN_CORPUS', ...base, unmatched: specificAbsent };
  if (coverage < config.retrieval.minDocSupport || best.hs[0]!.score < 0.2)
    return { ok: false, chunks: [], reason: absentEverywhere.length ? 'TOPIC_NOT_IN_CORPUS' : 'INSUFFICIENT_SUPPORT', ...base };
  const qChild = CHILD_RE.test(query), qAdult = ADULT_RE.test(query);
  const dp = populationOf(doc0);
  if ((qChild && !qAdult && dp === 'adult') || (qAdult && !qChild && dp === 'child'))
    return { ok: false, chunks: [], reason: 'POPULATION_MISMATCH', ...base };

  // Decision-unit selection within the best document: rank by the chunk's own score; add further units only when they are
  // close to the top or contribute a question term the already-selected units do not cover.
  // Residual terms = question topic words the document title does not already satisfy (e.g. the drug named in the question).
  const residual = salient.filter((t) => !doc0.titleTokens.has(t));
  const resBoost = (h: Hit) => residual.length ? config.retrieval.residualTermBoost * (residual.filter((t) => h.chunk.textTokens.has(t) || expand([t]).some((x) => h.chunk.textTokens.has(x))).length / residual.length) : 0;
  for (const h of best.hs) h.chunkScore += resBoost(h);
  const inDoc = [...best.hs].sort((a, b) => b.chunkScore - a.chunkScore);
  const top = inDoc[0]!;
  if (top.chunkScore < config.retrieval.minChunkScore) return { ok: false, chunks: [], reason: 'INSUFFICIENT_SUPPORT', ...base };
  const picked = new Map<number, IndexedChunk>([[top.chunk.chunk_id, top.chunk]]);
  const covered = new Set(residual.filter((t) => top.chunk.textTokens.has(t) || expand([t]).some((x) => top.chunk.textTokens.has(x))));
  for (const h of inDoc.slice(1)) {
    if (picked.size >= 4) break;
    const newTerms = residual.filter((t) => !covered.has(t) && (h.chunk.textTokens.has(t) || expand([t]).some((x) => h.chunk.textTokens.has(x))));
    if (h.chunkScore >= top.chunkScore * config.retrieval.chunkRelativeThreshold || (newTerms.length && h.chunkScore >= top.chunkScore * config.retrieval.newTermRelativeThreshold)) {
      picked.set(h.chunk.chunk_id, h.chunk);
      newTerms.forEach((t) => covered.add(t));
    }
  }
  // Completeness for lists where omitting an item would mislead (red flags, avoid/do-not).
  if (top.chunk.kind === 'red_flag' || top.chunk.kind === 'contraindication')
    for (const c of index.chunks) if (c.doc_id === top.chunk.doc_id && c.section === top.chunk.section) picked.set(c.chunk_id, c);
  return { ok: true, chunks: [...picked.values()].sort((a, b) => a.chunk_id - b.chunk_id), ...base };
}

const claimsOf = (chunks: IndexedChunk[], prefix: string): Claim[] => chunks.map((c, i) => ({ id: `${prefix}${i + 1}`, text: c.text, citations: [cite(c)] }));

const REASON_TEXT: Record<string, string> = {
  TOPIC_NOT_IN_CORPUS: 'The supplied corpus does not contain a workflow covering this topic.',
  INSUFFICIENT_SUPPORT: 'No single document in the corpus covers enough of the question to support an answer.',
  POPULATION_MISMATCH: 'The closest workflow is written for a different patient population than the one asked about.',
  NO_RETRIEVAL_RESULT: 'Retrieval returned nothing for this question.',
};

function abstain(sel: Selection, label: string, scope: string): Abstention {
  return {
    reason_code: sel.reason ?? 'INSUFFICIENT_SUPPORT',
    explanation: `${REASON_TEXT[sel.reason ?? 'INSUFFICIENT_SUPPORT']} Cannot verify an answer from ${scope}.`,
    missing_evidence: sel.unmatched.length ? sel.unmatched.map((t) => `no occurrence of "${t}" in the ${label} evidence`) : ['no supporting decision unit found'],
    nearest_sources: sel.nearest.map((n) => ({ ...n, note: 'Nearest retrieved document; it does not answer the question and no claim is drawn from it.' })),
  };
}

function structuredAnswer(db: Db, question: string, asOf: string): AnswerBlock | null {
  if (!/(banned|prohibit|gazette|notification|legal|regulat|restrict|withdrawn|stay)/i.test(question)) return null;
  const rows = all<Record<string, unknown>>(db, 'SELECT * FROM regulatory_events');
  const events: RegEvent[] = rows.map((r) => ({
    event_id: r.event_id as string, notification_id: r.notification_id as string, date_published: r.date_published as string, effective_date: r.effective_date as string, action: r.action as string,
    target_type: r.target_type as string, target_description: r.target_description as string, supersedes_event_id: (r.supersedes_event_id as string) || null, note: (r.note as string) || null,
    target_key: r.target_key as string, target: JSON.parse(r.target_json as string),
  }));
  const qt = new Set(tokenize(question));
  const targets = deriveTargets(events, asOf).filter((t) => t.target.components.every((c) => c.split(' ').every((w) => qt.has(stem(w)))));
  const block: AnswerBlock = { block_id: 'reg', label: 'Regulatory status (answered from the register, not from clinical documents)', source_type: 'REGISTER', source_label: SOURCE_LABEL.REGISTER, status: 'ANSWERED', claims: [] };
  if (!targets.length) {
    block.status = 'ABSTAINED';
    block.abstention = { reason_code: 'NO_MATCHING_REGISTER_TARGET', explanation: `No register target matches the named product or ingredient. The register holds ${events.length} events only; absence is not evidence that a product is unrestricted.`, missing_evidence: ['matching regulatory event'], nearest_sources: [] };
    return block;
  }
  targets.forEach((t, i) => {
    const ce = t.citing_event;
    const evs = t.timeline;
    const cites: RegisterCitation[] = evs.map((e) => ({ kind: 'REGISTER', as_of: asOf, event_id: e.event_id, notification_id: e.notification_id, action: e.action, effective_date: e.effective_date, date_published: e.date_published, target: t.target_description, source_label: SOURCE_LABEL.REGISTER }));
    block.claims.push({ id: `r${i + 1}`, text: `${t.target_description}: derived status ${t.state} as of ${asOf}${ce ? ` (${ce.notification_id}, effective ${ce.effective_date})` : ''}. History: ${evs.map((e) => `${e.event_id} ${e.action} eff. ${e.effective_date}`).join('; ')}.`, citations: cites });
  });
  return block;
}

/** Drops parenthetical asides and trailing imperative instructions ("Label your sources.") so they are not treated as topic terms. */
export function retrievalQuery(q: string): string {
  return q.replace(/\([^)]*\)/g, ' ').replace(/(?:^|\s)(?:Label|Cite|Retrieve|Note|Show|Explain)\b[^.?]*[.?]?\s*$/i, ' ').replace(/\s+/g, ' ').trim();
}

export interface AnswerDeps { db: Db; index: CorpusIndex; asOf?: string }

export function answerQuestion(deps: AnswerDeps, question: string): QaResult {
  const { db, index } = deps;
  const q = question.trim();
  const rq = retrievalQuery(q);
  const intent: string[] = [];
  const notes: string[] = [];
  const blocks: AnswerBlock[] = [];
  const conflicts: ConflictSet[] = [];
  const queries: QaResult['retrieval']['queries'] = [];
  const localIntent = /\b(clinic|clinic's|clinics|local|sop|sunrise|our protocol|own protocol)\b/i.test(q);
  const nationalIntent = /\b(national|workflow pack|stw|pack say|icmr)\b/i.test(q) || !localIntent;
  const doseIntent = /\b(dose|dosing|dosage|mg|ml|how much)\b/i.test(q);
  const calcIntent = /\b(calculate|compute|work out)\b/i.test(q) || (/\b\d+(\.\d+)?\s*kg\b/i.test(q) && doseIntent);
  if (doseIntent) intent.push('DOSE_TEXT_AS_WRITTEN');
  if (calcIntent) {
    intent.push('PATIENT_SPECIFIC_CALCULATION_REQUESTED');
    notes.push('Patient-specific dose calculation is outside this system (law 12). Any dose below is the workflow text as written; no amount has been computed for an individual patient.');
  } else if (doseIntent) {
    notes.push('Dose statements are reproduced verbatim from the cited workflow. No per-patient amount is calculated.');
  }

  const reg = structuredAnswer(db, rq, deps.asOf ?? config.demo.asOf);
  if (reg) { intent.push('STRUCTURED_FACT'); blocks.push(reg); }

  const run = (scope: 'NATIONAL_STW' | 'LOCAL_PROTOCOL', label: string, status?: string[]) => {
    const sel = selectEvidence(index, rq, { source_type: scope, ...(status ? { status } : {}) }, { preferStatus: ['CURRENT', 'LOCAL_PROTOCOL'] });
    queries.push({ scope, salient_terms: sel.salient, unmatched_terms: sel.unmatched, coverage: Math.round(sel.coverage * 100) / 100, top: sel.hits.slice(0, 5).map((h) => ({ chunk_id: h.chunk.chunk_id, doc_code: h.chunk.doc_code, version: h.chunk.version, anchor: h.chunk.anchor, lexical: +h.lexical.toFixed(3), semantic: +h.semantic.toFixed(3), score: +h.score.toFixed(3) })) });
    return { sel, label };
  };

  if (localIntent) {
    intent.push('LOCAL_PROTOCOL');
    const { sel } = run('LOCAL_PROTOCOL', 'clinic protocol');
    const blk: AnswerBlock = { block_id: 'local', label: "Clinic's own protocol", source_type: 'LOCAL_PROTOCOL', source_label: SOURCE_LABEL.LOCAL_PROTOCOL, status: sel.ok ? 'ANSWERED' : 'ABSTAINED', claims: [] };
    if (sel.ok) blk.claims = claimsOf(sel.chunks, 'l'); else blk.abstention = abstain(sel, 'clinic protocol', "the clinic's protocol");
    blocks.push(blk);
  }
  if (nationalIntent && !(reg && !/\b(first|treat|therapy|regimen|antibiotic)\b/i.test(q))) {
    if (localIntent) intent.push('NATIONAL_COMPARISON'); else intent.push('NATIONAL_WORKFLOW');
    const { sel } = run('NATIONAL_STW', 'national pack');
    const blk: AnswerBlock = { block_id: 'national', label: 'National workflow pack (STW)', source_type: 'NATIONAL_STW', source_label: SOURCE_LABEL.NATIONAL_STW, status: sel.ok ? 'ANSWERED' : 'ABSTAINED', claims: [] };
    if (sel.ok) {
      // Primary answer from the CURRENT edition when several editions of the same workflow exist.
      const siblings = [...new Set(index.chunks.filter((c) => c.doc_code === sel.bestDocCode && c.source_type === 'NATIONAL_STW').map((c) => c.doc_id))];
      const current = sel.chunks[0]!;
      if (siblings.length > 1) {
        const versions: ConflictSet['versions'] = [];
        for (const docId of siblings) {
          const d = index.chunks.find((c) => c.doc_id === docId)!;
          const s2 = selectEvidence(index, q, { source_type: 'NATIONAL_STW' }, { docCode: d.doc_code });
          const pick = s2.chunks.filter((c) => c.doc_id === docId);
          const fallback = pick.length ? pick : index.search(q, { doc_code: d.doc_code }, 12).filter((h) => h.chunk.doc_id === docId).slice(0, 3).map((h) => h.chunk);
          versions.push({ doc_code: d.doc_code, title: d.title, version: d.version, effective_date: d.effective_date, doc_status: d.status, claims: claimsOf(fallback, `v${d.version}-`) });
        }
        versions.sort((a, b) => (b.effective_date ?? '').localeCompare(a.effective_date ?? ''));
        conflicts.push({ topic: current.condition_label ?? current.title, kind: 'EDITION_DIFFERENCE', versions, note: 'The pack holds more than one edition of this workflow. Both are shown with their dates and are not merged. The newer page declares that it supersedes the older one and the older page carries an archive notice; that metadata is reported, not re-judged.' });
        const cur = versions.find((v) => v.doc_status === 'CURRENT');
        blk.claims = cur ? cur.claims : claimsOf(sel.chunks, 'n');
        blk.label = `National workflow pack (STW): current edition ${cur?.version ?? ''}`;
        notes.push('Several editions of this workflow exist; see the edition comparison below.');
      } else blk.claims = claimsOf(sel.chunks, 'n');
    } else {
      blk.abstention = abstain(sel, 'national pack', 'the supplied STW pack');
      if (localIntent) blk.abstention.explanation += ' Whether the national workflow agrees with the clinic protocol therefore cannot be confirmed; the divergence is unknown, not absent.';
    }
    blocks.push(blk);
  }

  // Guard (G6): every numeric token in every claim must appear in its own cited excerpt; claims without citations are dropped.
  let checked = 0, dropped = 0;
  const bad: string[] = [];
  const guardClaims = (cl: Claim[]) => cl.filter((c) => {
    if (!c.citations.length) { dropped++; return false; }
    const hay = c.citations.map((x) => (x.kind === 'CORPUS' ? x.excerpt : `${x.event_id} ${x.notification_id} ${x.effective_date} ${x.date_published} ${x.target} ${x.as_of}`)).join(' ');
    for (const m of c.text.match(/\d+(?:\.\d+)?/g) ?? []) { checked++; if (!hay.includes(m)) bad.push(`${c.id}:${m}`); }
    return true;
  });
  for (const b of blocks) b.claims = guardClaims(b.claims);
  for (const c of conflicts) for (const v of c.versions) v.claims = guardClaims(v.claims);

  const answered = blocks.filter((b) => b.status === 'ANSWERED' && b.claims.length);
  const outcome: QaResult['outcome'] = !answered.length ? 'ABSTAINED' : answered.length < blocks.length ? 'PARTIAL' : 'ANSWERED';
  return {
    question: q, intent, outcome, blocks, conflicts, notes,
    guard: { numeric_tokens_checked: checked, ungrounded_numbers: bad, claims_without_citation_dropped: dropped, passed: bad.length === 0 },
    retrieval: { index_chunks: index.chunks.length, strategy: 'BM25 + character-trigram TF-IDF (local semantic approximation), weights from config; topic-coverage and population gates before answering', queries },
    composer: { mode: 'EXTRACTIVE', provider: 'none', model: null, prompt_version: null },
    versions: { retrieval: config.versions.retrieval, answerer: config.versions.answerer },
  };
}
