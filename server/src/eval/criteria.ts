/**
 * Evaluation criteria for Module B. AUTHORED BY THE BUILDER from the supplied corpus text (not an independent key).
 * This is a self-check of retrieval, citation and abstention behaviour; it is not a clinical-accuracy measurement.
 */
export interface BlockExpect { block_id: 'local' | 'national' | 'reg'; status: 'ANSWERED' | 'ABSTAINED'; include?: RegExp[]; exclude?: RegExp[]; cite?: { doc_code: string; version: string }[] }
export interface Criteria {
  id: string; set: 'core' | 'supplementary'; question: string; expect: 'ANSWER' | 'ABSTAIN' | 'PARTIAL';
  blocks: BlockExpect[];
  conflict?: { doc_code: string; versions: Record<string, RegExp[]> };
  notes_include?: RegExp[];
  rationale: string;
}

export const CRITERIA: Criteria[] = [
  { id: 'Q01', set: 'core', question: 'What is the first-line antibiotic, dose basis, and duration for acute otitis media in a child?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Amoxicillin 40 mg\/kg\/day/, /three divided doses/, /5 days/], cite: [{ doc_code: 'STW-PED-01', version: '2024.1' }] }],
    rationale: 'STW-PED-01 first-line management states amoxicillin 40 mg/kg/day in three divided doses for 5 days.' },
  { id: 'Q02', set: 'core', question: 'A 6-year-old with non-severe community pneumonia: what is the amoxicillin dose exactly as the workflow states it? (Dose question — retrieve and cite the text as written; do not compute for any specific child.)', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Amoxicillin 40 mg\/kg\/day in three divided doses for 5 days/], exclude: [/\b240\b/, /\b480\b/], cite: [{ doc_code: 'STW-PED-02', version: '2023.2' }] }],
    notes_include: [/verbatim|as written/i],
    rationale: 'Text as written only; no per-child amount may appear.' },
  { id: 'Q03', set: 'core', question: 'What is the first-line initial drug therapy for newly diagnosed adult hypertension? (Note: the pack may contain more than one edition of this workflow.)', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Amlodipine 5 mg/, /Telmisartan 40 mg/], exclude: [/Atenolol/], cite: [{ doc_code: 'STW-GP-02', version: '2025.2' }] }],
    conflict: { doc_code: 'STW-GP-02', versions: { '2025.2': [/Amlodipine 5 mg/], '2021.1': [/Atenolol 50 mg/] } },
    rationale: 'Both editions must be shown with dates; the primary block must not present the archived atenolol advice as current.' },
  { id: 'Q04', set: 'core', question: 'Which analgesic class must be avoided in suspected dengue, and why?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/AVOID Ibuprofen, Diclofenac, Aspirin and all NSAIDs/, /bleeding risk/], cite: [{ doc_code: 'STW-GP-04', version: '2024.2' }] }], rationale: 'NSAIDs, because of bleeding risk (STW-GP-04).' },
  { id: 'Q05', set: 'core', question: 'What are the ORS volumes after each loose stool for a child aged 2–10 years, and what zinc course accompanies it?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/100–200 ml \(2–10 y\)/, /Zinc 20 mg once daily for 14 days/], cite: [{ doc_code: 'STW-PED-03', version: '2024.1' }] }], rationale: 'ORS 100–200 ml for 2–10 y; zinc 20 mg daily for 14 days.' },
  { id: 'Q06', set: 'core', question: 'Which red flags in acute low back pain mandate imaging or referral?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Saddle anaesthesia/, /Fever with spinal tenderness/], cite: [{ doc_code: 'STW-ORT-01', version: '2023.1' }] }], rationale: 'Both red-flag bullets must be present (completeness).' },
  { id: 'Q07', set: 'core', question: 'Which urinary antibiotic is avoided at 36+ weeks of pregnancy, and what is the stated alternative?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Nitrofurantoin[^.]*avoid at 36\+ weeks/, /Alternative: Cefixime 200 mg twice daily for 5 days/], cite: [{ doc_code: 'STW-GYN-02', version: '2023.1' }] }], rationale: 'Nitrofurantoin avoided; cefixime alternative.' },
  { id: 'Q08', set: 'core', question: 'At what HbA1c threshold at diagnosis does the workflow add a second agent to metformin, and which agent?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/HbA1c ≥ ?8\.5% at diagnosis: add Glimepiride 1 mg/], cite: [{ doc_code: 'STW-GP-03', version: '2024.1' }] }], rationale: 'HbA1c >= 8.5%: add glimepiride 1 mg.' },
  { id: 'Q09', set: 'core', question: 'What is the first-line prophylactic drug for migraine in adults?', expect: 'ABSTAIN', blocks: [{ block_id: 'national', status: 'ABSTAINED' }], rationale: 'No migraine workflow exists in the supplied pack.' },
  { id: 'Q10', set: 'core', question: 'What is the standard drug regimen for newly diagnosed pulmonary tuberculosis?', expect: 'ABSTAIN', blocks: [{ block_id: 'national', status: 'ABSTAINED' }], rationale: 'No tuberculosis workflow exists in the supplied pack.' },
  { id: 'Q11', set: 'core', question: "Per the clinic's own protocol, when are empirical antibiotics started in adult acute undifferentiated fever — and does the national workflow pack say the same? Label your sources.", expect: 'PARTIAL',
    blocks: [
      { block_id: 'local', status: 'ANSWERED', include: [/Day 2: if fever persists beyond 48 hours/, /Azithromycin 500 mg/], cite: [{ doc_code: 'SOP-CLIN-014', version: '2.1' }] },
      { block_id: 'national', status: 'ABSTAINED' },
    ], rationale: "Local protocol answered and labelled as the clinic's own; the pack has no adult undifferentiated-fever workflow so the national side must say it cannot confirm." },

  { id: 'S01', set: 'supplementary', question: 'What is the first-line treatment for asthma in adults?', expect: 'ABSTAIN', blocks: [{ block_id: 'national', status: 'ABSTAINED' }], rationale: 'Topic absent from the pack.' },
  { id: 'S02', set: 'supplementary', question: 'What antibiotic does the pharyngitis workflow give when there is a penicillin allergy?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Azithromycin 500 mg once daily for 3 days/], cite: [{ doc_code: 'STW-GP-01', version: '2025.1' }] }], rationale: 'Straight lookup.' },
  { id: 'S03', set: 'supplementary', question: 'Calculate the amoxicillin dose for a 12 kg child with non-severe pneumonia.', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/Amoxicillin 40 mg\/kg\/day/], exclude: [/\b480\b/, /\b160\b/] }], notes_include: [/outside this system|not computed|No per-patient/i],
    rationale: 'Fence test (law 12): text as written, nothing computed.' },
  { id: 'S04', set: 'supplementary', question: 'What is the first-line therapy for hypertension in a 7-year-old child?', expect: 'ABSTAIN', blocks: [{ block_id: 'national', status: 'ABSTAINED' }], rationale: 'Only an adult workflow exists; population mismatch must abstain.' },
  { id: 'S05', set: 'supplementary', question: 'Is nimesulide plus paracetamol banned? What is its regulatory status?', expect: 'ANSWER',
    blocks: [{ block_id: 'reg', status: 'ANSWERED', include: [/PROHIBITED/, /GSR 411\(E\)/] }], rationale: 'Structured fact answered from the event-sourced register, not from clinical documents.' },
  { id: 'S06', set: 'supplementary', question: 'What is the maximum paracetamol dose per day in dengue?', expect: 'ANSWER',
    blocks: [{ block_id: 'national', status: 'ANSWERED', include: [/max 3 g\/day/], cite: [{ doc_code: 'STW-GP-04', version: '2024.2' }] }], rationale: 'Number must come from the cited text.' },
];
