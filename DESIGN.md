# DESIGN.md: BRAHMO AI assessment build

## 0. The system in my own words

BRAHMO is a clinical assistant for Indian outpatient doctors in which two kinds of answer are kept strictly apart. Medication safety (duplicate ingredients after fixed-dose-combination decomposition, regulatory status, severe interactions, cumulative exposure) is answered by a deterministic, versioned rail over lookup data, with eight explicit statuses so that missing or incomplete data can never look safe. Clinical knowledge is answered by retrieval over a closed, cited corpus, quoted as written, with abstention when the corpus does not cover the question. Identity is the hinge between them: a brand name must be resolved to a product and its ingredients before any check can run, and every uncertain resolution goes to a human review queue instead of being guessed. This Part 1 build proves the mechanisms on the supplied data: ingestion with provenance, event-sourced regulatory status, the review queue, the rail with all eight states, grounded Q&A with an evaluation harness, and one end-to-end trace. It does not prove clinical accuracy, scale, or real-world data coverage.

## 0.1 The three riskiest assumptions I see in the provided materials

1. **That a brand name identifies a product.** In the CDCI subset 565 brand names (1,507 of 2,000 products, 75 percent) map to more than one product with different compositions, and the filler rows after the first 30 are generated names with implausible strengths. The whole rail rests on resolving "what did the doctor mean". If real data collides like this, auto-resolution is unsafe and review volume becomes the operational bottleneck, not model quality.
2. **That one ingredient-level interaction seed and one 12-event register are enough to say "no hit".** The seed has 15 pairs, 16 of its names are not even in the drug master (class terms such as "Nitrates"), and the register has no declared as-of date. A clean result is therefore a statement about coverage, not about the patient. The risk is that a green screen is read as clearance.
3. **That decomposition accuracy can be measured from the data supplied.** G2 asks for 95 percent against a held-out sample that was not provided. The two derivations available (structured columns and the strength text) come from the same source row, agree on all 160 rows, and are therefore weak evidence. Also every strength is labelled mg, including thyroxine, vitamin D3, folic acid and methylcobalamin, so units cannot be trusted for exposure totals.

## Decisions

### D-001: Node.js, TypeScript and the built-in SQLite module
- **Decision:** One TypeScript codebase (Express API, React UI), `node:sqlite` for persistence, numbered SQL migrations.
- **Why:** The requirement is a Windows machine running `npm install` and `npm start` in under an hour. `node:sqlite` needs no native compilation, no server and no Python. Migrations are plain SQL that port to PostgreSQL.
- **Rejected:** `better-sqlite3` (prebuilt binary or compiler required on Windows, a known first-run failure); PostgreSQL in Docker (an unmentioned prerequisite the brief forbids hiding); a Python service for PDFs (second runtime, more setup, no gain because `pdfjs-dist` extracts these pages well).
- **Implication:** Requires Node 22.13 or newer (checked at start). Single writer; see SCALE.md.

### D-002: Preserve every source row verbatim; derive everything else
- **Decision:** Every row of every file is stored in `source_rows` as raw JSON with a hash and a disposition (IMPORTED, REJECTED, DUPLICATE, with reason codes). Derived tables carry `batch_id` and `source_row_id`.
- **Why:** G5 requires 100 percent provenance, and "never silently discard" requires rejects to be visible. The supplied files are the evaluation baseline.
- **Rejected:** Normalizing in place and keeping only clean tables (loses the audit trail); logging rejects to a file only (not queryable, not in the UI).
- **Implication:** Storage roughly doubles; acceptable. Any new derived table must carry the two provenance columns.

### D-003: Idempotent ingestion by file hash, with a rolled-back dry run
- **Decision:** An unchanged file (same SHA-256 as the last committed batch) is skipped. A dry run executes the whole pipeline inside a transaction that is rolled back, so its counts are real.
- **Why:** Re-running must be safe, and validation must exercise the same code as the real load.
- **Rejected:** A separate "validate" code path (drifts from the real one); row-level upsert only (cannot tell the operator that nothing changed).
- **Implication:** A changed file replaces that dataset's derived rows and keeps the old batch history. Product rows use upsert so alias confirmations stay valid.

### D-004: The resolver never selects by score
- **Decision:** `resolveProduct` returns RESOLVED only for a unique exact brand match whose written strength (if any) agrees with the master, or a human-confirmed alias. Everything else is NEEDS_REVIEW or UNRESOLVED with candidates and reason codes. Fuzzy and prefix matches are suggestions for the reviewer.
- **Why:** Law and G3: no silent resolution. A "Telma" that is really "Telma 40", "Telma 20" or "Telma-H" is a safety-relevant difference.
- **Rejected:** Auto-accepting the top fuzzy candidate above a threshold (any threshold hides a wrong-drug risk); an LLM re-ranker (probabilistic authority over identity).
- **Implication:** Many prescriptions will need review. The queue is a first-class feature, and reviewer decisions create audited aliases that the resolver then trusts.

