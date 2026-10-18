import type { RegEvent } from '../regulatory/types.js';

export const CHECK_STATUSES = ['HIT', 'CHECKED_NO_HIT', 'PARTIAL_COVERAGE', 'UNVERIFIED_INPUT', 'NOT_CHECKED', 'DATA_EXPIRED', 'SOURCE_CONFLICT', 'SERVICE_UNAVAILABLE'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
/** Severity describes the magnitude of a finding or the consequence of a limitation. It never changes the status. */
export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFO' | 'NONE';
export const CHECK_TYPES = ['DUPLICATE_INGREDIENT', 'PROHIBITED_FDC', 'SEVERE_INTERACTION', 'CUMULATIVE_EXPOSURE'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export interface RxLineInput {
  line_no: number;
  written_product: string;
  strength_as_written?: string | null;
  dose_frequency?: string | null;
  clinical_note?: string | null;
}

export interface SafetyIngredient { name: string; norm: string; value: number | null; unit: string | null; unitNote: string | null }
export interface SafetyProduct {
  product_id: string; brand_name: string; dose_form: string | null; strength_text: string | null;
  ingredients: SafetyIngredient[]; source: string; source_version: string; batch_id: number; source_row_id: number; anomaly_flags: string[];
}

export interface LineResolution {
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'UNRESOLVED';
  confidence: number; method: string; reason_codes: string[]; warnings: string[];
  candidates: { product_id: string; label: string; score: number; basis: string }[];
  queue_id?: number | null;
}
export interface ResolvedLine { line_no: number; input: RxLineInput; resolution: LineResolution; product: SafetyProduct | null }

export interface SourceRef { dataset: string; ref: string; version?: string | null; batch_id?: number | null; source_row_id?: number | null; detail?: string }

export interface CheckResult {
  check_type: CheckType;
  rule_id: string;
  status: CheckStatus;
  severity: Severity;
  explanation: string;
  evidence: unknown[];
  affected_products: { line_no: number; product_id: string; brand_name: string }[];
  affected_ingredients: string[];
  source_references: SourceRef[];
  rule_version: string;
  data_version: string;
  data_dependencies: string[];
  executed_at: string;
  unresolved_inputs: { line_no: number; written_product: string; status: string; reason_codes: string[]; queue_id?: number | null }[];
  limitations: string[];
}

export interface DatasetVersionInfo {
  dataset: string; version_label: string | null; source_date: string | null; freshness_basis: 'DECLARED_SOURCE_DATE' | 'LOAD_TIME_ONLY' | string;
  loaded_at: string; max_age_days: number; batch_id: number; source_sha256: string; row_count: number;
}
export interface InteractionPair { a: string; b: string; a_norm: string; b_norm: string; severity: string; note: string | null; source_tag: string | null; batch_id: number; source_row_id: number }

/** Read-only data access for the rail. Implementations may throw; the engine converts that into SERVICE_UNAVAILABLE. */
export interface RailData {
  getDataVersions(): DatasetVersionInfo[];
  getRegulatoryEvents(): RegEvent[];
  getInteractionPairs(): InteractionPair[];
  getIngredientVocab(): Set<string>;
}

export interface RailOptions {
  asOf: string;
  now?: Date;
  /** Subset of checks to run; others return NOT_CHECKED("not requested"). Default: all. */
  checks?: CheckType[];
}

export interface RailReport {
  report_type: 'BRAHMO_SAFETY_RAIL_REPORT';
  rule_version: string;
  data_version: string;
  as_of: string;
  executed_at: string;
  llm_used_in_safety_path: false;
  data_versions: DatasetVersionInfo[];
  lines: { line_no: number; written_product: string; strength_as_written: string | null; dose_frequency: string | null; resolution: LineResolution; product_id: string | null; resolved_brand: string | null; ingredients: { name: string; strength: string }[] }[];
  checks: CheckResult[];
  summary: { counts: Record<string, number>; critical_findings: number; all_checks_clean: boolean; statement: string };
}
