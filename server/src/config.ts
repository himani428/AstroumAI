import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Central configuration. Every threshold, path, version label and freshness policy lives here.
 * Nothing in the codebase should hardcode these values elsewhere.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  logLevel: (env.BRAHMO_LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  paths: {
    root: ROOT,
    db: path.resolve(ROOT, env.BRAHMO_DB_PATH ?? 'data/brahmo.sqlite'),
    inputData: path.join(ROOT, 'input', 'data'),
    inputCorpus: path.join(ROOT, 'input', 'corpus'),
    prompts: path.join(ROOT, 'prompts'),
    reports: path.join(ROOT, 'reports'),
    webDist: path.join(ROOT, 'dist'),
    migrations: path.join(here, 'db', 'migrations'),
  },
  versions: {
    safetyRules: 'rail-1.0.0',
    ingestionPipeline: 'ingest-1.0.0',
    normalizer: 'normalize-1.0.0',
    chunker: 'chunker-1.0.0',
    retrieval: 'hybrid-bm25-ngram-1.0.0',
    answerer: 'extractive-1.0.0',
    regulatoryDerivation: 'regstatus-1.0.0',
    evalCriteria: 'eval-criteria-1.0.0',
    traceSchema: 'trace-1.0.0',
  },
  datasets: {
    cdci: { file: 'cdci_drug_subset.csv', maxAgeDays: 180 },
    nlem: { file: 'nlem_extract.csv', maxAgeDays: 730 },
    janAushadhi: { file: 'jan_aushadhi_extract.csv', maxAgeDays: 180 },
    regulatory: { file: 'regulatory_gazette_events.csv', maxAgeDays: 90 },
    stock: { file: 'pharmacy_stock.csv', maxAgeDays: 30 },
    interactions: { file: 'severe_interaction_seed.csv', maxAgeDays: 90 },
    seedRx: { file: 'seed_prescriptions_template.csv', maxAgeDays: 3650 },
    localProtocol: { file: 'local_protocol_acute_fever.md', maxAgeDays: 365 },
  },
  demo: {
    /** Fixed evaluation date so seeded outputs are reproducible. Real requests default to today. */
    asOf: '2026-10-15',
    actor: 'seed-script',
  },
  normalization: {
    fuzzyMaxDistance: 2,
    fuzzyMaxCandidates: 5,
    resolvedConfidence: { exactUniqueWithStrength: 0.98, exactUniqueNoStrength: 0.85 },
    stockPackTokens: ['STRIP', 'TAB', 'TABS', 'TABLET', 'CAP', 'CAPS', 'CAPSULE', 'SYP', 'SYRUP', 'SUSP', 'INJ'],
    stockFormTokenMap: { TAB: 'Tablet', TABS: 'Tablet', TABLET: 'Tablet', CAP: 'Capsule', CAPS: 'Capsule', CAPSULE: 'Capsule', SYP: 'Syrup', SYRUP: 'Syrup', SUSP: 'Suspension' } as Record<string, string>,
  },
  safety: {
    /** Dose forms for which "N units per slot" is unambiguous. Liquids are NOT counted. */
    countableDoseForms: ['Tablet', 'Capsule'],
    /** Ingredients normally dosed in mcg/IU; the CDCI subset labels every strength "mg", so totals are flagged. */
    unitSuspectIngredients: ['thyroxine', 'folic acid', 'vitamin d3', 'methylcobalamin'],
    /**
     * Reference ceilings quoted by the supplied corpus (NOT patient-specific, adult wording).
     * Used only as cited context for aggregate evidence; nothing is calculated per patient.
     */
    referenceCeilings: {
      paracetamol: {
        value: 3000,
        unit: 'mg',
        basis: 'Adult reference maximum quoted as "max 3 g/day"',
        sources: [
          { doc_code: 'STW-GP-01', version: '2025.1', page: 1, section: 'FIRST-LINE MANAGEMENT' },
          { doc_code: 'STW-GP-04', version: '2024.2', page: 1, section: 'OPD MANAGEMENT' },
        ],
      },
    } as Record<string, { value: number; unit: string; basis: string; sources: { doc_code: string; version: string; page: number; section: string }[] }>,
    interactionCoverageScope: 'SEED_LIST_ONLY',
  },
  retrieval: {
    topK: 8,
    bm25: { k1: 1.4, b: 0.6 },
    weights: { lexical: 0.65, semantic: 0.35 },
    docPriorWeight: 0.4,
    chunkRelativeThreshold: 0.97,
    residualTermBoost: 0.15,
    /** When a question asks for first-line/initial therapy, non-therapy units (referral, assessment, monitoring) rank lower. */
    intentPenalties: [{ query: '\\b(first[- ]line|initial|newly|regimen|therapy)', kinds: ['referral', 'monitoring', 'assessment', 'status'], penalty: 0.15 }] as { query: string; kinds: string[]; penalty: number }[],
    newTermMaxDf: 3,
    /** Question-intent priors: when the question asks for X, decision units of that kind rank higher. */
    intentBoosts: [
      { query: '\\b(first[- ]line|initial|start|regimen|therapy|treat)', kind: 'recommendation', text: null, boost: 0.12 },
      { query: 'red flags?', kind: 'red_flag', text: null, boost: 0.25 },
      { query: '\\b(avoid|avoided|must not|do not|contraindicat)', kind: 'contraindication', text: '\\b(avoid|do not|no routine)', boost: 0.2 },
      { query: '\\brefer', kind: 'referral', text: null, boost: 0.1 },
      { query: '\\balternative', kind: null, text: '^alternative', boost: 0.15 },
      { query: '\\b(initial|first[- ]line|newly)', kind: null, text: '^start\\b', boost: 0.15 },
    ] as { query: string; kind: string | null; text: string | null; boost: number }[],
    topicTermMinLength: 9,
    abstentionExemptTerms: ['threshold', 'volume', 'mandate', 'empirical'] as string[],
    newTermRelativeThreshold: 0.4,
    minChunkScore: 0.15,
    ngram: 3,
    minDocSupport: 0.5,
    /** Question words that carry intent, not topic. Excluded when checking whether the corpus covers the topic. */
    genericTerms: ['first', 'line', 'drug', 'drugs', 'therapy', 'initial', 'initially', 'dose', 'doses', 'basis', 'duration', 'newly', 'diagnosed', 'adult', 'adults', 'child', 'children', 'regimen',
      'standard', 'exactly', 'workflow', 'workflows', 'stated', 'state', 'states', 'pack', 'per', 'class', 'avoided', 'avoid', 'must', 'mandate', 'accompanies', 'accompany', 'course', 'which', 'what', 'when',
      'how', 'does', 'say', 'same', 'label', 'sources', 'start', 'started', 'second', 'agent', 'stated', 'clinic', 'clinics', 'own', 'protocol', 'national', 'treatment', 'recommended', 'recommend',
      'use', 'used', 'give', 'given', 'amount', 'year', 'years', 'old', 'week', 'weeks', 'month', 'months', 'day', 'days', 'age', 'aged', 'new', 'dosing', 'patient', 'patients', 'being', 'why', 'there', 'antibiotic', 'antibiotics', 'drug', 'agent', 'class', 'calculate', 'compute', 'maximum', 'max', 'per', 'banned', 'status', 'regulatory', 'legal'],
    synonyms: {
      uti: ['urinary tract infection', 'urinary'],
      htn: ['hypertension'],
      t2dm: ['type 2 diabetes', 'diabetes'],
      tb: ['tuberculosis'],
      ors: ['oral rehydration'],
      nsaid: ['nsaids'],
      analgesic: ['nsaid', 'paracetamol', 'ibuprofen'],
      ibuprofen: ['nsaid'],
      pneumonia: ['pneumonia'],
      kids: ['child'],
      children: ['child'],
      paediatric: ['child'],
      pediatric: ['child'],
      gastroenteritis: ['diarrhoea', 'loose stool'],
      dosing: ['dose'],
      antibiotic: ['antibiotics'],
    } as Record<string, string[]>,
  },
  llm: {
    enabled: Boolean(env.ANTHROPIC_API_KEY),
    provider: 'anthropic',
    model: env.BRAHMO_LLM_MODEL ?? 'claude-sonnet-4-6',
    apiKey: env.ANTHROPIC_API_KEY ?? '',
  },
  pagination: { defaultPageSize: 25, maxPageSize: 200 },
} as const;

export type Config = typeof config;