### D-005: Unit disagreement is a reason code, not a silent conversion
- **Decision:** Written "50 mcg" against master "50 mg" (same number, different unit) yields `STRENGTH_UNIT_MISMATCH` and NEEDS_REVIEW. Four ingredients normally dosed in mcg or IU are flagged `UNIT_SUSPECT` and their exposure totals are not reported as complete.
- **Why:** A factor-of-1000 error is the exact failure the rail exists to prevent; the data labels every strength mg.
- **Rejected:** Converting units to match; ignoring the label.
- **Implication:** Thyroxine lines always need review until the source is corrected. The suspect-ingredient list is configuration, not clinical truth.

### D-006: FDC decomposition verification vocabulary
- **Decision:** Two independent derivations per row (structured columns, parsed strength text). Agreement is stored as `CROSS_CHECKED_SAME_SOURCE` with confidence 0.99; disagreement as `DISCREPANCY` with confidence 0.5 and a queue item. A reviewer can set `REVIEWER_VERIFIED` or `DISPUTED_BY_REVIEWER`. The dashboard reports 160 of 160 internally consistent and 0 clinician-verified.
- **Why:** The honest statement is that agreement within one source is not accuracy. G2 is reported as UNVERIFIED.
- **Rejected:** Labelling agreed rows "verified" (manufactures a pass); fabricating more FDC rows to reach a count (forbidden).
- **Implication:** The 95 percent gate needs the held-out key (DAY2_QA question 1). The pipeline and review workflow are ready for it.

### D-007: Regulatory status is derived from events at an as-of date
- **Decision:** `deriveTargets(events, asOf)` computes state from effective-dated events and supersession links: in force, minus superseded, leaves active; unlinked disagreement is SOURCE_CONFLICT; dangling links and ordering problems are reported as anomalies. Time travel is supported (NimuPar-P is STAYED between EV002 and EV003).
- **Why:** A boolean is explicitly forbidden and cannot represent a stay, a re-prohibition or a future-dated rule.
- **Rejected:** A `banned` column; materialized status updated by triggers (hides history and breaks as-of queries).
- **Implication:** Status is recomputed on demand (cheap now, see SCALE.md). Free-text targets are parsed by a deterministic parser; scope the parser cannot confirm (paediatric use, specific ratio, descriptive class) yields POSSIBLE, which never becomes an unqualified HIT.

### D-008: Check statuses and aggregation precedence
- **Decision:** Per check: HIT if a rule fires (even with limitations); otherwise SOURCE_CONFLICT, DATA_EXPIRED, then UNVERIFIED_INPUT (nothing resolved) or PARTIAL_COVERAGE (some unresolved or unconfirmable), and CHECKED_NO_HIT only when the check ran with full coverage. Severity (CRITICAL, HIGH, MODERATE, LOW, INFO, NONE) describes magnitude and never alters status.
- **Why:** A finding must not be hidden by an unrelated limitation, and a limitation must not be hidden by an absent finding.
- **Rejected:** A single traffic-light per prescription (collapses distinct unknowns); returning CHECKED_NO_HIT with a warning field (the status itself is what gets read).
- **Implication:** `all_checks_clean` is true only if all four checks are CHECKED_NO_HIT, and even then the report says it is not clinical clearance.

### D-009: What CHECKED_NO_HIT means for the 15-pair interaction seed
- **Decision:** CHECKED_NO_HIT is returned when every line resolved and no pair matched, with the scope stated in the result: seed list only, which pairs are evaluable against the master, which prescribed ingredients have no seed coverage at all, and that no patient medication list was supplied.
- **Why:** Always returning PARTIAL_COVERAGE would make every result PARTIAL, which trains users to ignore the status (alert fatigue) and makes the vocabulary useless.
- **Rejected:** PARTIAL for any result built on a seed list.
- **Implication:** If the product owner prefers the stricter reading it is a one-line policy change, recorded as DAY2_QA question 4.

