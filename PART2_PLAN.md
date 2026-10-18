# PART2_PLAN.md: from this build to a 100-doctor production test

Status of every number below: **Fact** means observed in the supplied materials or in this build. **Estimate** means my judgement, to be replaced by measurement. Nothing in this plan claims the Part 1 code is production-ready. It is not.

## 0. The goal and the duration I chose

Goal: 100 doctors use the system at the same time, each putting at least 1,000 real questions to it, and their satisfaction is measured against the general assistants they use today. The plan ends when that test can start with a defensible chance of succeeding.

**Duration: 5 weeks to test-ready, then the test itself runs 2 to 3 weeks on top.** Reasoning:

- Three weeks is feasible for engineering alone. It is not feasible for the things that actually gate this test: clinician sign-off on safety rules, source licensing, and building a question set with an independent answer key. Those have human lead times (section 7).
- Six weeks would let engineering expand into features that the test does not need (language, patient-facing mode, more specialties).
- Five weeks gives one week per risk-bearing block (foundation, grounding, safety and patient context, platform, pilot readiness) and a hard stop for rehearsal. If the clinical lead cannot be in place in week 1, the plan becomes six weeks, not five weeks of lower quality; that is the one explicit slip rule.

## 1. Completion architecture

### 1.1 What exists after Part 1 (Fact, see DESIGN.md)

Ingestion with row-level provenance and a review queue; event-sourced regulatory status; a deterministic rail with eight statuses over four checks; decision-unit chunking and hybrid retrieval over 14 documents (84 chunks); verbatim answers with claim-level citations and abstention gates; an evaluation harness with 17 cases; one end-to-end trace; a Mantine UI; 59 tests.

### 1.2 What is missing (Fact unless marked)

| Area | Missing |
|---|---|
| Data | Real, current drug master, regulatory notifications, interaction knowledge. The supplied subset has 565 colliding brand names and mg-labelled mcg drugs. |
| Safety coverage | 15 interaction pairs; no class mapping; no allergy, pregnancy, renal, age rules; exposure ceilings only for paracetamol. |
| Patient context | None. The rail sees only a draft. |
| Grounding | 14 one-page documents. Real use needs thousands of pages across specialties, with editions. |
| Platform | One process, SQLite, no authentication, no tenancy, no queue, no rate limits, no observability beyond logs. |
| Quality | Builder-authored criteria; no clinician key; no sampling-based assurance; no human feedback capture. |
| Product | No doctor workflow integration, no language support, no latency budget. |

### 1.3 Target architecture

```
 Doctor UI (web, tablet first)            Admin and review console
        |                                         |
        v                                         v
 API gateway: authn/z, tenant resolution, rate limits, request ids
        |
        v
 Orchestrator (stateless, replayable)
   1 identity resolution  ---> drug master + alias store + review queue
   2 patient snapshot     ---> context service (read-only, per tenant)
   3 safety rail          ---> rules + versioned data   (NO model)
   4 retrieval + grounding --> search index + corpus store
   5 composition          ---> extractive by default; LLM optional, verified
   6 trace + audit write  ---> append-only event log
        |
        v
 Postgres (tenant schemas / RLS)   Object store (source files)   Search index   Queue + workers
        ^
 Freshness watchers: source change -> re-ingest -> re-derive -> re-evaluate -> notify
```

Principles carried over from the architecture document and this build: the rail has no model; identity is resolved by humans when uncertain; regulatory status is derived, never stored; every output carries versions; every answer is replayable from the trace.

**Grounding corpus at scale.** Corpus store keeps each source file, its hash, extracted pages and decision units. Ingestion is a pipeline with per-document quality gates (text coverage, header parse, edition parse). Search index holds lexical and embedding fields with metadata filters (specialty, population, edition status, source type). Embeddings are added as a second signal; the lexical path stays as the deterministic fallback. Editions are first-class: a document code has an ordered edition chain, and a question that lands in a multi-edition workflow always returns the comparison view.

