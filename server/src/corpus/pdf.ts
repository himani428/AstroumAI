import fs from 'node:fs';
// pdfjs-dist legacy build runs in Node without a canvas for text extraction.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfLine { text: string; y: number; x: number; items: { str: string; x: number }[] }
export interface PdfPageText { page: number; lines: PdfLine[]; charCount: number }
export interface PdfExtraction { pageCount: number; pages: PdfPageText[]; info: Record<string, unknown> }

/** Extracts text with positions and groups items into visual lines (same baseline within tolerance). */
export async function extractPdf(file: string): Promise<PdfExtraction> {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = getDocument({ data, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: PdfPageText[] = [];
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[] }[])
      .filter((i) => typeof i.str === 'string' && i.str.trim().length > 0)
      .map((i) => ({ str: i.str, x: i.transform[4]!, y: i.transform[5]! }));
    const lines: PdfLine[] = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < 2.5) last.items.push({ str: it.str, x: it.x });
      else lines.push({ text: '', y: it.y, x: it.x, items: [{ str: it.str, x: it.x }] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      l.x = l.items[0]!.x;
    }
    pages.push({ page: p, lines, charCount: lines.reduce((s, l) => s + l.text.length, 0) });
  }
  const pageCount = doc.numPages;
  await task.destroy();
  return { pageCount, pages, info: (meta as { info: Record<string, unknown> }).info ?? {} };
}
