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

export function getDoctrineRiskModifier(state: GameState, check: RiskCheck): number {
  let modifier = 0;

  if (state.flags.doctrine_open_records === true && (check.stat === "knowledge" || check.stat === "craft")) {
    modifier += 4;
  }
  if (state.flags.doctrine_command_secrecy === true) {
    if (check.stat === "knowledge") modifier -= 4;
    if (check.stat === "might") modifier += 4;
    if (check.stat === "resolve") modifier += 2;
  }
  if (state.flags.doctrine_civilian_corridors === true && check.stat === "resolve") {
    modifier += 3;
  }
  if (state.flags.doctrine_shadow_tolls === true && check.stat === "craft") {
    modifier += 3;
  }
  if (state.flags.doctrine_public_routes === true && (check.stat === "resolve" || check.stat === "craft")) {
    modifier += 2;
  }
  if (state.flags.doctrine_private_routes === true) {
    if (check.stat === "might") modifier += 2;
    if (check.stat === "knowledge") modifier -= 1;
  }

  return modifier;
}

export function getRiskTarget(state: GameState, check: RiskCheck): number {
  const statValue = state.player.stats[check.stat];
  const statBonus = statValue * RISK_STAT_MULTIPLIER;
  const policyBonus = getDoctrineRiskModifier(state, check);
  const raw = RISK_BASE + statBonus + policyBonus - check.difficulty * RISK_DIFFICULTY_MULTIPLIER;
  return Math.max(5, Math.min(95, raw));
}

export function resolveRiskCheck(state: GameState, check: RiskCheck): RiskResult {
  const target = getRiskTarget(state, check);
  const { value: roll, rng } = rollD100(state.rng);

  if (roll <= target) {
    return { roll, target, tier: "success", rng };
  }

  if (roll <= target + 15) {
    return { roll, target, tier: "mixed", rng };
  }

  return { roll, target, tier: "fail-forward", rng };
}