**Expanded safety coverage.** Rules are data plus a small set of versioned evaluators. Each rule row carries source, version, effective dates, reviewer, sign-off date and status (DRAFT, SIGNED_OFF, RETIRED). Only SIGNED_OFF rules serve; a DRAFT rule is visible in a shadow mode that records what it would have fired without showing it, which gives a false-positive estimate before sign-off. Coverage is a computed artifact: for every prescribed ingredient, which rule families have any knowledge of it, shown in every result so that "no hit" always states its scope.

**Patient-context integration.** A read-only snapshot object (allergies, current medications, conditions, age band, pregnancy flag, renal flag) supplied by the tenant's system or entered by the doctor. Snapshots are tenant-scoped, versioned and attached to the trace. Missing fields produce UNVERIFIED_INPUT for the checks that need them, never defaults. No dose is calculated for the patient; the rail reports exposure and rule matches only.

**Orchestration and audit/replay.** The orchestrator is a pure function of (request, snapshot, data versions, rule versions, corpus version, prompt versions). Every request writes one immutable trace row. Replay re-executes with the recorded versions and must reproduce the rail output byte for byte (excluding timestamps); a mismatch is a release-blocking defect.

**Freshness.** Per-source watchers poll or accept pushes (gazette, CDSCO lists, corpus documents). A change triggers: new batch, derived-state diff, re-run of the seeded and shadow prescriptions, evaluation re-run, and an alert if any status changes. Datasets carry freshness limits and a declared as-of date; where a source declares none, the plan requires the data team to record one at load (the supplied register had none).

**Multi-tenant isolation.** Tenant id on every row, enforced by Postgres row-level security with the tenant set per connection; separate encryption keys per tenant for patient snapshots; the global drug master and corpus are shared read-only; aliases and review decisions are per tenant by default, with an explicit promotion path to global after clinical review. A tenant-isolation test suite runs in CI and as a nightly job against production-like data.

**Concurrency for 100 simultaneous doctors.** Estimate: 100 doctors, one question every 20 to 30 seconds while active, so 3 to 5 requests per second sustained and 15 per second in bursts. The rail is a few indexed reads and arithmetic (about 36 ms in this build including database reads); retrieval over a dedicated index is tens of milliseconds. The long pole is any LLM call, which is why extractive is the default and the LLM wording step is optional with a timeout and a fall-back. Targets: p50 under 1.5 s and p95 under 4 s for a full answer with rail; p95 under 800 ms for rail alone. Two application instances behind a proxy, Postgres with a pooler, and a load test at 3 times expected peak is a week-4 gate.

## 2. Week-by-week plan with binary gates

**Team (Estimate):** 1 technical lead and architect (owns rail, orchestration, review), 1 full-stack engineer (UI, API, auth, tenancy), 1 data and retrieval engineer (ingestion, corpus, search, evaluation tooling), 1 clinical lead (physician or clinical pharmacist, about 60 percent, owns sign-off and the answer key), 1 clinical reviewer pool (3 to 4 contract pharmacists and physicians, about 15 hours each per week from week 2), 0.3 product and QA, 0.2 legal and regulatory advisor. That is 4 core engineers and clinicians, plus part-time support.

**What AI-first development covers:** scaffolding, parsers, migrations, test generation, UI, documentation drafts, load-test scripts, first-pass extraction and candidate mappings, and a first draft of rule data from sources. **What humans must do:** every safety rule sign-off, source licensing decisions, the answer key and adjudication, security and privacy review, tenant-isolation review, and deciding what to do when sources disagree. AI output is never a source of clinical truth and never signs off.

### Week 1: Foundation and decisions

Deliverables: PostgreSQL migration with the existing numbered schema; authentication and tenant model; the data-owner decisions on collisions, units and freshness (DAY2_QA 2, 3, 6); real data load plan for the drug master; clinical lead and reviewers onboarded; licensing review started; evaluation question collection started (doctors submit real questions, de-identified).

