import { describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";

const registry = getRegistry();

function maxSceneDepth(sceneId: string, visited: Set<string> = new Set()): number {
  if (visited.has(sceneId)) return 0;
  const scene = registry.byId.scenes[sceneId];
  if (!scene) return 0;

  const nextVisited = new Set(visited);
  nextVisited.add(sceneId);

  let bestChildDepth = 0;
  for (const choice of scene.choices) {
    if (choice.next.type === "scene") {
      bestChildDepth = Math.max(bestChildDepth, maxSceneDepth(choice.next.sceneId, nextVisited));
    }
  }

  return 1 + bestChildDepth;
}

describe("content depth", () => {
  it("provides multi-scene chains for non-arc hub cards", () => {
    const hubCardIds = [
      "card_cinder_market",
      "card_root_archive",
      "card_mire_bridge",
      "card_mirror_lake",
      "card_shard_forge",
    ];

    for (const cardId of hubCardIds) {
      const card = registry.byId.cards[cardId];
      const depth = maxSceneDepth(card.entrySceneId);
      expect(depth).toBeGreaterThanOrEqual(3);
    }
  });
});
