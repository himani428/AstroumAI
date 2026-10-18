import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { get } from '../db/connection.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { createApp } from '../api/app.js';
import { runIngestion } from '../ingest/pipeline.js';
import { ingestCorpus } from '../corpus/store.js';
import { runSeededDemo } from '../safety/service.js';
import { runEvaluation } from '../eval/harness.js';

/** Starts the API/UI. First run bootstraps everything automatically: migrations, dataset ingestion, corpus, seeded demo, evaluation. */
const db = openDb();
migrate(db);
if (!get<{ n: number }>(db, 'SELECT COUNT(*) n FROM dataset_versions')!.n) { log.info('first run: ingesting datasets'); runIngestion(db); }
if (!get<{ n: number }>(db, 'SELECT COUNT(*) n FROM corpus_documents')!.n) { log.info('first run: ingesting corpus'); await ingestCorpus(db); }
if (!get<{ n: number }>(db, "SELECT COUNT(*) n FROM safety_runs WHERE origin='SEEDED_DEMO'")!.n) runSeededDemo(db);
if (!get<{ n: number }>(db, 'SELECT COUNT(*) n FROM eval_runs')!.n) runEvaluation(db);
const app = createApp(db);
app.listen(config.port, () => {
  log.info('BRAHMO AI listening', { url: `http://localhost:${config.port}` });
  console.log(`\n  BRAHMO AI is running at http://localhost:${config.port}\n`);
});
