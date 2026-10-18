# SCALE.md: where this strains at 100x data and 100 concurrent users

Current size: about 2,000 products, 783 stock lines, 12 regulatory events, 15 interaction pairs, 84 decision-unit chunks. Single Node process, one SQLite file.

## 100x data (200,000 products, 80,000 stock lines, 1,200 events, 8,400 chunks)

| Area | Strain | First fix |
|---|---|---|
| `ProductIndex.build` and `CorpusIndex.build` | Both rebuild an in-memory index per request or per process. At 200,000 products the rebuild is seconds and tens of megabytes per request. | Build once at startup, invalidate on ingestion batch id; move brand lookup to an indexed SQL query or a trigram index. |
| Fuzzy candidate search | Linear scan with Levenshtein over every distinct brand name. Fine at 1,500 names, too slow at 150,000. | Trigram or BK-tree index; restrict by first character and length band. |
| Brand-collision queue | 565 collision groups today, covering 75 percent of products. At 100x the queue is unreviewable by hand. | Rank by prescribing volume, review the head of the distribution, add reviewer tooling for bulk decisions with audit. |
| Regulatory derivation | Recomputed per request over all events and matched against every product for list filters. | Materialize derived state per target per effective date; match on an ingredient-set index. |
| Ingestion | Single transaction, whole file in memory, `DELETE` then reinsert for reference tables. | Streaming parse, batched inserts, keyed upserts, per-dataset locks. |
| SQLite | Single writer, file on local disk. | Move to PostgreSQL with the same migrations; `pg_trgm` for names. |
| Retrieval | BM25 plus n-grams computed in process. Fine to roughly 100k chunks. | Dedicated search index with metadata filters, neural embeddings as an additive signal. |
| Evaluation | 17 cases run in milliseconds. At 100,000 answers the cost is the human adjudication, not compute. | See PART2_PLAN section 9. |

## 100 concurrent users

| Area | Strain | First fix |
|---|---|---|
| Single Node process | One event loop. A rail run measured about 36 ms in the seeded-prescription test (including database reads) and a Q&A answer under 15 ms, so CPU is not the first limit, but `CorpusIndex.build` per request in the trace path blocks for tens of milliseconds. | Cache the index; run two or more processes behind a proxy. |
| SQLite writes | Safety runs, QA runs and review decisions are writes; WAL helps readers but there is one writer. | PostgreSQL, or queue audit writes. |
| Review queue races | Two reviewers can decide the same item; the second decision silently overwrites status. | Optimistic concurrency on `updated_at` or a decision version. |
| No authentication or tenancy | Actor names are free text; all data is one tenant. | Identity provider, per-tenant schemas or row-level security (PART2_PLAN section 7). |
| In-memory job registry | Ingestion jobs live in a `Map`; lost on restart, not shared across processes. | Persistent job table or queue. |
| LLM composer (optional) | Per-request external call with no timeout budget or rate limit. | Timeout, concurrency cap, circuit breaker; keep the extractive answer as the instant fallback. |
| No rate limiting or request budget | Any client can run the trace endpoint repeatedly. | Per-tenant rate limits. |

## What does not strain

The safety rail itself: it is pure functions over small lookups. Its limits are data coverage and data freshness, not throughput.
