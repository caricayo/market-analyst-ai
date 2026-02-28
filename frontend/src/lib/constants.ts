import type { StageState } from "./types";

export const STAGE_DEFINITIONS: Omit<StageState, "status" | "detail" | "startedAt" | "completedAt">[] = [
  { id: "Stage 1", label: "Intake & Validation" },
  { id: "Stage 2", label: "Deep Dive Analysis" },
  { id: "Stage 3", label: "Persona Evaluations" },
  { id: "Stage 4", label: "Synthesis" },
  { id: "Stage 5", label: "Report Assembly" },
];

export function createInitialStages(): StageState[] {
  return STAGE_DEFINITIONS.map((def) => ({
    ...def,
    status: "pending",
    detail: "",
    startedAt: null,
    completedAt: null,
  }));
}

export const RATING_COLORS: Record<string, string> = {
  Buy: "bg-t-green/20 text-t-green border-t-green/40",
  Watchlist: "bg-t-amber/20 text-t-amber border-t-amber/40",
  Avoid: "bg-t-red/20 text-t-red border-t-red/40",
  Unknown: "bg-t-dim/20 text-t-dim border-t-dim/40",
  "N/A": "bg-t-dim/20 text-t-dim border-t-dim/40",
};

export const POSITION_SIZES = ["None", "Small", "Moderate", "Full"] as const;
