---
id: dev-working-method
version: 1.0.0
used_by: development (AI coding assistant)
status: documentation
---
# Development-time instructions (what the coding assistant was told)

The assessment owner supplied one long master prompt. Its binding content, condensed:

1. Inspect every file of the assessment packet first; the supplied files are the evaluation baseline and are preserved unchanged under `input/` (SHA-256 listed in `input/SHA256SUMS.txt`).
2. The brief and the architecture document are authoritative. Record discrepancies in `GAPS_REGISTER.md`.
3. Priorities in order: assessment compliance, deterministic medication safety, grounded citations, provenance and honest unknowns, reliable backend, tests, UX, extras.
4. Safety rail: pure lookup, no model in the path, exactly eight statuses, missing data never rendered as safe.
5. Module B answers only from the STW pack and the clinic protocol; claim-level citations; abstain when unsupported; show conflicts, never merge.
6. No patient-specific dose calculators, triage, diagnosis ranking, treatment plans or patient advice.
7. `npm install` then `npm start` must work; no paid API needed.

Corrections applied while building (what the assistant got wrong and how it was caught) are listed in `DESIGN.md` section "What the AI tooling got wrong".
