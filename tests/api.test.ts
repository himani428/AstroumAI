import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/src/api/app.js';
import { freshDb } from './helpers.js';

import os from 'node:os';
import path from 'node:path';
import { all as dbAll } from '../server/src/db/connection.js';
import type { Db } from '../server/src/db/connection.js';
process.env.BRAHMO_SECRET_KEY_FILE = path.join(os.tmpdir(), `brahmo-test-${process.pid}.key`);
let server: Server; let base = ''; let testDb: Db;
beforeAll(async () => {
  const db = await freshDb({ corpus: true });
  testDb = db;
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterAll(() => { server.close(); });
const get = async (p: string) => fetch(base + p);
const put = async (p: string, body: unknown) => fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post = async (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('API', () => {
  it('serves the main read endpoints', async () => {
    for (const p of ['/health', '/dashboard', '/drugs?q=dolo', '/drugs/CD1000', '/fdc/stats', '/regulatory/targets', '/review-queue?status=OPEN', '/corpus/documents', '/data-quality', '/settings', '/search?q=nimesulide', '/provenance/product/CD1000']) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
    }
  });
  it('returns consistent validation and not-found errors with real messages', async () => {
    const bad = await post('/safety/run', { prescription: [] });
    expect(bad.status).toBe(400);
    expect((await bad.json() as any).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    const nf = await get('/drugs/NOPE');
    expect(nf.status).toBe(404);
    expect((await nf.json() as any).error.message).toMatch(/NOPE/);
    expect((await get('/nothing-here')).status).toBe(404);
  });
  it('runs the safety rail over HTTP and persists a USER run', async () => {
    const r = await post('/safety/run', { prescription: [{ written_product: 'Warf 5', strength_as_written: '5 mg' }, { written_product: 'Azee 500' }], as_of: '2026-10-15' });
    const rep = await r.json() as any;
    expect(rep.checks.find((c: any) => c.check_type === 'SEVERE_INTERACTION').status).toBe('HIT');
    const runs = await (await get('/safety/runs?origin=USER')).json() as any;
    expect(runs.items.length).toBe(1);
  });
  it('review queue: accepting a candidate stores an audited alias that later resolves the line', async () => {
    const first = await (await post('/safety/run', { prescription: [{ written_product: 'Telma' }] })).json() as any;
    const qid = first.lines[0].resolution.queue_id;
    const item = await (await get(`/review-queue/${qid}`)).json() as any;
    const cand = item.item.candidates[0].product_id;
    const noActor = await post(`/review-queue/${qid}/decision`, { decision: 'ACCEPT_CANDIDATE', candidate_product_id: cand });
    expect(noActor.status).toBe(400);
    const wrong = await post(`/review-queue/${qid}/decision`, { actor: 'tester', decision: 'ACCEPT_CANDIDATE', candidate_product_id: 'CD-NOT-LISTED' });
    expect(wrong.status).toBe(400);
    expect((await post(`/review-queue/${qid}/decision`, { actor: 'tester', decision: 'ACCEPT_CANDIDATE', candidate_product_id: cand, note: 'checked against paper script' })).status).toBe(200);
    const again = await (await post('/safety/run', { prescription: [{ written_product: 'Telma' }] })).json() as any;
    expect(again.lines[0].resolution).toMatchObject({ status: 'RESOLVED', method: 'reviewer_confirmed' });
    const detail = await (await get(`/review-queue/${qid}`)).json() as any;
    expect(detail.decisions).toHaveLength(1);
    const audit = await (await get('/audit?action=REVIEW_ACCEPT_CANDIDATE')).json() as any;
    expect(audit.total).toBe(1);
    // reopening removes the alias again
    await post(`/review-queue/${qid}/decision`, { actor: 'tester', decision: 'REOPEN' });
    const reopened = await (await post('/safety/run', { prescription: [{ written_product: 'Telma' }] })).json() as any;
    expect(reopened.lines[0].resolution.status).toBe('NEEDS_REVIEW');
  });
  it('brand collisions cannot be resolved globally', async () => {
    const q = await (await get('/review-queue?type=BRAND_COLLISION&size=1')).json() as any;
    const r = await post(`/review-queue/${q.items[0].id}/decision`, { actor: 'tester', decision: 'ACCEPT_CANDIDATE', candidate_product_id: q.items[0].candidates[0].product_id });
    expect(r.status).toBe(400);
  });
  it('simulation never persists the hypothetical event', async () => {
    const r = await (await post('/regulatory/simulate', { notification_id: 'SIM', effective_date: '2026-01-01', action: 'PROHIBITED', target_type: 'FDC', target_description: 'Glimepiride + Metformin (all strengths)' })).json() as any;
    expect(r.persisted).toBe(false);
    const ev = await (await get('/regulatory/events')).json() as any;
    expect(ev.items.some((e: any) => e.notification_id === 'SIM')).toBe(false);
  });
  it('asks a grounded question and records it', async () => {
    const a = await (await post('/qa/ask', { question: 'Which analgesic class must be avoided in suspected dengue, and why?' })).json() as any;
    expect(a.outcome).toBe('ANSWERED');
    const dash = await (await get('/dashboard')).json() as any;
    expect(dash.qa.answered).toBe(1);
  });
  it('traces end to end over HTTP', async () => {
    const t: any = await (await post('/trace', { prescription: [{ written_product: 'NimuPar-P', dose_frequency: '1-0-1' }], question: 'What is the standard drug regimen for newly diagnosed pulmonary tuberculosis?' })).json() as any;
    expect(t.stages['3_grounded_answer'].outcome).toBe('ABSTAINED');
    expect(t.stages['2_safety_rail'].report.checks.find((c: any) => c.check_type === 'PROHIBITED_FDC').status).toBe('HIT');
  });
  it('dry-run ingestion job completes without writing', async () => {
    const { job_id } = (await (await post("/ingestion/run", { dry_run: true })).json()) as any;
    let job: any;
    for (let i = 0; i < 50; i++) { job = await (await get(`/jobs/${job_id}`)).json() as any; if (job.status !== 'RUNNING') break; await new Promise((r) => setTimeout(r, 200)); }
    expect(job.status).toBe('COMPLETED');
    expect(job.result.dry_run).toBe(true);
  });

  it('stores the Anthropic key encrypted, never returns it, and can remove it', async () => {
    const KEY = 'sk-ant-api03-TESTKEY1234567890abcdefXYZ9';
    expect((await get('/settings/llm').then((r) => r.json()) as any).configured).toBe(false);
    expect((await put('/settings/llm', { api_key: 'not-a-key-but-long-enough-xxxxxxxx' })).status).toBe(400);
    expect((await put('/settings/llm', {})).status).toBe(400);
    const saved = await put('/settings/llm', { api_key: KEY });
    expect(saved.status).toBe(200);
    const body = JSON.stringify(await saved.json());
    expect(body).not.toContain(KEY);
    expect(body).toContain('sk-ant-...XYZ9');
    for (const p of ['/settings/llm', '/settings', '/health', '/dashboard', '/audit']) expect(await (await get(p)).text(), p).not.toContain(KEY);
    const stored = dbAll<{ value: string; encrypted: number }>(testDb, "SELECT value, encrypted FROM app_settings WHERE key = 'llm.api_key'")[0]!;
    expect(stored.encrypted).toBe(1);
    expect(stored.value).not.toContain('TESTKEY');
    // the settings screen reports the key as configured and the composer switches on
    expect(((await (await get('/settings')).json()) as any).llm).toMatchObject({ enabled: true, source: 'saved' });
    // an invalid key must surface the provider's real error, and Q&A must fall back to the verbatim answer
    const t = (await (await post('/settings/llm/test', {})).json()) as any;
    expect(t.ok).toBe(false);
    expect(String(t.message).length).toBeGreaterThan(3);
    const a = (await (await post('/qa/ask', { question: 'Which analgesic class must be avoided in suspected dengue, and why?' })).json()) as any;
    expect(a.outcome).toBe('ANSWERED');
    expect(a.composer.mode).toBe('EXTRACTIVE');
    expect(a.notes.join(' ')).toMatch(/LLM composer unavailable or rejected/);
    const removed = (await (await fetch(base + '/settings/llm', { method: 'DELETE' })).json()) as any;
    expect(removed.configured).toBe(false);
    expect(dbAll(testDb, "SELECT 1 FROM app_settings WHERE key = 'llm.api_key'")).toHaveLength(0);
  });
});
