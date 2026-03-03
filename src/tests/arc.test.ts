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
    expect(resolved.endingSummary?.unlockedCards).not.toContain("card_root_archive");
  });

  it("does not append duplicate ending entries for the same arc ending", () => {
    const state = createInitialState("arc-seed-dup", registry);
    const arc = registry.byId.arcs["arc_ember_crown"];
    const once = resolveArcEnd(state, arc, "dawn");
    const twice = resolveArcEnd(once, arc, "dawn");

    const matches = twice.endings.filter((entry) => entry.arcId === "arc_ember_crown" && entry.endingId === "dawn");
    expect(matches).toHaveLength(1);
    expect(twice.endingSummary?.worldChanges).toContain("Arc already resolved in this run.");
  });
});

