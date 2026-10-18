# SUBMISSION.md

- [x] **How to run:** [README.md](README.md). `npm install` then `npm start`, open http://localhost:8787. Migrations and all data loads run automatically on first start (about 10 to 20 seconds). Needs Node.js 22.13 or newer and nothing else.
- [x] **DESIGN.md:** [DESIGN.md](DESIGN.md). Opens with the system restatement and three riskiest assumptions; 20 decisions each with a rejected alternative; a section on what the AI tooling got wrong.
- [x] **SCALE.md:** [SCALE.md](SCALE.md)
- [x] **Gaps register:** [GAPS_REGISTER.md](GAPS_REGISTER.md). 17 anomalies in the supplied data and 14 capability gaps.
- [x] **Day-2 Q&A:** [DAY2_QA.md](DAY2_QA.md)
- [x] **Prompt library and conventions:** [prompts/](prompts/) (versioned, hashed into every trace) and [CLAUDE.md](CLAUDE.md)
- [x] **Mini-eval results:** [reports/eval/latest.md](reports/eval/latest.md) and `latest.json`. Core 11: 9 correct, 2 correctly abstained, 0 wrong. Supplementary 6: 4 correct, 2 correctly abstained, 0 wrong. The criteria were written by the builder, so this is a regression guard and not an accuracy figure.
- [x] **Seeded-prescription rail outputs (all 10):** [reports/seeded/](reports/seeded/) (`RX01.json` to `RX10.json`, `ALL.json`, and the completed template `seed_prescriptions_completed.csv`). Also visible in the UI under Prescription Safety, tab "Ten seeded prescriptions".
- [x] **End-to-end trace:** [reports/trace/sample_trace.json](reports/trace/sample_trace.json) with its input. Also the Trace page.
- [x] **Part 2 plan:** [PART2_PLAN.md](PART2_PLAN.md). 5 weeks to test-ready.
- [ ] **Repository access:** not applicable to a zip delivery; to be granted on request.

## Acceptance gates

| Gate | Status | Evidence |
|---|---|---|
| G1 Reproducibility under one hour | Verified in a clean Linux container (install, start, first load) | Fresh extract of the zip: `npm ci` 16 s, `npm start` to healthy API and UI 10 s, then tests, typecheck, lint and build all green in that copy. Not run on Windows. |
| G2 Decomposition accuracy at least 95 percent | **UNVERIFIED** | No held-out key supplied. 160 of 160 FDC rows are internally consistent (two derivations of one source row); 0 clinician-verified. FDC page states this. |
| G3 No silent resolutions | Met by construction and tested | 565 brand collisions, 665 stock lines, unit and decomposition issues, interaction terms and every ambiguous prescription line are queued with reason codes (`tests/ingestion.test.ts`, `tests/api.test.ts`). |
| G4 Rail demonstration | Met for the seeded set | RX01, RX02, RX03, RX07, RX09 flagged; RX05 and RX06 clean; RX04, RX08, RX10 shown as unknowns. Statuses HIT, CHECKED_NO_HIT, PARTIAL_COVERAGE and UNVERIFIED_INPUT occur in the seeds; NOT_CHECKED, DATA_EXPIRED, SOURCE_CONFLICT and SERVICE_UNAVAILABLE are demonstrated by tests and by the UI (as-of date, outage simulation, source-change simulation). Zero false negatives is claimed only against the seeded set and the unit tests. |
| G5 Provenance | Met | Every product, ingredient, event and stock row links to a source row, batch, file hash; every check result lists source references and a data fingerprint. Dashboard shows 100 percent coverage. |
| G6 No uncited clinical number | Met for the default path | Claims are verbatim retrieved bullets; a guard verifies every number against the cited excerpt (`guard.passed` in every answer). |
| G7 Architecture judgment | Met | DESIGN.md decisions D-001 to D-020 each have a rejected alternative. |

## Verification results

`npm test`: 60 passed in 6 files. `npm run typecheck`: clean. `npm run lint`: clean. `npm run build`: succeeds. Final command output is reproduced in the delivery message.

## Unfinished, and why I prioritized as I did

Order of work: assessment gates and honesty first, then the deterministic rail, then grounding, then UI, then extras.

- Not done: neural embeddings, live test of the optional LLM composer, authentication and tenancy, patient context, Windows run, a screen-reader audit. All are listed in GAPS_REGISTER.md with risk.
- Stretch items present: provenance explorer (drug detail), global search, review audit history, exportable JSON for reports and traces, demo labelling, status panel, searchable audit log, CLI for ingestion and evaluation, keyboard-accessible dialogs and drawers, reduced-motion support, data-quality dashboard, source-change simulation.
- Stretch items absent: side-by-side clinical source comparison beyond editions of one workflow (editions are covered), multilingual input, patient-facing mode.
