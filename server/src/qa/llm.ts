import type { Db } from '../db/connection.js';
import { getLlmSettings } from '../secrets.js';
import { loadPromptBody, listPrompts } from '../prompts.js';
import type { Claim, QaResult } from './types.js';

/**
 * OPTIONAL composer for Module B only. Never imported by the safety rail (enforced by tests/safety-isolation.test.ts).
 * It may only re-phrase evidence that retrieval already selected; any violation falls back to the extractive answer.
 * NOT exercised against the live API in this build (no key was available): the verifier below is unit-tested, the HTTP call is not.
 */
export interface LlmSentence { text: string; evidence_ids: string[] }

export function verifyComposition(sentences: LlmSentence[], evidence: Map<string, string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const s of sentences) {
    if (!s.evidence_ids?.length) problems.push(`no evidence id: "${s.text.slice(0, 40)}"`);
    const hay = (s.evidence_ids ?? []).map((id) => evidence.get(id) ?? '').join(' ');
    if (!s.evidence_ids.every((id) => evidence.has(id))) problems.push(`unknown evidence id in "${s.text.slice(0, 40)}"`);
    for (const n of s.text.replace(/\[E\d+\]/g, "").match(/\d+(?:\.\d+)?/g) ?? []) if (!hay.includes(n)) problems.push(`number ${n} not in cited evidence`);
  }
  return { ok: problems.length === 0, problems };
}

/** Minimal real call used by the Test connection button. Returns the provider's actual error text on failure. */
export async function testAnthropicKey(apiKey: string, model: string): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (res.ok) return { ok: true, status: res.status, message: 'The key works with this model.' };
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, status: res.status, message: body?.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: `Cannot reach api.anthropic.com: ${(e as Error).message}` };
  }
}

export async function composeWithLlm(db: Db, base: QaResult): Promise<QaResult> {
  const llm = getLlmSettings(db);
  if (!llm.apiKey || base.outcome === 'ABSTAINED') return base;
  const claims: Claim[] = base.blocks.filter((b) => b.status === 'ANSWERED').flatMap((b) => b.claims);
  const evidence = new Map(claims.map((c, i) => [`E${i + 1}`, c.text]));
  const prompt = loadPromptBody('qa-composer.v1.md').replace('{{question}}', base.question).replace('{{evidence}}', [...evidence].map(([id, t]) => `[${id}] ${t}`).join('\n'));
  const [system, user] = prompt.split(/\nUSER\n/);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': llm.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: llm.model, max_tokens: 800, system: system!.replace(/^SYSTEM\n/, ''), messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const body = (await res.json()) as { content: { text?: string }[] };
    const parsed = JSON.parse((body.content[0]?.text ?? '').replace(/```json|```/g, '').trim()) as { sentences?: LlmSentence[]; abstain?: boolean };
    if (!parsed.sentences) throw new Error('composer abstained or returned no sentences');
    const v = verifyComposition(parsed.sentences, evidence);
    if (!v.ok) throw new Error(`verification failed: ${v.problems.join('; ')}`);
    const p = listPrompts().find((x) => x.id === 'qa-composer');
    return { ...base, notes: [...base.notes, 'Answer wording composed by an LLM and verified against retrieved evidence; the verbatim claims remain available above.'], composer: { mode: 'LLM_VERIFIED', provider: 'anthropic', model: llm.model, prompt_version: p ? `${p.id}@${p.version}` : null } };
  } catch (e) {
    return { ...base, notes: [...base.notes, `LLM composer unavailable or rejected (${(e as Error).message}); showing the verbatim extractive answer.`] };
  }
}
