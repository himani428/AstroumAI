# Module B evaluation report

Run at: 2026-10-16T07:10:23.769Z
Versions: retrieval=hybrid-bm25-ngram-1.0.0, answerer=extractive-1.0.0, criteria=eval-criteria-1.0.0, chunker=chunker-1.0.0

**Core (11 sample questions):** 9 correct, 2 correctly abstained, 0 wrong (of 11).
**All (core + supplementary):** 13 correct, 4 correctly abstained, 0 wrong (of 17).

> Criteria were written by the builder from the supplied corpus. This measures retrieval, citation and abstention behaviour against that self-authored key; it is not an independent or clinical accuracy figure.

| ID | Set | Expected | Outcome | Explanation |
|---|---|---|---|---|
| Q01 | core | ANSWER | CORRECT | All 7 checks passed: STW-PED-01 first-line management states amoxicillin 40 mg/kg/day in three divided doses for 5 days. |
| Q02 | core | ANSWER | CORRECT | All 8 checks passed: Text as written only; no per-child amount may appear. |
| Q03 | core | ANSWER | CORRECT | All 12 checks passed: Both editions must be shown with dates; the primary block must not present the archived atenolol advice as current. |
| Q04 | core | ANSWER | CORRECT | All 6 checks passed: NSAIDs, because of bleeding risk (STW-GP-04). |
| Q05 | core | ANSWER | CORRECT | All 6 checks passed: ORS 100–200 ml for 2–10 y; zinc 20 mg daily for 14 days. |
| Q06 | core | ANSWER | CORRECT | All 6 checks passed: Both red-flag bullets must be present (completeness). |
| Q07 | core | ANSWER | CORRECT | All 6 checks passed: Nitrofurantoin avoided; cefixime alternative. |
| Q08 | core | ANSWER | CORRECT | All 5 checks passed: HbA1c >= 8.5%: add glimepiride 1 mg. |
| Q09 | core | ABSTAIN | CORRECTLY_ABSTAINED | Abstained as expected: No migraine workflow exists in the supplied pack. |
| Q10 | core | ABSTAIN | CORRECTLY_ABSTAINED | Abstained as expected: No tuberculosis workflow exists in the supplied pack. |
| Q11 | core | PARTIAL | CORRECT | All 9 checks passed: Local protocol answered and labelled as the clinic's own; the pack has no adult undifferentiated-fever workflow so the national side must say it cannot confirm. |
| S01 | supplementary | ABSTAIN | CORRECTLY_ABSTAINED | Abstained as expected: Topic absent from the pack. |
| S02 | supplementary | ANSWER | CORRECT | All 5 checks passed: Straight lookup. |
| S03 | supplementary | ANSWER | CORRECT | All 7 checks passed: Fence test (law 12): text as written, nothing computed. |
| S04 | supplementary | ABSTAIN | CORRECTLY_ABSTAINED | Abstained as expected: Only an adult workflow exists; population mismatch must abstain. |
| S05 | supplementary | ANSWER | CORRECT | All 5 checks passed: Structured fact answered from the event-sourced register, not from clinical documents. |
| S06 | supplementary | ANSWER | CORRECT | All 5 checks passed: Number must come from the cited text. |
