import { openDb, type Db } from '../server/src/db/connection.js';
import { migrate } from '../server/src/db/migrate.js';
import { runIngestion } from '../server/src/ingest/pipeline.js';
import { ingestCorpus } from '../server/src/corpus/store.js';

let cached: Db | null = null;
/** One fully loaded in-memory database shared by read-only tests. */
export async function loadedDb(): Promise<Db> {
  if (cached) return cached;
  const db = openDb(':memory:');
  migrate(db);
  runIngestion(db);
  await ingestCorpus(db);
  cached = db;
  return db;
}
export async function freshDb(opts: { corpus?: boolean; ingest?: boolean } = {}): Promise<Db> {
  const db = openDb(':memory:');
  migrate(db);
  if (opts.ingest !== false) runIngestion(db);
  if (opts.corpus) await ingestCorpus(db);
  return db;
}
