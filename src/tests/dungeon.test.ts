import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { createInitialState } from "../engine/save";
import { generateDungeonGraph } from "../engine/dungeon";

describe("dungeon determinism", () => {
  const registry = getRegistry();

  it("generates stable graph for same seed", () => {
    const baseA = createInitialState("same-seed", registry);
    const baseB = createInitialState("same-seed", registry);

    const dungeonA = generateDungeonGraph(baseA, registry, "dungeon_embervault").state.activeDungeon;
    const dungeonB = generateDungeonGraph(baseB, registry, "dungeon_embervault").state.activeDungeon;

    expect(dungeonA).toEqual(dungeonB);
  });
});
