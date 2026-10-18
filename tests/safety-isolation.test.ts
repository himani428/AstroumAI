import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Law 4: nothing probabilistic may be reachable from the safety execution path. */
describe('safety rail isolation', () => {
  const dirs = ['server/src/safety', 'server/src/regulatory'];
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => path.join(d, f)));
  const forbiddenImports = [/qa\//, /corpus\//, /llm/, /eval\//, /anthropic/i, /prompts/, /secrets/];
  it('imports no QA, corpus, LLM, prompt or evaluation module', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) for (const re of forbiddenImports) expect({ f, imp: m[1], bad: re.test(m[1]!) }).toMatchObject({ bad: false });
    }
  });
  it('performs no network access and uses no randomness', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|https?:\/\/api\./);
      expect(src).not.toMatch(/Math\.random|randomUUID/);
    }
  });
  it('the pure engine and rules do not touch the database layer', () => {
    for (const f of ['server/src/safety/engine.ts', 'server/src/safety/frequency.ts', 'server/src/regulatory/status.ts', 'server/src/regulatory/match.ts']) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/db\/connection|node:sqlite/);
  });
});
