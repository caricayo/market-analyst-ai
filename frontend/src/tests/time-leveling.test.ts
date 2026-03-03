import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { advanceTime, applyLeveling } from "../engine/state";

describe("time and leveling", () => {
  const registry = getRegistry();

  it("increments day every 10 turns", () => {
    const state = createInitialState("time-seed", registry);
    const advanced = advanceTime(state, 10);
    expect(advanced.time.day).toBe(2);
    expect(advanced.time.turn).toBe(10);
  });

  it("applies level-up progression", () => {
    const state = createInitialState("level-seed", registry);
    const leveled = applyLeveling({
      ...state,
      player: {
        ...state.player,
        xp: state.player.xpToNext,
      },
    });
    expect(leveled.player.level).toBe(2);
    expect(leveled.player.maxHp).toBe(state.player.maxHp + 5);
    expect(leveled.player.maxMana).toBe(state.player.maxMana + 1);
  });
});