Binary gates:
- G-W1-1: Migrations apply to an empty Postgres and all 59 existing tests pass unchanged.
- G-W1-2: A request without a valid token is rejected and a tenant A user cannot read tenant B review items (automated test).
- G-W1-3: Written decision recorded for each of: brand identity key, unit authority, freshness limits per dataset.
- G-W1-4: Licence status table exists with an owner and a decision for every candidate source (free, licensed, must-build, excluded).

### Week 2: Grounding at scale and the answer key

Deliverables: corpus pipeline for all permitted sources with per-document quality report; search index with metadata filters; embeddings as a second signal; edition chains; evaluation set v1 of at least 1,500 questions with a clinician-written key (what the answer must contain, which source, or that it must abstain), stratified by specialty, population, dose-related, edition-sensitive and out-of-corpus.

Gates:
- G-W2-1: Every ingested document has a recorded extraction quality result; documents below the coverage threshold are excluded and listed.
- G-W2-2: On the v1 set, no answer contains a number absent from its cited text (automated, count must be 0).
- G-W2-3: Out-of-corpus questions (at least 15 percent of the set) are abstained at 95 percent or better, and the wrongly answered ones are listed.
- G-W2-4: Key authorship recorded; at least 20 percent of items double-keyed with agreement reported.

### Week 3: Safety expansion and patient context

Deliverables: rule data model with sign-off states and shadow mode; interaction, allergy-relation and pregnancy rule families for the top-prescribed ingredients, each rule with a source and a reviewer; class-to-ingredient mapping owned by the clinical lead; patient snapshot service; rail consuming the snapshot; coverage report per ingredient.

Gates:
- G-W3-1: 100 percent of serving rules are SIGNED_OFF with a named reviewer and source; unsigned rules are shadow only (automated check).
- G-W3-2: A held-out set of at least 300 prescriptions with known-bad cases written by the clinical lead: recall 100 percent on known-bad (zero false negatives), and every false positive reviewed and either fixed or accepted by the clinical lead.
- G-W3-3: With no snapshot supplied, every snapshot-dependent check returns UNVERIFIED_INPUT, never a clean status (automated).
- G-W3-4: Replay of 1,000 recorded rail runs reproduces byte-identical results.

### Week 4: Platform, performance and observability

Deliverables: two-instance deployment, pooler, rate limits, background workers, trace and audit store, freshness watchers on the main sources, dashboards and alerts, backup and restore, security review.

Gates:
- G-W4-1: Load test at 3 times expected peak (45 requests per second for 30 minutes): p95 under 4 s end to end, error rate under 0.5 percent, rail p95 under 800 ms.
- G-W4-2: A simulated source change (a new gazette event) re-derives status, re-runs the shadow set and raises an alert within 15 minutes.
- G-W4-3: Restore from backup into an empty environment succeeds and passes the tenant-isolation suite.
- G-W4-4: External security review has no open high finding; penetration of tenant boundaries found nothing.

### Week 5: Pilot readiness and rehearsal

Deliverables: shakedown with 10 doctors for 3 days (about 1,000 questions), triage of every defect, review-queue staffing plan, feedback capture in the UI (per-answer rating, reason codes, free text), the fair-comparison harness and analysis plan frozen, runbooks, a go or no-go review.

Gates:
- G-W5-1: Shakedown: zero critical defects open (a critical defect is a wrong identity resolved silently, an unchecked state shown as safe, a fabricated or misattributed citation, or a tenant data leak).
- G-W5-2: Sampled quality of shakedown answers meets the release thresholds in section 6.
- G-W5-3: Review-queue backlog from the shakedown is below 24 hours of work for the staffed reviewers.
- G-W5-4: The comparison protocol is pre-registered (metrics, sample, analysis) and signed by the clinical lead and product owner before any result exists.

## 3. Sources and data strategy

Rights note: I have not verified current licence terms for any source below. Each is a to-do for the legal advisor in week 1 (G-W1-4). "Free" means no fee to obtain, not necessarily free to redistribute or to embed in a commercial product.

