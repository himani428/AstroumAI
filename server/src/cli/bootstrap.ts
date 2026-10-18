import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { runIngestion } from '../ingest/pipeline.js';

const db = openDb();
migrate(db);
const rep = runIngestion(db, { dryRun: process.argv.includes('--dry-run') });
for (const d of rep.datasets) console.log(`${d.dataset.padEnd(13)} ${d.status.padEnd(18)} total=${d.rows_total} imported=${d.imported} rejected=${d.rejected} dup=${d.duplicate} unresolved=${d.unresolved} queue+${d.queue_items_created} (${d.ms}ms)`);
