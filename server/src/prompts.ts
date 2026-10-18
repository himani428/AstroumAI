import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { sha256 } from './util/text.js';

export interface PromptInfo { file: string; id: string; version: string; status: string; used_by: string; sha256: string }

/** Reads the versioned prompt library and returns id/version/hash for the trace (law 8). */
export function listPrompts(): PromptInfo[] {
  const out: PromptInfo[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith('.md') && f.name !== 'README.md') {
        const txt = fs.readFileSync(full, 'utf8');
        const fm = txt.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
        const g = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? 'unknown';
        out.push({ file: path.relative(config.paths.prompts, full).replace(/\\/g, '/'), id: g('id'), version: g('version'), status: g('status'), used_by: g('used_by'), sha256: sha256(txt) });
      }
    }
  };
  if (fs.existsSync(config.paths.prompts)) walk(config.paths.prompts);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function loadPromptBody(file: string): string {
  return fs.readFileSync(path.join(config.paths.prompts, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
}
