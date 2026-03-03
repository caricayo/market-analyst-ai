import { rollD100, type SeededRng } from "./rng";
import type { GameState, RiskCheck } from "./types";

export const RISK_BASE = 60;
export const RISK_DIFFICULTY_MULTIPLIER = 10;
export const RISK_STAT_MULTIPLIER = 6;

export type RiskTier = "success" | "mixed" | "fail-forward";

export type RiskResult = {
  roll: number;
  target: number;
  tier: RiskTier;
  rng: SeededRng;
};

export function resolveRiskCheck(state: GameState, check: RiskCheck): RiskResult {
  const statValue = state.player.stats[check.stat];
  const statBonus = statValue * RISK_STAT_MULTIPLIER;
  const target = RISK_BASE + statBonus - check.difficulty * RISK_DIFFICULTY_MULTIPLIER;
  const { value: roll, rng } = rollD100(state.rng);

  if (roll <= target) {
    return { roll, target, tier: "success", rng };
  }

  if (roll <= target + 15) {
    return { roll, target, tier: "mixed", rng };
  }

  return { roll, target, tier: "fail-forward", rng };
}

