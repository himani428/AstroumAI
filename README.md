# BRAHMO AI: Clinical Intelligence for Indian Outpatient Practice

Assessment build for the Senior Software Engineer role at Astroum AI. It implements Module A (drug master, normalization, event-sourced regulatory status, deterministic safety rail), Module B (grounded clinical Q&A with an evaluation harness), Module C (end-to-end trace), and a Part 2 plan.

This is a local assessment build. It is not a clinical product and must not be used for real patients.

## Run it

Prerequisite: Node.js 22.13 or newer (current LTS). Nothing else: no database server, no API key, no Python.

```bash
npm install
npm start
```

Open http://localhost:8787

The first `npm start` does three things automatically, about 10 to 20 seconds in total (measured: 10 seconds in a clean container, after a 16 second `npm ci`):

1. builds the web UI once into `dist/` (a few seconds);
2. creates `data/brahmo.sqlite`, applies the numbered migrations, and ingests all seven supplied datasets;
3. ingests the 13 STW PDFs and the clinic protocol, runs the ten seeded prescriptions and the Module B evaluation.

Later starts take about two seconds. Set `PORT` to change the port. All environment variables are optional, see `.env.example`.

To start from scratch delete `data/brahmo.sqlite*` and run `npm start` again.

## Verify it

| Command | What it does |
|---|---|
| `npm test` | 60 automated tests: safety rail, regulatory derivation, ingestion, retrieval and grounding, evaluation, trace, HTTP API |
| `npm run typecheck` | TypeScript strict mode, server and web |
| `npm run lint` | ESLint |
| `npm run build` | Production UI build |
| `npm run eval` | Module B harness over the 11 sample questions plus 6 supplementary cases; writes `reports/eval/latest.{json,md}` |
| `npm run seed:rx` | Re-runs the ten seeded prescriptions at the fixed demo date; writes `reports/seeded/*.json` and the completed template CSV |
| `npm run trace` | Writes `reports/trace/sample_trace.json` |
| `npm run ingest:dry` | Validates all datasets and reports counts without writing anything |

## What is where

| Path | Purpose |
|---|---|
| `input/` | The supplied packet, unchanged, with SHA-256 checksums in `input/SHA256SUMS.txt`. The app reads its datasets from here. |
| `server/src/ingest` | Reproducible ingestion with row-level provenance, dry-run, idempotency |
| `server/src/master` | Product index, resolver, prescription normalization |
| `server/src/regulatory` | Target parser, event-sourced status derivation, product matching |
| `server/src/safety` | The deterministic rail. No model, network or randomness; enforced by a test |
| `server/src/corpus`, `qa`, `eval` | PDF extraction, decision-unit chunking, hybrid retrieval, grounded answers, evaluation |
| `server/src/trace` | Module C trace builder |
| `server/src/api` | Express routes with zod validation and a uniform error shape |
| `server/src/db/migrations` | `001` to `004` numbered SQL migrations |
| `web/src` | React, TypeScript, Mantine UI |
| `prompts/` | Versioned prompt library |
| `reports/` | Checked-in outputs: seeded prescriptions, evaluation, sample trace |
| `DESIGN.md`, `SCALE.md`, `GAPS_REGISTER.md`, `DAY2_QA.md`, `PART2_PLAN.md`, `SUBMISSION.md`, `CLAUDE.md` | Required documents |

## Screens

Dashboard, India Drug Master (with drug detail and provenance), FDC Explorer, Ambiguity Review queue, Regulatory Register (timeline, as-of date, source-change simulation), Prescription Safety (draft workspace and the ten seeded prescriptions), Clinical Q&A (claim-level citations, evidence drawer, edition comparison), Evaluation, End-to-end Trace, Data and Ingestion (including data quality), Audit and Settings, Global Search.

## Honest status in one paragraph

Everything mandatory is implemented and exercised by tests. Three things are deliberately reported as unverified rather than claimed: gate G2 (no independent verification key was supplied, so the 95% figure cannot be measured; the 100% reported is internal consistency of one source), the Module B evaluation criteria (written by the builder, so the result is a regression guard, not an accuracy figure), and the optional LLM composer (the verifier is tested, the live API call was not exercised). See `GAPS_REGISTER.md`.

## Optional components

| Component | Status |
|---|---|
| Anthropic API key | Optional. Paste it in the app under **Audit and Settings, Anthropic API key** (save, test connection, remove). It is stored encrypted in the local database, not in `.env`, and never returned to the browser. Enables an LLM wording step for Module B only, verified against retrieved text; never reachable from the safety rail. `ANTHROPIC_API_KEY` in the environment still works as a fallback. |
| Neural embeddings | Not used. Retrieval is BM25 plus a character n-gram similarity, both local. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Node.js 22.13 or newer` message | Install the current Node LTS. The build uses the built-in `node:sqlite` module, which avoids native compilation on Windows. |
| Port already in use | `PORT=8800 npm start` (PowerShell: `$env:PORT=8800; npm start`) |
| Blank page after upgrading code | `npm start -- --rebuild` rebuilds the UI |
| Want a clean database | Stop the server, delete `data/brahmo.sqlite*`, start again |
| Dashboard shows "Degraded" | Click the status pill. Each entry names the failing component and its effect |
| SQLite warning in the console | Node prints an experimental notice for `node:sqlite`; the start script suppresses it |

## Windows notes

Tested path: Node 22 LTS, PowerShell or cmd, `npm install` then `npm start`. No compiler, Python, Docker or admin rights are needed. Scripts avoid shell-specific syntax.
