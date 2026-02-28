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

export interface AnalysisResult {
  ticker: string;
  filepath: string;
  sections: {
    deep_dive: string;
    perspectives: string;
    synthesis: string;
  };
  persona_verdicts: PersonaVerdict[];
}

export interface SSEEvent {
  event_type: "stage_update" | "analysis_complete" | "analysis_error" | "keepalive";
  stage?: string;
  status?: string;
  detail?: string;
  elapsed?: number;
  timestamp?: number;
  data?: AnalysisResult;
}

export type AnalysisPhase = "idle" | "running" | "complete" | "error";