| Need | Candidate Indian or global source | Likely access | Notes and rights concerns |
|---|---|---|---|
| Regulatory notifications | Gazette of India (e-Gazette), CDSCO notifications and FDC orders | Public | Official text is public; building a clean event register is **must-build** effort. Needs a reviewer to confirm each event, supersession and effective date. |
| Drug master (brands, forms, strengths) | CDSCO approved lists, NPPA price lists and orders (DPCO ceiling and retail prices), Jan Aushadhi catalogue | Public | No single clean national brand master exists; expect partial coverage. A licensed commercial database (for example a CIMS or MIMS style product) is a paid alternative; licence terms for derived storage must be negotiated. |
| Essential medicines | NLEM 2022 (MoHFW and NPPA) | Public | Validation signal only. |
| Treatment workflows | ICMR Standard Treatment Workflows, national programme guidelines (NHM, NTEP, NVBDCP, NPCDCS), ICMR antimicrobial guidance | Public | Check reuse terms; edition and effective date must be captured per page, as the supplied pack shows. |
| Specialty guidance | Professional bodies (for example paediatric, obstetric, diabetes and hypertension societies) | Mixed, often member-copyright | Permission required before ingestion; treat as licensed. |
| National formulary | National Formulary of India (Indian Pharmacopoeia Commission) | Mixed | Confirm whether digital reuse is permitted. |
| Interactions and contraindications | Open sources (WHO materials, label data) for a base; licensed clinical knowledge bases for depth | Mixed | Open interaction data is thin and not graded for Indian brands; a licensed source is the realistic route for breadth, at a recurring fee. **Must-build:** class mapping and Indian-brand-to-ingredient linkage, owned by the clinical lead. |
| Pharmacovigilance signals | PvPI publications | Public | Context, not rules. |
| Evidence for out-of-corpus questions | Not in the first test | - | See fences. |

Provenance strategy: every record keeps source file hash, page or row, retrieval date, licence label and transformation method; the licence label travels with the record into the trace so that a source can be removed on demand and every output that used it identified.

Rough cost (Estimate, annual or one-time as stated, INR and USD at about 85 INR per USD): licensed drug and interaction content: USD 10,000 to 60,000 per year depending on vendor and tier; reviewer and clinical lead time for the test period: USD 12,000 to 25,000; legal review: USD 2,000 to 5,000; public sources: effort only.

## 4. Gap analysis of the supplied materials

Disagreements and weaknesses, in order of how much they would hurt the test. Each is also in GAPS_REGISTER.md.

1. **Brand identity is not a key.** 565 names map to several products (75 percent of products involved). Any design that treats a brand string as an identifier will silently pick wrong. Plan: brand plus manufacturer plus form plus strength as the working identity key, review queue ranked by prescribing volume, tenant-scoped aliases promoted after review, and a measured resolve rate as a release metric. The documents never say what resolve rate is acceptable; I would propose at least 90 percent of real prescription lines resolved without review by week 5 and treat that as an open target to agree.
2. **The units are not trustworthy and the gate cannot be measured.** All strengths are labelled mg; G2 asks for 95 percent against a sample we are not given. A decomposition pipeline whose two derivations agree on every row proves nothing about accuracy. Plan: a clinician-keyed sample of at least 400 products stratified by FDC size, measured with a confidence interval (with 400 items and 97 percent observed accuracy the 95 percent lower confidence bound is only about 95.3 percent, so a pass needs a near-97 percent observed rate and I would ask for 600 items to widen the margin), unit authority decided before any exposure total is shown to a doctor.
3. **A 15-pair seed list invites a false sense of safety.** Sixteen of its names cannot match any product, there is no allergy, pregnancy, renal or age logic, and the brief's gate reads "zero false negatives" without defining the universe. A zero-false-negative claim only has meaning relative to a named, signed-off rule universe. Plan: report coverage in every result, define the universe per release, and measure false negatives against the clinician's held-out set, not against the seed.
4. **The register has no as-of date and free-text targets.** A freshness gate cannot work without knowing how old the source is, and scope text ("specific ratio", "paediatric", "codeine-based cough FDCs") cannot be matched exactly. Plan: structured targets entered by a reviewer at load, as-of recorded per load, and POSSIBLE matches routed to the clinician rather than shown as findings or silenced.
5. **The evaluation design is circular if the builder writes the key.** The sample questions are answerable from one-page synthetic documents. Passing 11 of 11 says retrieval works on those pages. Plan: independent key, held-out phrasing, out-of-corpus and population-mismatch cases, and the sampling design in section 6.
6. **Timeline and scope inconsistencies in the packet** (a 7-day brief and a 4-day email; 18 lines stated, 17 present). Minor, but a packet that cannot be reconciled with itself suggests the same care is needed for the production data contracts.

