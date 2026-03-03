import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { isCardUnlocked } from "../engine/state";

describe("gating resolver", () => {
  const registry = getRegistry();

  it("locks gated cards until required flags are set", () => {
    const state = createInitialState("seed-a", registry);
    expect(isCardUnlocked(state, registry, "card_ashen_gate")).toBe(false);

    const unlockedState = {
      ...state,
      flags: {
        ...state.flags,
        arc_ember_escalated: true,
      },
      world: {
        ...state.world,
        locations: {
          ...state.world.locations,
          card_ashen_gate: {
            ...state.world.locations.card_ashen_gate,
            status: "visible" as const,
          },
        },
      },
    };

    expect(isCardUnlocked(unlockedState, registry, "card_ashen_gate")).toBe(true);
  });
});

