import type { Db } from '../db/connection.js';
import { all } from '../db/connection.js';
import { config } from '../config.js';

export interface IndexedChunk {
  chunk_id: number; doc_id: number; doc_code: string; title: string; version: string; effective_date: string | null; status: string; source_type: string;
  specialty: string | null; condition_label: string | null; page: number | null; anchor: string; section: string | null; kind: string; text: string; issuer: string | null;
  tokens: string[]; docTokens: Set<string>; titleTokens: Set<string>; textTokens: Set<string>;
}
export interface Filters { source_type?: string; specialty?: string; status?: string[]; doc_code?: string }
export interface Hit { chunk: IndexedChunk; lexical: number; semantic: number; chunkScore: number; docPrior: number; score: number }

const STOP = new Set('a an the of in on for to and or is are was were be been with without at by from as that this it its into than then if do does did what which who whom when how per not no any can may must should after before while'.split(' '));

export function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('es') && /(ss|x|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !/(ss|is|us)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function tokenize(s: string, opts: { stopwords?: boolean } = {}): string[] {
  return s.toLowerCase().replace(/[‑–—]/g, ' ').split(/[^a-z0-9%]+/).filter(Boolean).filter((t) => !(opts.stopwords !== false && STOP.has(t))).map(stem);
}

export function expand(tokens: string[]): string[] {
  const out = [...tokens];
  for (const t of tokens) for (const syn of config.retrieval.synonyms[t] ?? []) out.push(...tokenize(syn));
  return out;
}

export function intentBoost(query: string, c: { kind: string; text: string }): number {
  let b = 0;
  for (const r of config.retrieval.intentBoosts) {
    if (!new RegExp(r.query, 'i').test(query)) continue;
    if ((r.kind && c.kind === r.kind) || (r.text && new RegExp(r.text, 'i').test(c.text))) b += r.boost;
  }
  for (const p of config.retrieval.intentPenalties) if (new RegExp(p.query, 'i').test(query) && p.kinds.includes(c.kind)) b -= p.penalty;
  return Math.min(b, 0.3);
}

const grams = (s: string, n: number): Map<string, number> => {
  const t = ` ${tokenize(s, { stopwords: false }).join(' ')} `;
  const m = new Map<string, number>();
  for (let i = 0; i + n <= t.length; i++) { const g = t.slice(i, i + n); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
};

/** In-memory hybrid index: BM25 (lexical) + character n-gram TF-IDF cosine (local semantic approximation). */
export class CorpusIndex {
  chunks: IndexedChunk[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private gdf = new Map<string, number>();
  private gvec: { m: Map<string, number>; norm: number }[] = [];
  vocab = new Set<string>();
  docFreq(t: string): number { return this.df.get(t) ?? 0; }
  /** Vocabulary of the documents that satisfy the given source filter (so national questions are not 'covered' by the local protocol). */
  vocabFor(filters: Filters): Set<string> {
    const v = new Set<string>();
    for (const c of this.chunks) if (!filters.source_type || c.source_type === filters.source_type) c.docTokens.forEach((t) => v.add(t));
    return v;
  }

  static build(db: Db): CorpusIndex {
    const idx = new CorpusIndex();
    const rows = all<Record<string, unknown>>(db, `SELECT c.id chunk_id, c.doc_id, d.doc_code, d.title, d.version, d.effective_date, d.status, d.source_type, d.specialty, d.condition_label, d.issuer,
        c.page, c.anchor, c.section, c.kind, c.text FROM corpus_chunks c JOIN corpus_documents d ON d.id = c.doc_id ORDER BY c.id`);
    const docText = new Map<number, string[]>();
    for (const r of rows) {
      const toks = tokenize(`${r.text}`);
      const l = docText.get(r.doc_id as number) ?? [];
      l.push(...toks, ...tokenize(`${r.title} ${r.condition_label}`));
      docText.set(r.doc_id as number, l);
    }
    for (const r of rows) {
      const ch: IndexedChunk = { ...(r as object), tokens: [], docTokens: new Set(docText.get(r.doc_id as number)), titleTokens: new Set(), textTokens: new Set() } as unknown as IndexedChunk;
      // Chunk ranking uses the chunk's OWN text and section only. Title/condition tokens feed a separate document prior,
      // otherwise every bullet of the right document ties and the decision unit cannot be chosen.
      ch.tokens = [...tokenize(ch.text), ...tokenize(ch.section ?? '')];
      ch.titleTokens = new Set(tokenize(`${ch.title} ${ch.condition_label}`));
      ch.textTokens = new Set(ch.tokens);
      idx.chunks.push(ch);
    }
    const n = idx.chunks.length;
    idx.chunks.forEach((c) => {
      const tf = new Map<string, number>();
      c.tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      idx.tf.push(tf); idx.len.push(c.tokens.length);
      for (const t of tf.keys()) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
      c.docTokens.forEach((t) => idx.vocab.add(t));
      const g = grams(`${c.section} ${c.text}`, config.retrieval.ngram);
      idx.gvec.push({ m: g, norm: 0 });
      for (const k of g.keys()) idx.gdf.set(k, (idx.gdf.get(k) ?? 0) + 1);
    });
    idx.avgLen = idx.len.reduce((a, b) => a + b, 0) / Math.max(1, n);
    idx.gvec.forEach((v) => { let s = 0; for (const [k, c] of v.m) { const w = c * Math.log(1 + n / (idx.gdf.get(k) ?? 1)); s += w * w; } v.norm = Math.sqrt(s); });
    return idx;
  }

  search(query: string, filters: Filters = {}, k: number = config.retrieval.topK): Hit[] {
    const n = this.chunks.length;
    const qt = expand(tokenize(query));
    const { k1, b } = config.retrieval.bm25;
    const qg = grams(query, config.retrieval.ngram);
    let qn = 0;
    for (const [g, c] of qg) { const w = c * Math.log(1 + n / (this.gdf.get(g) ?? 1)); qn += w * w; }
    qn = Math.sqrt(qn) || 1;
    const raw: { i: number; lex: number; sem: number }[] = [];
    this.chunks.forEach((c, i) => {
      if (filters.source_type && c.source_type !== filters.source_type) return;
      if (filters.specialty && c.specialty !== filters.specialty) return;
      if (filters.status && !filters.status.includes(c.status)) return;
      if (filters.doc_code && c.doc_code !== filters.doc_code) return;
      let lex = 0;
      const tf = this.tf[i]!;
      for (const t of new Set(qt)) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (n - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        lex += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.len[i]!) / this.avgLen)));
      }
      let dot = 0;
      const v = this.gvec[i]!;
      for (const [g, c2] of qg) { const dv = v.m.get(g); if (dv) { const idf = Math.log(1 + n / (this.gdf.get(g) ?? 1)); dot += c2 * idf * dv * idf; } }
      raw.push({ i, lex, sem: dot / (qn * (v.norm || 1)) });
    });
    const maxL = Math.max(1e-9, ...raw.map((r) => r.lex));
    const maxS = Math.max(1e-9, ...raw.map((r) => r.sem));
    const w = config.retrieval.weights;
    // Document prior: share of query terms that appear in a document's title/condition, relative to the best document.
    const qset = [...new Set(qt)];
    const priorOf = new Map<number, number>();
    for (const r of raw) {
      const c = this.chunks[r.i]!;
      if (!priorOf.has(c.doc_id)) priorOf.set(c.doc_id, qset.filter((t) => c.titleTokens.has(t)).length);
    }
    const maxPrior = Math.max(1, ...priorOf.values());
    const pw = config.retrieval.docPriorWeight;
    return raw
      .map((r) => {
        const chunk = this.chunks[r.i]!;
        const chunkScore = w.lexical * (r.lex / maxL) + w.semantic * (r.sem / maxS) + intentBoost(query, chunk);
        const docPrior = (priorOf.get(chunk.doc_id) ?? 0) / maxPrior;
        return { chunk, lexical: r.lex / maxL, semantic: r.sem / maxS, chunkScore, docPrior, score: (1 - pw) * chunkScore + pw * docPrior };
      })
      .filter((h) => h.chunkScore > 0 || h.docPrior > 0)
      .sort((a, c) => c.score - a.score || a.chunk.chunk_id - c.chunk.chunk_id)
      .slice(0, k);
  }
}