## 5. The doctor's reality

| Problem | What will actually happen | How the plan handles it |
|---|---|---|
| Trust | Doctors will test with questions they know. One visible wrong or uncited answer ends adoption. | Every claim quoted with its page; abstain rather than approximate; wrong-answer reports go straight to the clinical lead; trust is measured weekly. |
| Speed | A question during a consultation tolerates seconds, not a spinner. | Extractive path with a p95 budget; rail runs while the doctor is still typing the draft; progressive display (safety first, evidence second). |
| Alert fatigue | Every prescription with a duplicate or a partial status trains people to dismiss. | Severity separate from status; critical findings first and visually distinct; partial and unverified grouped and collapsed by default; per-rule fire rate and dismissal rate tracked; any rule with high dismissal and no accepted action is reviewed by the clinical lead. A clean result states its scope in one line instead of a dense disclaimer. |
| Unanswerable questions | Many real questions are outside any corpus (the two abstained sample questions). | Abstention is a designed state: what is missing, nearest documents, a path to submit the question for corpus coverage planning. Abstention rate by topic is the corpus roadmap. |
| Language | Doctors mix English, Hindi and regional terms; brand names are transliterated (one Telugu stock line already). | Out of scope for the first test as a generation language; in scope for input: transliteration-aware name matching and a language-detection fallback that routes to review. Measured, not promised. |
| Workflow interruption | Switching to another window per prescription will not survive a full clinic. | Single page with the draft and the answer side by side, keyboard-first entry, no modal for non-critical states; integration with the tenant's prescribing system is a later phase. |
| Responsibility | Doctors fear being second-guessed or blamed. | The software never finalizes or acts; the report states the scope and the doctor's responsibility; audit trail protects both sides. |
| Dataset blind spots | A new brand or a local name is unknown. | Unknown is shown as unknown with a one-click add to the review queue; reviewers see volume-ranked items. |

## 6. The quality system

### 6.1 What "excellent" means for the 100-doctor test (Estimate, to be ratified by the clinical lead in week 1)

| Dimension | Metric | Release threshold |
|---|---|---|
| Safety recall | Known-bad prescriptions flagged by the right check (held-out clinician set) | 100 percent; any miss blocks release |
| Safety honesty | Cases where an unverified or incomplete state was shown as CHECKED_NO_HIT | 0 in all sampled traces |
| Citation integrity | Claims whose cited text does not contain the claim or its numbers | 0 in the automated check on 100 percent of answers; at most 1 percent in human review sample |
| Answer correctness | Adjudicated correct among answered (clinician panel) | at least 95 percent on the stratified sample, lower confidence bound reported |
| Abstention quality | Out-of-corpus questions correctly abstained; in-corpus questions wrongly abstained | at least 95 percent and at most 15 percent respectively |
| Latency | p50 and p95 end to end | 1.5 s and 4 s |
| Resolve rate | Prescription lines resolved without review | at least 90 percent, with zero silent resolutions |
| Satisfaction | Per-answer helpfulness and weekly trust score | success criterion in 6.3 |

### 6.2 Quality assurance of 100,000 answers without 100,000 reviews

