export interface TickerInfo {
  ticker: string;
  name: string;
}

export type StageStatus = "pending" | "running" | "complete" | "error";

export interface StageState {
  id: string;
  label: string;
  status: StageStatus;
  detail: string;
  startedAt: number | null;
  completedAt: number | null;
}

export interface PersonaVerdict {
  persona_id: string;
  persona_name: string;
  persona_label: string;
  rating: string;
  confidence: number;
  time_horizon: string;
  position_size: string;
  available: boolean;
}

export interface UsageSummary {
  request_count: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  web_search_calls: number;
  input_token_cost_usd: number;
  output_token_cost_usd: number;
  web_search_cost_usd: number;
  total_cost_usd: number;
}

export type ClaimType = "numeric" | "qualitative";
export type ClaimConfidence = "low" | "medium" | "high";
export type ClaimSourceType = "SEC/IR" | "reputable_market_data" | "estimate" | "unknown";

export interface ClaimLedgerEntry {
  claim_type: ClaimType;
  metric: string;
  value: number | null;
  unit: string | null;
  timeframe: string | null;
  statement: string;
  confidence: ClaimConfidence;
  source_type: ClaimSourceType;
  source_citation: string;
  notes: string;
}

export interface ClaimsLedgerMeta {
  valid: boolean;
  not_applicable?: boolean;
  parse_errors: string[];
  normalization_notes: string[];
  claim_count: number;
  repair_used?: boolean;
  deal_detected?: boolean;
  degraded_ledger?: boolean;
}

export interface EvidenceSummary {
  sec_ir_claims: number;
  unverified_claims: number;
  source_count: number;
  as_of: string | null;
  inferred?: boolean;
}

export interface OutputQualityMeta {
  deep_chars?: number;
  h2_count?: number;
  section_check_passed?: boolean;
}

export interface AnalysisResult {
  ticker: string;
  filepath: string;
  generated_at?: string;
  sections: {
    deep_dive: string;
    perspectives: string;
    synthesis: string;
  };
  persona_verdicts: PersonaVerdict[];
  usage?: UsageSummary;
  claims_ledger?: ClaimLedgerEntry[];
  claims_ledger_meta?: ClaimsLedgerMeta;
  evidence_summary?: EvidenceSummary;
  output_quality_meta?: OutputQualityMeta;
}

export interface SSEEvent {
  event_type: "stage_update" | "section_ready" | "analysis_complete" | "analysis_error" | "keepalive";
  stage?: string;
  status?: string;
  detail?: string;
  elapsed?: number;
  timestamp?: number;
  data?: AnalysisResult | SectionReadyData;
}

export interface SectionReadyData {
  section: "deep_dive" | "perspectives" | "synthesis";
  content: string;
  persona_outputs?: Record<string, string | null>;
}

export type AnalysisPhase = "idle" | "running" | "complete" | "error";
