import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from '../../db/connection.js';
import { all, get, run } from '../../db/connection.js';
import { config } from '../../config.js';
import { CorpusIndex } from '../../corpus/retrieval.js';
import { answerQuestion } from '../../qa/answer.js';
import { composeWithLlm } from '../../qa/llm.js';
import { runEvaluation } from '../../eval/harness.js';
import { buildTrace } from '../../trace/trace.js';
import { ingestCorpus } from '../../corpus/store.js';
import { HttpError, jsonRow, parse } from '../http.js';
import { rxSchema } from './regsafety.js';
import { nowIso } from '../../util/text.js';
import { todayIso } from '../../safety/service.js';

export function qaRoutes(db: Db): Router {
  const r = Router();
  let index: CorpusIndex | null = null;
  const idx = () => (index ??= CorpusIndex.build(db));

  r.post('/qa/ask', async (req, res) => {
    const b = parse(z.object({ question: z.string().min(3).max(600) }), req.body);
    if (!get<{ n: number }>(db, 'SELECT COUNT(*) n FROM corpus_chunks')!.n) throw new HttpError(503, 'CORPUS_NOT_LOADED', 'The clinical corpus has not been ingested. Run the corpus ingestion from the Data page.');
    const a = await composeWithLlm(db, answerQuestion({ db, index: idx(), asOf: todayIso() }, b.question));
    run(db, 'INSERT INTO qa_runs (created_at, origin, question, outcome, output_json) VALUES (?,?,?,?,?)', nowIso(), 'USER', b.question, a.outcome, JSON.stringify(a));
    res.json(a);
  });

  r.get('/corpus/documents', (_req, res) => {
    const docs = all<Record<string, unknown>>(db, 'SELECT d.*, (SELECT COUNT(*) FROM corpus_chunks c WHERE c.doc_id = d.id) chunk_count FROM corpus_documents d ORDER BY d.source_type, d.doc_code, d.version');
    res.json({ items: docs.map((d) => jsonRow(d, ['extraction_json', 'metadata_json'])) });
  });
  r.get('/corpus/documents/:id', (req, res) => {
    const d = get<Record<string, unknown>>(db, 'SELECT * FROM corpus_documents WHERE id = ?', req.params.id);
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
    res.json({ document: jsonRow(d, ['extraction_json', 'metadata_json']), chunks: all(db, 'SELECT * FROM corpus_chunks WHERE doc_id = ? ORDER BY ordinal', d.id) });
  });
  r.post('/corpus/ingest', async (_req, res) => {
    const rep = await ingestCorpus(db);
    index = null;
    res.json(rep);
  });

  r.get('/eval/runs', (_req, res) => {
    res.json({ items: all(db, 'SELECT id, created_at, total, correct, abstained, wrong, versions_json FROM eval_runs ORDER BY id DESC LIMIT 50').map((x) => jsonRow(x, ['versions_json'])) });
  });
  r.get('/eval/runs/latest', (_req, res) => {
    const x = get<{ id: number; results_json: string }>(db, 'SELECT id, results_json FROM eval_runs ORDER BY id DESC LIMIT 1');
    if (!x) throw new HttpError(404, 'NO_EVAL_RUN', 'No evaluation has been run yet');
    res.json({ id: x.id, ...JSON.parse(x.results_json) });
  });
  r.get('/eval/runs/:id', (req, res) => {
    const x = get<{ id: number; results_json: string }>(db, 'SELECT id, results_json FROM eval_runs WHERE id = ?', req.params.id);
    if (!x) throw new HttpError(404, 'NOT_FOUND', 'Run not found');
    res.json({ id: x.id, ...JSON.parse(x.results_json) });
  });
  r.post('/eval/run', (_req, res) => {
    const e = runEvaluation(db);
    fs.mkdirSync(path.join(config.paths.reports, 'eval'), { recursive: true });
    fs.writeFileSync(path.join(config.paths.reports, 'eval', 'latest.json'), JSON.stringify(e, null, 2));
    res.json(e);
  });

  r.post('/trace', (req, res) => {
    const b = parse(z.object({ prescription: rxSchema, question: z.string().min(3).max(600), as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
    res.json(buildTrace(db, b, { origin: 'API' }));
  });
  r.get('/trace/sample', (_req, res) => {
    const f = path.join(config.paths.reports, 'trace', 'sample_trace.json');
    if (!fs.existsSync(f)) throw new HttpError(404, 'NO_SAMPLE', 'No checked-in sample trace; run `npm run trace`');
    res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
  });
  return r;
}