### D-010: Cumulative exposure from parsed frequency only
- **Decision:** Daily total per shared ingredient equals the sum over lines of units per day times mg per unit. Units per day come only from a parsed schedule ("1-0-1", "1-1-1 x 3d", "BD"); liquids, "SOS", missing or unparseable frequencies make that line non-computable and the total a lower bound, with PARTIAL_COVERAGE. A cited population ceiling (paracetamol 3 g per day, quoted by two STW pages) raises severity only when even the lower bound exceeds it.
- **Why:** The brief forbids inventing schedules or units. A lower bound that already exceeds a ceiling is still a valid finding.
- **Rejected:** Assuming "SOS means three times a day"; converting syrup volumes; per-patient maximum doses (a prohibited calculator).
- **Implication:** RX01 (Dolo 650 plus Sinarest) shows 2,300 mg per day of paracetamol, below the 3,000 mg reference, so the duplicate check is a HIT and the cumulative check is CHECKED_NO_HIT. The danger the seed intends (hidden duplication through an FDC) is caught by the duplicate check, and the report states the total honestly rather than inflating it.

### D-011: Event-driven freshness with an explicit basis
- **Decision:** Each dataset has a freshness limit and a basis: declared source date when the file carries one (CDCI), otherwise load time, labelled `LOAD_TIME_ONLY`. A clean check on expired data returns DATA_EXPIRED. Demonstration prescriptions are evaluated at a fixed date (2026-10-15) so outputs are reproducible; real requests use today.
- **Why:** The register and interaction seed declare no as-of date, so inventing one would be fabrication; limits are configuration pending the product owner's policy.
- **Rejected:** No freshness at all; treating file modification time as the source date.
- **Implication:** Limits in `config.ts` are placeholders and are listed as such in the UI.

### D-012: Decision-unit chunking with section and page anchors
- **Decision:** One chunk per bullet (a recommendation, red flag, contraindication or workflow step), carrying page, section heading, kind and a stable anchor. Document code, version, effective date and supersession come from each page's own header and footer. A second edition of the same code makes the older one SUPERSEDED.
- **Why:** The clinical unit is the bullet; blind slices would split a dose from its drug. Page metadata is the source of truth for editions.
- **Rejected:** Fixed-length windows with overlap; one chunk per page (cannot cite a single recommendation).
- **Implication:** Extraction is tied to this layout. Extraction quality is recorded per document and shown in the UI.

### D-013: Retrieval is hybrid, local and ranked by the chunk's own text
- **Decision:** BM25 over each chunk's own text and section, a character-trigram TF-IDF similarity as a local semantic approximation, a separate document prior from title and condition, question-intent boosts (red flags, avoid, first-line, alternative), and residual-term selection so a question naming a drug finds the unit that names it. Weights and thresholds are configuration.
- **Why:** An early version indexed title tokens into every chunk and could not choose between bullets of the right document; separating the prior fixed it. A deterministic path must work without external services.
- **Rejected:** Neural embeddings as the only path (not available offline, not deterministic); a vector database (more infrastructure than 84 chunks justify).
- **Implication:** This is tuned on 11 questions plus 6 held-out cases, which is small. It will need a broader evaluation set before anyone trusts its recall (PART2_PLAN section 9).

### D-014: Abstention gates before any claim is built
- **Decision:** Four gates: topic coverage (share of salient question terms present in the best document), absent specific terms (a long topic word found nowhere in the scoped corpus, such as "undifferentiated" for the national pack), population mismatch (child question against an adult workflow), and a minimum chunk score. On failure the answer states what evidence is missing and lists nearest documents without drawing a claim from them.
- **Why:** Q9 and Q10 must abstain, and a confident wrong answer is worse than none. The population gate stops reuse of the adult hypertension page for a child.
- **Rejected:** Always answering with the top chunk and a caveat; asking a model whether the evidence is sufficient (probabilistic authority over a safety-adjacent decision).
- **Implication:** The gates use word lists (generic terms, exempt terms) that are heuristics; they err toward abstaining.

### D-015: Extractive, verbatim answers by default; claim-level citations
- **Decision:** Each claim is a retrieved bullet, verbatim, with a structured citation (document, version, effective date, edition status, page, section, anchor, excerpt). A guard checks that every number in a claim appears in its cited excerpt and drops claims without a citation. An optional LLM composer may rephrase only inside a verifier that rejects any ungrounded number or missing evidence id, and falls back to the verbatim answer.
- **Why:** G6 holds by construction for the default path. The doctor sees the source wording.
- **Rejected:** Free-form generation with citations appended afterwards; summarizing across editions.
- **Implication:** Answers read as quoted bullets, not prose. The composer is untested against the live API.

### D-016: Editions and sources are shown side by side, never merged
- **Decision:** When retrieval lands in a workflow that has several editions, the primary answer uses the edition the page metadata marks current, and a comparison panel shows both with dates and status. The clinic protocol and the national pack are separate labelled blocks; if the pack has no equivalent workflow the national block abstains and says that agreement cannot be confirmed.
- **Why:** The brief's law: show both, never silently merge. "Unknown" and "no divergence" are different statements.
- **Rejected:** Letting a model reconcile the sources; answering only with the latest edition and hiding the older one.
- **Implication:** Supersession is reported from page metadata and not re-judged.

