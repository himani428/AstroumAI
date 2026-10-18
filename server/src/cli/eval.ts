import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { config } from '../config.js';
import { evalMarkdown, runEvaluation } from '../eval/harness.js';

const db = openDb(); migrate(db);
const e = runEvaluation(db);
fs.mkdirSync(path.join(config.paths.reports, 'eval'), { recursive: true });
fs.writeFileSync(path.join(config.paths.reports, 'eval', 'latest.json'), JSON.stringify(e, null, 2));
fs.writeFileSync(path.join(config.paths.reports, 'eval', 'latest.md'), evalMarkdown(e));
for (const r of e.results) console.log(`${r.id} ${r.set.padEnd(13)} ${r.outcome.padEnd(20)} ${r.outcome === 'WRONG' ? r.explanation : ''}`);
console.log('core:', e.core_totals, 'all:', e.totals);
process.exitCode = e.core_totals.wrong ? 1 : 0;
