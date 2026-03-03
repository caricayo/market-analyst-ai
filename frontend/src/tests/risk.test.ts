import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { resolveRiskCheck, RISK_BASE, RISK_DIFFICULTY_MULTIPLIER, RISK_STAT_MULTIPLIER } from "../engine/checks";

describe("risk constants", () => {
  const registry = getRegistry();

  it("uses locked constants", () => {
    const state = createInitialState("risk-seed", registry);
    const result = resolveRiskCheck(state, { type: "risk", stat: "resolve", difficulty: 3 });

    expect(RISK_BASE).toBe(60);
    expect(RISK_DIFFICULTY_MULTIPLIER).toBe(10);
    expect(RISK_STAT_MULTIPLIER).toBe(6);
    expect(result.target).toBe(60 + state.player.stats.resolve * 6 - 3 * 10);
  });
});

