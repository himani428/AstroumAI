# DAY2_QA.md: clarification questions

Questions I would send in the Day-2 round, why each matters, and the assumption this build uses until answered.

| # | Question | File or area | Why it matters | Assumption used |
|---|---|---|---|---|
| 1 | Is a held-out decomposition verification sample available, and in what format (product id to ingredient and strength)? | G2, CDCI | The 95 percent gate cannot be measured from one source whose two derivations always agree. | G2 reported UNVERIFIED; internal consistency shown as a proxy. |
| 2 | Are the 565 colliding brand names intended (real market behaviour) or an artefact of synthetic generation? Should a brand plus manufacturer plus strength be treated as the identity key? | CDCI | Decides whether most prescriptions go to review. | Collisions are real; no auto-resolution. |
| 3 | The CDCI columns are named `*_mg` and every value is mg, including thyroxine and vitamins. Is the unit column authoritative, and may we correct to mcg or IU? | CDCI units | Exposure totals and unit-mismatch handling depend on it. | Units not trusted for the four flagged ingredients; no conversion. |
| 4 | For a 15-pair seed list, should an unmatched result be CHECKED_NO_HIT with stated scope, or PARTIAL_COVERAGE? | Rail check (c) | Determines whether clean results exist at all, and alert fatigue. | CHECKED_NO_HIT with scope and limitations (D-009). |
| 5 | Interaction names like "Nitrates" are classes. Is a class-to-ingredient mapping to be supplied, and who owns it? | Interaction seed | 16 names cannot match anything today. | Not expanded; reported as coverage gap. |
| 6 | What freshness limits apply to each dataset, and does the register have a declared as-of date? | Freshness, DATA_EXPIRED | Limits here are placeholders. | 180 days CDCI, 90 days register and interaction seed, from load time where no date is declared. |
| 7 | Is "STAY_GRANTED" to be treated as not enforceable (clear) or as a flag? | Register | Changes whether a stayed product is a HIT. | HIT with MODERATE severity and a STAYED label. |
| 8 | Do you want a daily-exposure ceiling table supplied, or only ceilings quoted by the STW pack (paracetamol 3 g)? | Cumulative exposure | Without ceilings most totals can only be PARTIAL_COVERAGE. | Only the corpus-quoted ceiling is used. |
| 9 | Brief says 7 days; the email says 4 calendar days. Which is binding for the deadline and for the Part 2 timeline narrative? | Logistics | Scope planning. | Followed the shorter window; the brief governs content. |
| 10 | The seed template is described as 18 lines but has 17 data rows. Is a row missing? | `seed_prescriptions_template.csv` | Affects the "ten prescriptions" count and RX line numbering. | Used the 17 present rows. |
| 11 | Are the STW pages and the clinic protocol the only grading truth for Module B, including the dose-basis numbers (for example 40 mg/kg/day)? | Corpus | Confirms that quoting as written is the target. | Yes; nothing computed. |
| 12 | May the extractive, verbatim answer style be used instead of generated prose, with an LLM only as an optional wording step? | Module B | Changes the user experience and the evaluation. | Extractive default. |
| 13 | Is a non-Latin or transliterated billing string (one Telugu line) expected to be resolved, and by what method? | Stock | Resolution needs a transliteration source. | Unresolved, queued with NON_LATIN_SCRIPT. |
| 14 | Who are the reviewers (pharmacist, clinician) and what authority does a confirmed alias carry across tenants? | Review queue | Determines audit identity and scope of aliases. | Free-text reviewer name; alias applies globally to this deployment. |
| 15 | Are API costs for evaluation runs covered if an LLM judge or composer is expected? | Brief section on LLM usage | Whether to build LLM-dependent evaluation. | None required; no external key used. |
| 16 | Is repository access to be granted to a specific reviewing account, and should the submission be a zip or a repository? | Submission | Logistics. | Zip delivered; repository access to be provided on request. |
