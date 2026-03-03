import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { getCampaignGuidance } from "../engine/objectives";

describe("campaign guidance", () => {
  const registry = getRegistry();

  it("starts with Ember onboarding recommendations", () => {
    const state = createInitialState("guide-seed", registry);
    const guidance = getCampaignGuidance(state);

    expect(guidance.recommendedCardIds).toContain("card_ember_hollow");
    expect(guidance.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("switches guidance to Astral arc once Ember resolves", () => {
    const state = createInitialState("guide-astral", registry);
    const guidance = getCampaignGuidance({
      ...state,
      arcStates: {
        ...state.arcStates,
        arc_ember_crown: "resolved_dawn",
      },
      flags: {
        ...state.flags,
        arc_astral_access: true,
      },
    });

    expect(guidance.objective.toLowerCase()).toContain("glasswaste");
    expect(guidance.recommendedCardIds).toContain("card_prism_step");
  });
});
