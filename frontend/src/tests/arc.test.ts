import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { resolveArcEnd } from "../engine/arcs";

describe("arc completion", () => {
  const registry = getRegistry();

  it("sets ending flags and arc resolved state", () => {
    const state = createInitialState("arc-seed", registry);
    const arc = registry.byId.arcs["arc_ember_crown"];

    const resolved = resolveArcEnd(state, arc, "dawn");

    expect(resolved.arcStates["arc_ember_crown"]).toBe("resolved_dawn");
    expect(resolved.flags["ending_ember_dawn"]).toBe(true);
    expect(resolved.currentScreen).toBe("endArc");
  });

  it("only reports newly unlocked cards in end summary", () => {
    const state = createInitialState("arc-seed-summary", registry);
    const arc = registry.byId.arcs["arc_ember_crown"];
    const resolved = resolveArcEnd(state, arc, "dawn");

    expect(resolved.endingSummary?.unlockedCards).toContain("card_thorn_bastion");
    expect(resolved.endingSummary?.unlockedCards).not.toContain("card_cinder_market");
  });
});

