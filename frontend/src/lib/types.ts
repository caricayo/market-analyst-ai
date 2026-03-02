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

export interface AnalysisResult {
  ticker: string;
  filepath: string;
  sections: {
    deep_dive: string;
    perspectives: string;
    synthesis: string;
  };
  persona_verdicts: PersonaVerdict[];
  usage?: UsageSummary;
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