### D-017: Evaluation criteria are explicit, per question, and honest about authorship
- **Decision:** Each case lists required and forbidden text, required citations and block states. Outcomes are CORRECT, CORRECTLY_ABSTAINED or WRONG with an explanation per check. The disclaimer that the criteria were authored by the builder is part of every report. Supplementary cases test the fences (dose calculation, population mismatch, regulatory routing, injected instruction).
- **Why:** Plausible-sounding is not correct. Outcomes must be reproducible.
- **Rejected:** An LLM judge (same circularity and not available offline); reporting a single accuracy percentage.
- **Implication:** Passing 17 of 17 is a regression guard. It is not an accuracy figure and the UI says so.

### D-018: Review queue as the single place for uncertainty
- **Decision:** One table for brand collisions, stock lines, prescription lines, unit anomalies, decomposition discrepancies, reference names and interaction terms, each with reason codes, candidates, method and confidence. Decisions are append-only rows (`review_decisions`) plus an audit entry, with before and after state. Only prescription and stock lines can be resolved to a candidate; collisions cannot be resolved globally.
- **Why:** Law G3 and an auditable human override.
- **Rejected:** Separate screens per problem type; allowing a global alias for a colliding brand (would silently pick one of several products for every future prescription).
- **Implication:** Reviewer identity is free text in this build (no authentication); see GAPS_REGISTER.

### D-019: Mantine UI with semantic colour
- **Decision:** React with Mantine components, no CSS files, a warm neutral palette with navy, teal and sage, rust for findings and clay for uncertainty. CHECKED_NO_HIT is an outlined neutral badge, never green. Every incomplete status sits in its own group above clean results.
- **Why:** Accessible primitives (drawers, modals, tabs) quickly, consistent behaviour, and the colour rule that "no hit" must not look like "safe".
- **Rejected:** Tailwind with hand-built components (more surface to get wrong in the time available); a green "all clear" state.
- **Implication:** Large bundle (about 685 kB, 204 kB gzipped); acceptable locally.

### D-020: Additional data
- **Decision:** No data was added beyond the supplied files. The derived mapping tables are all computed from them.
- **Why:** Time went to correctness and provenance of the baseline; the 160 FDC rows already exceed the 100-product minimum on count, and independent data would not have been verifiable without the held-out key.
- **Rejected:** Scraping public sources for extra FDCs (licensing and provenance cost, no way to verify).
- **Implication:** Coverage is limited to the supplied 2,000 products and 15 interaction pairs.

### D-021: The optional API key is entered in the UI and stored server-side, encrypted
- **Decision:** A settings screen saves an Anthropic key to the local database (AES-256-GCM, random key in a separate file next to the database). The API returns only a masked tail, never the key, and the key is excluded from audit details, traces, reports and logs. A saved key overrides the optional environment variable. Test connection makes a real call and shows the provider's actual error.
- **Why:** The product owner asked for in-app entry rather than `.env`. Keeping the key server-side avoids exposing it to browser storage or exports.
- **Rejected:** Browser `localStorage` (readable by any script on the page, sent with every request); plain-text storage in the database (a copied database file would leak it); requiring `.env` edits and a restart.
- **Implication:** Protection is limited to the database file on its own. The key is still usable by anyone with access to the running app or the data folder. The safety rail cannot reach it: `secrets.ts` is on the forbidden-import list in the isolation test.

## What the AI tooling got wrong while building this

Recorded because the brief asks how AI assistance was used and checked.

1. Retrieval first returned the wrong bullet inside the right document (title tokens indexed into every chunk). Caught by reading the 11 answers, not by a test; fixed by the document prior (D-013). Held-out cases S01 to S06 were then added so tuning was not judged only on the sample questions.
2. The stemmer turned "tuberculosis" into "tuberculosi", so the abstention message showed a garbled term. Caught in output review; stem rules now skip words ending in is, us, ss.
3. "Calculate the dose..." abstained because "calculate" counted as a missing topic word, which would have hidden the dose-fence behaviour. Found by the supplementary case S03; "calculate" is now a generic term.
4. The register citation guard failed because the as-of date in a claim was not in its citation. Found by S05; the citation now carries `as_of`.
5. The optional LLM verifier counted the digit in an evidence id such as "[E1]" as an ungrounded number and would have rejected every valid composition. Found by a unit test.
6. A shell command that killed a process by name also killed the working shell, so a first batch of test files was never written. Noticed because the suite reported no test files; the files were rewritten and the suite run again. The count in the README comes from the final run.
