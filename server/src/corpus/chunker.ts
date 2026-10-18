import type { PdfExtraction } from './pdf.js';

export interface DocMeta {
  doc_code: string; title: string; version: string; effective_date: string | null; supersedes: string | null; archive_notice: string | null;
  specialty: string; condition_label: string; synthetic_notice: string | null;
}
export interface ChunkDraft { ordinal: number; page: number | null; anchor: string; section: string | null; kind: string; text: string }
export interface Extraction { meta: DocMeta; chunks: ChunkDraft[]; quality: { page_count: number; chars: number; issues: string[]; sections: string[] } }

const SPECIALTY: Record<string, string> = { GP: 'General Practice', PED: 'Paediatrics', GYN: 'Gynaecology', ORT: 'Orthopaedics' };
const KIND_BY_SECTION: [RegExp, string][] = [
  [/^RED FLAGS/, 'red_flag'], [/^(DO NOT|AVOID)/, 'contraindication'], [/^FIRST-LINE/, 'recommendation'], [/^OPD MANAGEMENT/, 'recommendation'],
  [/^(ASSESS|CONFIRM|DIAGNOSE|CLASSIFY|SUSPECT|SCREEN)/, 'assessment'], [/^(REFER|WARNING SIGNS)/, 'referral'], [/^(MONITOR|REVIEW|FOLLOW-UP|TARGETS)/, 'monitoring'],
  [/^COUNSEL/, 'counselling'], [/^STATUS/, 'status'],
];
const kindOf = (section: string) => KIND_BY_SECTION.find(([re]) => re.test(section))?.[1] ?? 'other';
const isHeading = (t: string) => /^[A-Z][A-Z0-9 \-—/()&,]+$/.test(t) && t.length < 60 && !t.startsWith('•');

/**
 * Decision-unit chunking: one chunk per bullet (a recommendation, red flag, contraindication, workflow step),
 * carrying its section heading and page anchor. Never fixed-length slicing.
 */
export function chunkStwPdf(ex: PdfExtraction, fileName: string): Extraction {
  const issues: string[] = [];
  const chunks: ChunkDraft[] = [];
  const sections: string[] = [];
  let meta: Partial<DocMeta> = {};
  let ord = 0;
  let chars = 0;
  for (const pg of ex.pages) {
    chars += pg.charCount;
    if (pg.charCount < 200) issues.push(`page ${pg.page}: very little extractable text (${pg.charCount} chars)`);
    const lines = pg.lines.map((l) => l.text);
    const full = lines.join('\n');
    const code = full.match(/Code:\s*(STW-[A-Z]+-\d+)/)?.[1];
    const ver = full.match(/Version:\s*([\d.]+)/)?.[1];
    const eff = full.match(/Effective:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const sup = full.match(/Supersedes:\s*(STW-[A-Z]+-\d+\s*v[\d.]+)/)?.[1];
    const archive = full.match(/ARCHIVE COPY[^.\n]*/)?.[0] ?? null;
    const synth = full.match(/SYNTHETIC ASSESSMENT DOCUMENT[^\n]*/)?.[0] ?? null;
    const hi = lines.findIndex((l) => l === 'STANDARD TREATMENT WORKFLOW');
    const titleLine = hi >= 0 ? lines.slice(hi + 1).find((l) => !/^Version:/.test(l)) : undefined;
    const title = titleLine?.replace(/\s*Supersedes:.*$/, '').trim();
    if (!code) issues.push(`page ${pg.page}: document code not found`);
    if (!ver || !eff) issues.push(`page ${pg.page}: version or effective date not found`);
    if (!title) issues.push(`page ${pg.page}: title not found`);
    if (pg.page === 1) {
      const specCode = code?.split('-')[1] ?? '';
      meta = { doc_code: code ?? fileName, title: title ?? fileName, version: ver ?? 'unknown', effective_date: eff ?? null, supersedes: sup?.replace(/\s+/g, ' ') ?? null,
        archive_notice: archive, specialty: SPECIALTY[specCode] ?? 'Unknown', condition_label: (title ?? '').split('—')[0]!.trim(), synthetic_notice: synth };
    }
    let section: string | null = null;
    let current: ChunkDraft | null = null;
    let bullet = 0;
    for (const t of lines.slice(hi + 2)) {
      if (/^SYNTHETIC ASSESSMENT DOCUMENT/.test(t)) break;
      if (/^Code:|^Version:/.test(t) || t === title || t.startsWith(title ?? '\u0000')) continue;
      if (t.startsWith('•')) {
        bullet++;
        current = { ordinal: ord++, page: pg.page, anchor: `p${pg.page} / ${section ?? 'UNSECTIONED'} / item ${bullet}`, section, kind: section ? kindOf(section) : 'other', text: t.replace(/^•\s*/, '') };
        chunks.push(current);
      } else if (isHeading(t)) {
        section = t; bullet = 0; current = null;
        if (!sections.includes(t)) sections.push(t);
      } else if (current) {
        current.text += ' ' + t; // wrapped continuation of the previous bullet
      } else {
        issues.push(`page ${pg.page}: unattached line "${t.slice(0, 40)}"`);
      }
    }
  }
  if (!chunks.length) issues.push('no decision units extracted');
  return { meta: meta as DocMeta, chunks, quality: { page_count: ex.pageCount, chars, issues, sections } };
}

export function chunkLocalProtocol(md: string): Extraction {
  const issues: string[] = [];
  const title = md.match(/^#\s*(.+)$/m)?.[1]?.trim() ?? 'Local protocol';
  const doc = md.match(/\*\*Document:\*\*\s*([A-Z0-9-]+)/)?.[1];
  const ver = md.match(/\*\*Version:\*\*\s*([\d.]+)/)?.[1];
  const approved = md.match(/\*\*Approved:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const scope = md.match(/\*\*Scope:\*\*\s*(.+)/)?.[1]?.trim();
  if (!doc || !ver || !approved) issues.push('document id, version or approval date not found');
  const chunks: ChunkDraft[] = [];
  let ord = 1;
  for (const m of md.matchAll(/^\s*(\d+)\.\s+(.+)$/gm)) {
    chunks.push({ ordinal: ord++, page: null, anchor: `Step ${m[1]}`, section: `Step ${m[1]}`, kind: 'workflow_step', text: m[2]!.replace(/\*\*/g, '').trim() });
  }
  if (scope) chunks.unshift({ ordinal: 0, page: null, anchor: 'Scope', section: 'Scope', kind: 'scope', text: scope });
  chunks.forEach((c, i) => (c.ordinal = i));
  const notice = md.match(/\*([^*\n]*Not national guidance[^*\n]*)\*/i)?.[1] ?? null;
  return {
    meta: { doc_code: doc ?? 'SOP-UNKNOWN', title: title.split('—')[0]!.trim() + ' - ' + (title.split('—')[1]?.trim() ?? ''), version: ver ?? 'unknown', effective_date: approved ?? null, supersedes: null, archive_notice: null,
      specialty: 'General Practice (clinic protocol)', condition_label: 'Adult acute undifferentiated fever', synthetic_notice: notice },
    chunks,
    quality: { page_count: 1, chars: md.length, issues: [...issues, 'Markdown source has no pages; anchors are step numbers'], sections: ['Scope', 'Steps'] },
  };
}
