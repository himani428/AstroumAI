import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { config } from '../config.js';
import { buildTrace } from '../trace/trace.js';

/** Usage: npm run trace [-- path/to/input.json]. Without a path the sample input is used and written to reports/trace/. */
const db = openDb(); migrate(db);
const arg = process.argv[2];
const input = arg ? JSON.parse(fs.readFileSync(arg, 'utf8')) : {
  prescription: [
    { line_no: 1, written_product: 'Dolo 650', strength_as_written: '650 mg', dose_frequency: '1-0-1 x 5d' },
    { line_no: 2, written_product: 'Sinarest Tablet', dose_frequency: '1-0-1 x 5d' },
    { line_no: 3, written_product: 'Telma', dose_frequency: '1-0-0' },
  ],
  question: 'What is the first-line initial drug therapy for newly diagnosed adult hypertension?',
  as_of: config.demo.asOf,
};
const trace = buildTrace(db, input, { origin: 'CLI' });
if (!arg) {
  fs.mkdirSync(path.join(config.paths.reports, 'trace'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.reports, 'trace', 'sample_trace.json'), JSON.stringify(trace, null, 2));
  fs.writeFileSync(path.join(config.paths.reports, 'trace', 'sample_input.json'), JSON.stringify(input, null, 2));
}
console.log(JSON.stringify(trace, null, 2));
