# GAPS_REGISTER.md: honest scope accounting

Severity of residual risk: H high, M medium, L low. Entries 1 to 17 are anomalies found in the supplied materials. Entries 18 onward are capabilities not built or built in a limited form.

## Anomalies in the supplied materials

| # | Gap, cut or anomaly | Where | What I did / what I would do with more time | Risk if left |
|---|---|---|---|---|
| 1 | Candidate brief says a 7-day window; the invitation email says 4 calendar days. | `input/01_CANDIDATE_BRIEF.md` vs email | Followed the assessment files for scope; planned to the shorter window. Raised in DAY2_QA. | L |
| 2 | Packet index says the seed template has 18 lines; the file has 17 data rows over 10 prescriptions. | `seed_prescriptions_template.csv` | Imported all 17; data-quality page states the count. Asked in DAY2_QA. | L |
| 3 | Brief and index refer to `data/` and `corpus/` directories; the zip is flat. | Packet | Reorganised into `input/data` and `input/corpus` by copy, with SHA-256 list so originals are verifiable. | L |
| 4 | 565 brand names map to more than one product (1,507 of 2,000 products, 75 percent). The first 30 products look curated; later rows are generated names with random single ingredients. | `cdci_drug_subset.csv` | Queued one BRAND_COLLISION item per name; resolver never auto-selects. With more time: ask whether collisions are intended, add volume-ranked review. | H |
| 5 | Every strength is labelled mg, including thyroxine (for example "Thyroxine 50 mg"), vitamin D3, folic acid, methylcobalamin. | CDCI strength columns (named `*_mg`) | `UNIT_SUSPECT` flag on 146 products, four UNIT_ANOMALY queue items, exposure totals for these ingredients flagged unverified. List is configuration, not clinical truth. | H |
| 6 | Strengths within one ingredient vary by up to 500x (for example glimepiride), which looks like generated filler. | CDCI | Statistical flag on the data-quality page; not treated as clinical judgement. | M |
| 7 | The 160 FDC rows contain 153 distinct compositions, many implausible combinations. Structured columns and strength text agree on all 160. | CDCI | Reported as internal consistency only (D-006). | H |
| 8 | No held-out verification sample was supplied for G2. | Brief section 5 | Gate reported UNVERIFIED with the measured proxy. Asked in DAY2_QA. | H |
| 9 | Pharmacy stock: 783 rows, 747 distinct billed names, 227 rows expired before the evaluation month, one line in Telugu script, 554 lines whose brand collides with several products, 92 lines whose billed form (for example TAB) conflicts with the master form. | `pharmacy_stock.csv` | All handled by parse then resolve then queue; expiry shown, not filtered. Only 117 lines map unambiguously. No transliteration attempted. | M |
| 10 | NLEM extract: 37 of 63 rows have no therapeutic category ("-"), duplicated iron entries, three names not in the master (iron salts, ORS, zinc sulphate). | `nlem_extract.csv` | Imported verbatim; unmatched names queued as REFERENCE_NAME; exact-name matching only. | L |
| 11 | NLEM and Jan Aushadhi carry no usable dates (NLEM edition only; Jan Aushadhi version label month only). | both files | Jan Aushadhi date derived from label with month granularity and flagged; NLEM measured from load time. | L |
| 12 | Interaction seed: 16 of its distinct names are not ingredients in the master (class terms like "Nitrates", plus drugs absent from the subset), so those pairs can never fire. | `severe_interaction_seed.csv` | Queued INTERACTION_TERM items; coverage reported inside every interaction result. | H |
| 13 | Regulatory register has no as-of date, so its freshness cannot be known. Some targets are free text: a ratio not stated ("specific ratio"), a paediatric-only scope, and a descriptive class ("codeine-based cough FDCs"). | `regulatory_gazette_events.csv` | Freshness from load time, labelled. Scope that cannot be confirmed is POSSIBLE, never an unqualified HIT. | M |
| 14 | NLEM 2022 still lists nimesulide and ranitidine, which the register later restricts or prohibits. | `nlem_extract.csv` vs register | Different dates, not a conflict; noted. Not used for status. | L |
| 15 | 13 STW PDFs against "12 current": STW-GP-02 exists in two editions (2021.1 archive, 2025.2 current). PDF metadata titles are empty; the page header is the only source of title, code, version and date. | `corpus/` | Parsed from page text; older edition marked SUPERSEDED from the newer page and the archive footer. | L |
| 16 | Q11 compares the clinic protocol with the national pack, but the pack has no adult undifferentiated-fever workflow. | `sample_questions.md` | National block abstains: agreement unknown, not asserted. | L |
| 17 | The STW pages, protocol and all clinical numbers are synthetic assessment text. | corpus | Treated as authoritative for grading only; no clinical review performed. | L |

## Capabilities not built or limited

| # | Gap | Where | Reasoning and next step | Risk |
|---|---|---|---|---|
| 18 | G2 (95 percent decomposition accuracy) cannot be demonstrated. | FDC explorer | Needs the held-out key. Reviewer verify/dispute workflow exists. | H |
| 19 | Module B criteria are builder-authored; 17 of 17 passing is a regression guard, not accuracy. | `eval/criteria.ts` | Needs an independent clinician-written key and many more questions. | H |
| 20 | Retrieval is lexical plus character n-grams; no neural embeddings. Synonyms and generic-term lists are heuristics. | `corpus/retrieval.ts`, `config.ts` | Adequate for 84 chunks; recall on unseen phrasing is unmeasured. | M |
| 21 | Optional LLM composer: a successful composition was never exercised (no valid key available). Verified live only that an invalid key returns the provider's real 401 and that the app falls back to the verbatim answer. The key is stored AES-256-GCM encrypted with a key file beside the database; that protects the database file alone, not the whole data folder or the running process. | `qa/llm.ts`, `secrets.ts` | Default path does not use it. Use a key with a spending limit. | L |
| 22 | No authentication, authorization or tenancy; reviewer name is free text. | API | PART2_PLAN section 7. | H for production, L for assessment |
| 23 | No patient context (medication list, age, weight, allergies, conditions). Interaction results say so. | rail | Part 2 patient-context integration. | H for production |
| 24 | Interaction coverage is 15 pairs, no severity gradation beyond SEVERE, no class mapping. | rail | Licensed or open interaction source and mapping (PART2_PLAN section 4). | H |
| 25 | Exposure totals only for tablets and capsules with parseable slot frequency; no liquids, injectables, durations, or daily maxima per ingredient beyond paracetamol. | `safety/engine.ts` | Needs a sourced ceilings table. | M |
| 26 | Regulatory matching is exact on ingredient set plus dose-form and paediatric flags; no strength-specific or brand-specific targets. | `regulatory/match.ts` | Extend once real notifications are parsed. | M |
| 27 | Concurrency: no optimistic locking on review decisions; in-memory job registry; per-request index builds. | API | See SCALE.md. | M |
| 28 | Accessibility checked by keyboard focus, labels and Mantine primitives only; no screen-reader or contrast audit. | web | Run an automated audit and manual pass. | M |
| 29 | Visual QA used one headless Chromium at two viewport widths; other browsers untested. | web | Cross-browser pass. | L |
| 30 | Clean-install test was run in a Linux container, not on Windows. Path handling avoids shell specifics and no native modules are used. | scripts | Run once on Windows. | M |
| 31 | No stretch items beyond those listed in SUBMISSION.md (for example no neural embeddings, no multilingual input, no patient-facing mode). | - | Deliberate: the mandatory core and honesty took priority. | L |
