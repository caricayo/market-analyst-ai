import type { ArcDefinition, ContentRegistry, GameState } from "./types";

export type PrimaryObjective = {
  arcId: string;
  cardId: string;
  label: string;
  reason: string;
};

export function isResolvedArcPhase(phase: string): boolean {
  return phase.startsWith("resolved_");
}

export function getArcEntryCardId(registry: ContentRegistry, arc: ArcDefinition): string | undefined {
  return registry.cards.find((card) => card.entrySceneId === arc.discoveryEntrySceneId)?.id;
}

export function getArcByEntryCardId(registry: ContentRegistry, cardId: string): ArcDefinition | undefined {
  const card = registry.byId.cards[cardId];
  if (!card) return undefined;
  return registry.arcs.find((arc) => arc.discoveryEntrySceneId === card.entrySceneId);
}

function getDungeonGateCardId(registry: ContentRegistry, dungeonId: string): string | undefined {
  for (const scene of registry.scenes) {
    if (!scene.cardId) continue;
    if (scene.choices.some((choice) => choice.next.type === "dungeon" && choice.next.dungeonId === dungeonId)) {
      return scene.cardId;
    }
  }
  return undefined;
}

function getObjectiveForArc(state: GameState, registry: ContentRegistry, arc: ArcDefinition): PrimaryObjective | null {
  const phase = state.arcStates[arc.id] ?? "inactive";
  if (isResolvedArcPhase(phase)) {
    return null;
  }

  if (phase === "inactive" || phase === "discovery") {
    const entryCardId = getArcEntryCardId(registry, arc);
    if (!entryCardId) return null;
    return {
      arcId: arc.id,
      cardId: entryCardId,
      label: `${arc.title}: Discovery`,
      reason: "Follow the newest omen on the atlas.",
    };
  }

  if (phase === "escalation" || phase === "dungeon") {
    const gateCardId = getDungeonGateCardId(registry, arc.dungeonId);
    if (!gateCardId) return null;
    return {
      arcId: arc.id,
      cardId: gateCardId,
      label: `${arc.title}: Dungeon`,
      reason: "Descend and finish the arc route.",
    };
  }

  const climaxCardId = registry.byId.scenes[arc.climaxSceneId]?.cardId ?? getArcEntryCardId(registry, arc);
  if (!climaxCardId) return null;
  return {
    arcId: arc.id,
    cardId: climaxCardId,
    label: `${arc.title}: Climax`,
    reason: "Settle the final choice.",
  };
}

export function getPrimaryObjective(state: GameState, registry: ContentRegistry): PrimaryObjective | null {
  for (const arc of registry.arcs) {
    const objective = getObjectiveForArc(state, registry, arc);
    if (objective) {
      return objective;
    }
  }
  return null;
}