Layered, cheapest first:

1. **Automated checks on every answer (100 percent).** Citation resolves to a stored chunk, every number is in the cited excerpt, claim count and source type correct, no dose computed, rail status vocabulary valid, trace complete, replay hash matches for a random 1 percent. Failures are defects by construction.
2. **Risk tiering.** Dose-related, paediatric, pregnancy, edition-conflict and rail-HIT interactions are tier 1; ordinary lookups tier 2; abstentions tier 3.
3. **Stratified human sampling.** Zero-failure demonstration: to show a defect rate below 1 percent with 95 percent confidence when none is found needs about 300 reviewed answers in a stratum (3 divided by 0.01). With 8 strata that is about 2,400 reviews in total, not 100,000. Tier 1 gets larger samples; any defect found triggers a targeted sweep of the same pattern across all 100,000 using the automated patterns.
4. **Doctor feedback as a signal, not a score.** Thumbs and reason codes feed a triage queue; low-rated answers and answers followed by an immediate rephrase are oversampled for review. They are not used as the correctness estimate because doctors cannot judge all answers and are biased toward fluent ones.
5. **Reviewer quality.** 20 percent double review, agreement reported (Cohen's kappa), disagreements adjudicated by the clinical lead; reviewers see the source text, not a model opinion.
6. **Drift.** Weekly rerun of the frozen evaluation set; any change in corpus, rules or retrieval parameters requires the full set to pass before deploy.

Cost of review (Estimate): about 3,000 reviews at 4 minutes each is about 200 reviewer hours, which is within the reviewer pool budget.

### 6.3 Fair comparison against general assistants

Design (frozen before results exist, G-W5-4):

- **Same questions.** A random sample of real questions (about 1,500 of the 100,000, stratified by tier and specialty) is also answered by the general assistants the doctors use today, run with default settings, same wording, with the date and version recorded.
- **Two measurements, kept separate.** (a) Adjudicated correctness and safety by an independent clinician panel, blinded to which system produced each answer where the format allows (citation style makes full blinding impossible; I would strip formatting and report that blinding is partial). (b) Doctor-rated usefulness and trust on their own questions, paired by question.
- **Pre-registered metrics and analysis.** Primary: proportion of answers adjudicated correct and safe, paired difference with a confidence interval; secondary: unsupported claims per 100 answers, abstention behaviour (a general assistant that answers an unanswerable question is scored as unsupported), time to usable answer, doctor satisfaction on a fixed scale. Mixed-effects model with doctor as a random effect; results reported per stratum and not only pooled.
- **Controls for bias.** Order randomization; no doctor sees a system label while rating; novelty effect handled by reporting week 1 and later weeks separately; selection of questions fixed in advance rather than by what the doctor remembers; the same panel and rubric for both systems.
- **What success means.** I would define success as: non-inferior on adjudicated correctness, superior on unsupported-claim rate and citation verifiability, and at least non-inferior on doctor satisfaction, with the pre-registered margin agreed with the product owner. Claiming "better satisfaction" when the correctness comparison is worse would be reported as a mixed result.
- **Privacy.** Real questions must be de-identified before leaving the tenant; sending them to third-party assistants needs consent and a data-processing agreement.

## 7. Dependencies and the real critical path

What gates the timeline is mostly not code:

1. **Clinical lead and reviewer availability.** Rule sign-off, the answer key and adjudication all wait on them. Without a named clinical lead in week 1 the plan slips one week per week of delay.
2. **Source licensing decisions** for interaction content and specialty guidance. A refused or slow licence removes a source from week 2 and 3 scope.
3. **Data-owner decisions** on brand identity, units and freshness limits (DAY2_QA).
4. **Doctor recruitment, consent and de-identification process** for 100 doctors and their questions, including data-processing agreements.
5. **Security and privacy review** slots, and for a clinical product, the regulatory position (section 8).
6. **Contract for hosting** with the right data-residency terms.
7. **Reviewer training** so that sign-off decisions are consistent.

Critical path: clinical lead onboarded (week 1) then answer key (week 2) then rule sign-off and held-out safety set (week 3) then shakedown quality sampling (week 5). Engineering tasks in weeks 1 and 4 run in parallel and have slack; weeks 2, 3 and 5 do not.

## 8. Fences: deliberately not built, and why

- Patient-specific dose calculation, weight-based dosing, renal dose adjustment, paediatric mg per kg calculators. The brief forbids them and a wrong calculation is the highest-harm failure.
- Diagnosis ranking, triage or severity scoring, automated treatment plans, patient-facing advice.
- Autonomous finalization of a prescription or any write back to a prescribing system.
- Free-web search or any source outside the licensed, reviewed corpus for clinical answers.
- Generative composition as the default. Optional and verified only.
- A claim that the system is cleared as a medical device. The regulatory position needs counsel: depending on intended use, decision-support software may fall under medical device or software rules, and the positioning (reference tool, doctor remains responsible) must be reviewed before any real clinical deployment. I have not made that determination.
- Multilingual generation, voice, EHR integration, mobile app: after the test.
- Per-tenant custom rules: after the test.

## 9. Top 10 risks and mitigations

| # | Risk | Likelihood and impact | Mitigation |
|---|---|---|---|
| 1 | Clinical lead or reviewers not available in week 1 | High, severe | Name them before kickoff; slip rule extends to 6 weeks, never lowers the gates. |
| 2 | A source licence is refused or unaffordable | Medium, high | Licence table in week 1; ship with fewer rule families rather than unsigned ones; coverage reported per ingredient. |
| 3 | Brand collisions produce review volume beyond reviewer capacity | High, high | Volume ranking, tenant aliases, bulk review tools, resolve-rate metric; if below target, restrict the test to prescribing patterns with high resolve rate. |
| 4 | Wrong identity resolved silently | Low, critical | No score-based resolution, replay hash checks, a sampled audit of resolved lines, critical-defect gate. |
| 5 | Clean statuses read as clearance, alert fatigue and over-trust | Medium, critical | Scope line in every clean result, never green, per-rule dismissal tracking, trust survey. |
| 6 | Retrieval recall poor on unseen phrasing (current tuning is on 17 cases) | High, medium | Week 2 key of 1,500, embeddings as second signal, abstention preferred over guess, weekly regression run. |
| 7 | Source change not noticed (new gazette event) | Medium, high | Watchers, simulated-change gate, daily freshness report, DATA_EXPIRED status. |
| 8 | Tenant data leak | Low, critical | Row-level security, key separation, isolation suite in CI and nightly, external penetration test. |
| 9 | Fair comparison is attacked as biased, or doctors do not complete their 1,000 questions | Medium, high | Pre-registration, blinded panel, compliance monitoring and replacement doctors from a waiting list, usage incentives that do not reward volume over quality. |
| 10 | Regulatory classification of the software is wrong | Low to medium, severe | Counsel review before real clinical use; the test runs with doctors under a study agreement and the fences in section 8. |

### Rough cost picture (Estimate for 5 weeks plus a 3 week test)

| Item | Estimate |
|---|---|
| People, 4 core plus support, about 8 weeks | USD 70,000 to 130,000 depending on location and seniority |
| Reviewers and clinical lead (about 200 hours of sampling, key authorship, sign-off) | USD 12,000 to 25,000 |
| Licensed content (first year) | USD 10,000 to 60,000 |
| Cloud infrastructure for the test (two app instances, managed Postgres, search, storage, monitoring) | USD 1,500 to 4,000 |
| Model usage: general assistants for the comparison (about 1,500 questions) plus optional composer and embeddings | USD 300 to 2,000 |
| Security review and legal | USD 8,000 to 20,000 |
| Doctor incentives and study administration | variable, not estimated here |

The number that matters most is not on this list: the cost of one wrong silently resolved drug in front of a doctor, which is why gate G-W5-1 is a hard stop.
