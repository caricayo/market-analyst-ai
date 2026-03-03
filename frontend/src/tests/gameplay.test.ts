import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { rollD100 } from "../engine/rng";
import { evaluateRequires } from "../engine/predicates";
import { canPayCost } from "../engine/state";
import { enterCard, getCurrentScene, resolveCurrentChoice } from "../engine/story";
import type { ActiveDungeon, DungeonNode, GameState } from "../engine/types";

type ArcPath = {
  cardId: string;
  preDungeonChoices: string[];
  postDungeonChoices: string[];
  expectedEnding: string;
};

const registry = getRegistry();

const EMBER_PATH: ArcPath = {
  cardId: "card_ember_hollow",
  preDungeonChoices: ["ember_follow_courier", "ember_take_oath", "ember_guard_braziers", "ember_enter_vault"],
  postDungeonChoices: ["ember_choose_dawn", "ember_end_dawn"],
  expectedEnding: "dawn",
};

const ASTRAL_PATH: ArcPath = {
  cardId: "card_prism_step",
  preDungeonChoices: ["astral_trace_song", "astral_decode", "astral_bargain", "astral_enter_well"],
  postDungeonChoices: ["astral_choose_tide", "astral_end_tide"],
  expectedEnding: "tide",
};

function choose(state: GameState, choiceId: string): GameState {
  const scene = getCurrentScene(state, registry);
  if (!scene) {
    throw new Error(`No active scene for choice ${choiceId}`);
  }
  if (!scene.choices.some((choice) => choice.id === choiceId)) {
    throw new Error(`Choice ${choiceId} missing in scene ${scene.id}`);
  }
  return resolveCurrentChoice(state, registry, choiceId);
}

function traverseDungeon(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while (next.activeDungeon) {
    guard += 1;
    if (guard > 100) {
      throw new Error("Dungeon traversal guard hit");
    }

    let scene = getCurrentScene(next, registry);
    if (!scene) {
      throw new Error("Missing dungeon scene");
    }

    if (scene.choices.some((choice) => choice.id === "leave_dungeon")) {
      next = resolveCurrentChoice(next, registry, "leave_dungeon");
      continue;
    }

    const selected = scene.choices.find((choice) => evaluateRequires(next, choice.requires) && canPayCost(next, choice.cost));
    if (selected) {
      next = resolveCurrentChoice(next, registry, selected.id);
      continue;
    }

    throw new Error(`No selectable dungeon choices in ${scene.id}`);
  }

  return next;
}

function runArcPath(baseState: GameState, path: ArcPath): GameState {
  let next = enterCard(baseState, registry, path.cardId);
  for (const choiceId of path.preDungeonChoices) {
    next = choose(next, choiceId);
  }

  expect(next.activeDungeon).toBeDefined();
  next = traverseDungeon(next);
  expect(next.activeSceneId).toBeDefined();

  for (const choiceId of path.postDungeonChoices) {
    next = choose(next, choiceId);
  }

  expect(next.currentScreen).toBe("endArc");
  expect(next.endingSummary?.endingId).toBe(path.expectedEnding);

  return { ...next, currentScreen: "atlas", endingSummary: undefined };
}

function buildSingleNodeDungeonState(seedText: string): GameState {
  const base = createInitialState(seedText, registry);

  const node: DungeonNode = {
    id: "entry",
    templateId: "tmpl_ember_boss",
    type: "combat",
    difficulty: 5,
    next: [],
  };

  const activeDungeon: ActiveDungeon = {
    dungeonId: "dungeon_embervault",
    nodes: { entry: node },
    currentNodeId: "entry",
    completedNodeIds: [],
    generatedAtTurn: 0,
  };

  return {
    ...base,
    currentScreen: "scene",
    activeDungeon,
    arcStates: {
      ...base.arcStates,
      arc_ember_crown: "dungeon",
    },
  };
}

describe("gameplay coverage", () => {
  it("completes both arcs through golden-path choices", () => {
    let state: GameState = { ...createInitialState("golden-seed", registry), currentScreen: "atlas" };
    state = runArcPath(state, EMBER_PATH);
    state = runArcPath(state, ASTRAL_PATH);

    const endings = state.endings.map((entry) => `${entry.arcId}:${entry.endingId}`);
    expect(endings).toContain("arc_ember_crown:dawn");
    expect(endings).toContain("arc_astral_well:tide");
  });

  it("routes resolved arc cards to their post-arc aftermath scenes", () => {
    let state: GameState = { ...createInitialState("aftermath-seed", registry), currentScreen: "atlas" };
    state = runArcPath(state, EMBER_PATH);
    const revisit = enterCard({ ...state, currentScreen: "atlas" }, registry, "card_ember_hollow");
    expect(revisit.activeSceneId).toBe("ember_aftermath");
  });

  it("applies fail-forward penalties independent of narrative text", () => {
    let failingSeed: number | null = null;
    for (let seed = 1; seed < 5000; seed += 1) {
      const roll = rollD100({ seed, step: 0 }).value;
      if (roll >= 38) {
        failingSeed = seed;
        break;
      }
    }
    if (failingSeed === null) {
      throw new Error("Could not find deterministic fail-forward seed");
    }

    const state = buildSingleNodeDungeonState("failure-seed");
    const beforeHp = state.player.hp;
    const beforeCorruption = state.player.corruption;

    const after = resolveCurrentChoice(
      { ...state, rng: { seed: failingSeed, step: 0 } },
      registry,
      "attempt",
    );

    expect(after.player.hp).toBe(beforeHp - 3);
    expect(after.player.corruption).toBe(beforeCorruption + 2);
    expect(after.activeSceneId).toBe("ember_climax");
  });

  it("keeps dungeon flow in scene mode after resolving a node action", () => {
    let next = enterCard({ ...createInitialState("dungeon-flow", registry), currentScreen: "atlas" }, registry, EMBER_PATH.cardId);
    for (const choiceId of EMBER_PATH.preDungeonChoices) {
      next = choose(next, choiceId);
    }
    expect(next.activeDungeon).toBeDefined();

    const scene = getCurrentScene(next, registry);
    expect(scene?.choices.some((choice) => choice.id === "attempt")).toBe(true);
    next = resolveCurrentChoice(next, registry, "attempt");

    expect(next.activeDungeon).toBeDefined();
    expect(next.currentScreen).toBe("scene");
  });
});
