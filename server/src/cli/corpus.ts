import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { ingestCorpus } from '../corpus/store.js';
const db = openDb(); migrate(db);
const r = await ingestCorpus(db);
console.log(JSON.stringify(r, null, 2));
