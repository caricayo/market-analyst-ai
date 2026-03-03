import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { getPrimaryObjective } from "../engine/objectives";
import { createInitialState } from "../engine/save";
import { advanceTime } from "../engine/state";
import { enterCard, getCurrentRenderableSceneId, resolveCurrentChoice } from "../engine/story";
import type { GameState } from "../engine/types";

const registry = getRegistry();

function runMarketLoop(state: GameState): GameState {
  let next = enterCard(state, registry, "card_cinder_market");
  next = resolveCurrentChoice(next, registry, "market_follow_broker");
  next = resolveCurrentChoice(next, registry, "market_back_out");
  return next;
}

describe("progression guards", () => {
  it("reroutes resolved arc entry cards to post-arc scenes", () => {
    const state = createInitialState("replay-lock", registry);
    const resolved = {
      ...state,
      currentScreen: "atlas" as const,
      arcStates: {
        ...state.arcStates,
        arc_ember_crown: "resolved_dawn" as const,
      },
    };

    const entered = enterCard(resolved, registry, "card_ember_hollow");
    expect(entered.activeSceneId).toBe("ember_aftermath");
    expect(entered.world.locations.card_ember_hollow.status).toBe("cleared");
    expect(entered.world.locations.card_ember_hollow.variant).toBe("card_ember_hollow_resolved");
  });

  it("applies daily diminishing returns to repeatable card rewards", () => {
    let state: GameState = { ...createInitialState("diminish-seed", registry), currentScreen: "atlas" };
    const before = state.player.xp;

    state = runMarketLoop(state);
    const firstGain = state.player.xp - before;
    state = runMarketLoop(state);
    const secondGain = state.player.xp - before - firstGain;
    state = runMarketLoop(state);
    const thirdGain = state.player.xp - before - firstGain - secondGain;

    expect(firstGain).toBe(5);
    expect(secondGain).toBe(3);
    expect(thirdGain).toBe(1);
    expect(state.economy.cardDailyRuns.card_cinder_market.runs).toBe(3);
  });

  it("resets diminishing returns on day rollover", () => {
    let state: GameState = { ...createInitialState("diminish-reset", registry), currentScreen: "atlas" };
    state = runMarketLoop(state);
    state = runMarketLoop(state);
    expect(state.time.day).toBe(1);

    state = advanceTime(state, 6);
    expect(state.time.day).toBe(2);

    const before = state.player.xp;
    state = runMarketLoop(state);
    const gain = state.player.xp - before;
    expect(gain).toBe(5);
    expect(state.economy.cardDailyRuns.card_cinder_market.day).toBe(2);
    expect(state.economy.cardDailyRuns.card_cinder_market.runs).toBe(1);
  });

  it("prioritizes arc 2 objective after arc 1 resolution", () => {
    const state = createInitialState("objective-seed", registry);
    const postArcOne = {
      ...state,
      arcStates: {
        ...state.arcStates,
        arc_ember_crown: "resolved_dawn" as const,
      },
    };

    const objective = getPrimaryObjective(postArcOne, registry);
    expect(objective?.arcId).toBe("arc_astral_well");
    expect(objective?.cardId).toBe("card_prism_step");
  });

  it("provides stable renderable scene ids while in dungeons", () => {
    let state: GameState = { ...createInitialState("scene-id", registry), currentScreen: "atlas" };
    state = enterCard(state, registry, "card_ember_hollow");
    state = resolveCurrentChoice(state, registry, "ember_follow_courier");
    state = resolveCurrentChoice(state, registry, "ember_take_oath");
    state = resolveCurrentChoice(state, registry, "ember_guard_braziers");
    state = resolveCurrentChoice(state, registry, "ember_enter_vault");

    expect(state.activeDungeon).toBeDefined();
    expect(getCurrentRenderableSceneId(state)?.startsWith("dungeon:")).toBe(true);
  });
});
