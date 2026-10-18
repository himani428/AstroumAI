import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.js';
import { all, get, run, tx } from '../db/connection.js';
import { config } from '../config.js';
import { nowIso, sha256 } from '../util/text.js';
import { extractPdf } from './pdf.js';
import { chunkLocalProtocol, chunkStwPdf, type Extraction } from './chunker.js';
import { writeAudit } from '../audit.js';

export interface CorpusReport { documents: number; chunks: number; superseded: string[]; issues: { file: string; issues: string[] }[] }

function insertDoc(db: Db, file: string, buf: Buffer, ex: Extraction, source_type: 'NATIONAL_STW' | 'LOCAL_PROTOCOL', issuer: string | null) {
  const m = ex.meta;
  const r = run(db, `INSERT INTO corpus_documents (doc_code, title, version, effective_date, supersedes, status, source_type, specialty, condition_label, issuer, file_name, file_sha256,
      page_count, extraction_json, metadata_json, loaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.doc_code, m.title, m.version, m.effective_date, m.supersedes, source_type === 'LOCAL_PROTOCOL' ? 'LOCAL_PROTOCOL' : 'CURRENT', source_type, m.specialty, m.condition_label, issuer, file,
    sha256(buf), ex.quality.page_count, JSON.stringify(ex.quality), JSON.stringify({ archive_notice: m.archive_notice, synthetic_notice: m.synthetic_notice }), nowIso());
  const id = Number(r.lastInsertRowid);
  for (const c of ex.chunks) run(db, 'INSERT INTO corpus_chunks (doc_id, ordinal, page, anchor, section, kind, text, text_hash) VALUES (?,?,?,?,?,?,?,?)', id, c.ordinal, c.page, c.anchor, c.section, c.kind, c.text, sha256(c.text));
  return id;
}

/** Repeatable corpus ingestion. Rebuilds corpus tables from the supplied files only. */
export async function ingestCorpus(db: Db): Promise<CorpusReport> {
  const pdfs = fs.readdirSync(config.paths.inputCorpus).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const extracted: { file: string; buf: Buffer; ex: Extraction }[] = [];
  for (const f of pdfs) {
    const full = path.join(config.paths.inputCorpus, f);
    extracted.push({ file: f, buf: fs.readFileSync(full), ex: chunkStwPdf(await extractPdf(full), f) });
  }
  const protoFile = config.datasets.localProtocol.file;
  const protoBuf = fs.readFileSync(path.join(config.paths.inputData, protoFile));
  const proto = chunkLocalProtocol(protoBuf.toString('utf8'));
  const report: CorpusReport = { documents: 0, chunks: 0, superseded: [], issues: [] };
  tx(db, () => {
    run(db, 'DELETE FROM corpus_chunks'); run(db, 'DELETE FROM corpus_documents');
    for (const e of extracted) { insertDoc(db, e.file, e.buf, e.ex, 'NATIONAL_STW', 'ICMR STW format (synthetic assessment copy)'); if (e.ex.quality.issues.length) report.issues.push({ file: e.file, issues: e.ex.quality.issues }); }
    insertDoc(db, protoFile, protoBuf, proto, 'LOCAL_PROTOCOL', 'Sunrise Multi-speciality Clinic (organization-level knowledge)');
    report.issues.push({ file: protoFile, issues: proto.quality.issues });
    // Supersession: same code with a later version supersedes older; an archive notice or "Supersedes" header corroborates.
    const docs = all<{ id: number; doc_code: string; version: string; metadata_json: string; source_type: string }>(db, "SELECT id, doc_code, version, metadata_json, source_type FROM corpus_documents WHERE source_type='NATIONAL_STW'");
    for (const d of docs) {
      const newer = docs.find((o) => o.doc_code === d.doc_code && o.id !== d.id && Number(o.version.replace('.', '')) > Number(d.version.replace('.', '')));
      if (newer) { run(db, "UPDATE corpus_documents SET status='SUPERSEDED' WHERE id=?", d.id); report.superseded.push(`${d.doc_code} v${d.version}`); }
    }
    const n = get<{ d: number; c: number }>(db, 'SELECT (SELECT COUNT(*) FROM corpus_documents) d, (SELECT COUNT(*) FROM corpus_chunks) c')!;
    report.documents = n.d; report.chunks = n.c;
    writeAudit(db, 'system', 'CORPUS_INGESTED', 'corpus', null, { documents: n.d, chunks: n.c, superseded: report.superseded });
  });
  return report;
}
