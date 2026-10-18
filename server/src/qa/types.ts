export interface Citation {
  kind: 'CORPUS';
  chunk_id: number; doc_code: string; title: string; version: string; effective_date: string | null; doc_status: string;
  source_type: string; source_label: string; page: number | null; section: string | null; anchor: string; excerpt: string;
}
export interface RegisterCitation {
  kind: 'REGISTER'; as_of: string; event_id: string; notification_id: string; action: string; effective_date: string; date_published: string; target: string; source_label: string;
}
export interface Claim { id: string; text: string; citations: (Citation | RegisterCitation)[] }
export interface Abstention { reason_code: string; explanation: string; missing_evidence: string[]; nearest_sources: { doc_code: string; title: string; version: string; note: string }[] }
export interface AnswerBlock {
  block_id: string; label: string; source_type: 'NATIONAL_STW' | 'LOCAL_PROTOCOL' | 'REGISTER'; source_label: string;
  status: 'ANSWERED' | 'ABSTAINED'; claims: Claim[]; abstention?: Abstention;
}
export interface ConflictVersion { doc_code: string; title: string; version: string; effective_date: string | null; doc_status: string; claims: Claim[] }
export interface ConflictSet {
  topic: string; kind: 'EDITION_DIFFERENCE' | 'SOURCE_TYPE_DIVERGENCE'; versions: ConflictVersion[];
  note: string;
}
export interface QaResult {
  question: string;
  intent: string[];
  outcome: 'ANSWERED' | 'ABSTAINED' | 'PARTIAL';
  blocks: AnswerBlock[];
  conflicts: ConflictSet[];
  notes: string[];
  guard: { numeric_tokens_checked: number; ungrounded_numbers: string[]; claims_without_citation_dropped: number; passed: boolean };
  retrieval: { index_chunks: number; strategy: string; queries: { scope: string; salient_terms: string[]; unmatched_terms: string[]; coverage: number; top: { chunk_id: number; doc_code: string; version: string; anchor: string; lexical: number; semantic: number; score: number }[] }[] };
  composer: { mode: 'EXTRACTIVE' | 'LLM_VERIFIED'; provider: string; model: string | null; prompt_version: string | null };
  versions: { retrieval: string; answerer: string };
}
