import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { rollLoot } from "../engine/loot";

describe("loot scaling", () => {
  const registry = getRegistry();

  it("allows higher-tier entries at higher levels", () => {
    let lowState = createInitialState("loot-seed", registry);
    lowState = {
      ...lowState,
      player: { ...lowState.player, level: 1 },
    };

    let highState = createInitialState("loot-seed", registry);
    highState = {
      ...highState,
      player: { ...highState.player, level: 6 },
    };

    const lowLoot = rollLoot(lowState, registry, "loot_dungeon_rare");
    const highLoot = rollLoot(highState, registry, "loot_dungeon_rare");

    expect(lowLoot.state.player.inventory.length).toBe(0);
    expect(highLoot.state.player.inventory.length).toBeGreaterThan(0);
    expect(highLoot.state.rng.step).toBeGreaterThan(lowLoot.state.rng.step);
  });
});

