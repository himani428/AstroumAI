import fs from 'node:fs';
import path from 'node:path';
import { openDb, all } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { config } from '../config.js';
import { runSeededDemo } from '../safety/service.js';
import { readInput, parseCsv } from '../ingest/common.js';

/** Re-runs the 10 seeded prescriptions at the fixed demo date and writes reproducible JSON + the completed template CSV. */
const db = openDb(); migrate(db);
const reports = runSeededDemo(db);
const dir = path.join(config.paths.reports, 'seeded');
fs.mkdirSync(dir, { recursive: true });
const short: Record<string, string> = { DUPLICATE_INGREDIENT: 'DUP', PROHIBITED_FDC: 'REG', SEVERE_INTERACTION: 'INT', CUMULATIVE_EXPOSURE: 'CUM' };
for (const [rx, rep] of Object.entries(reports)) fs.writeFileSync(path.join(dir, `${rx}.json`), JSON.stringify(rep, null, 2));
fs.writeFileSync(path.join(dir, 'ALL.json'), JSON.stringify(reports, null, 2));
const tpl = parseCsv(readInput(config.datasets.seedRx.file).text);
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const out = [tpl.header.join(',')];
for (const r of tpl.rows) {
  const rep = reports[r.record.rx_id!]!;
  const state = rep.checks.map((c) => `${short[c.check_type]}=${c.status}`).join(' | ');
  const note = rep.checks.filter((c) => c.status !== 'CHECKED_NO_HIT').map((c) => `${short[c.check_type]}: ${c.explanation}`).join(' ') || 'All four checks ran with stated coverage and found nothing (seed-list scope; not clinical clearance).';
  out.push(tpl.header.map((h) => esc(h === 'candidate_rail_output_state' ? state : h === 'candidate_evidence_note' ? note : r.record[h] ?? '')).join(','));
}
fs.writeFileSync(path.join(dir, 'seed_prescriptions_completed.csv'), out.join('\n') + '\n');
for (const [rx, rep] of Object.entries(reports)) console.log(rx.padEnd(5), rep.checks.map((c) => `${short[c.check_type]}=${c.status}`).join('  '));
void all;
