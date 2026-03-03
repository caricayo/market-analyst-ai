import type { ArcDefinition, ArcPhase, GameState, WorldTransform } from "./types";

export function applyWorldTransform(state: GameState, transform: WorldTransform): { state: GameState; changes: string[]; unlockedCards: string[] } {
  let next = state;
  const changes: string[] = [];
  const unlockedCards: string[] = [];

  if (transform.setCardStatus) {
    for (const patch of transform.setCardStatus) {
      const current = next.world.locations[patch.cardId];
      if (!current) continue;
      next = {
        ...next,
        world: {
          ...next.world,
          locations: {
            ...next.world.locations,
            [patch.cardId]: { ...current, status: patch.status },
          },
        },
      };
      changes.push(`${patch.cardId} -> ${patch.status}`);
      if (patch.status === "visible") {
        unlockedCards.push(patch.cardId);
      }
    }
  }

  if (transform.adjustRegionCorruption) {
    for (const patch of transform.adjustRegionCorruption) {
      const current = next.world.regions[patch.regionId] ?? { corruption: 0 };
      const value = Math.max(0, current.corruption + patch.by);
      next = {
        ...next,
        world: {
          ...next.world,
          regions: {
            ...next.world.regions,
            [patch.regionId]: { corruption: value },
          },
        },
      };
      changes.push(`${patch.regionId} corruption ${patch.by >= 0 ? "+" : ""}${patch.by}`);
    }
  }

  if (transform.revealCards) {
    for (const cardId of transform.revealCards) {
      const current = next.world.locations[cardId];
      if (!current) continue;
      if (current.status === "hidden") {
        next = {
          ...next,
          world: {
            ...next.world,
            locations: {
              ...next.world.locations,
              [cardId]: { ...current, status: "visible" },
            },
          },
        };
        unlockedCards.push(cardId);
      }
      changes.push(`revealed ${cardId}`);
    }
  }

  if (transform.setFlags) {
    const updatedFlags = { ...next.flags };
    for (const pair of transform.setFlags) {
      updatedFlags[pair.key] = pair.value;
      changes.push(`flag ${pair.key}=${String(pair.value)}`);
    }
    next = { ...next, flags: updatedFlags };
  }

  return { state: next, changes, unlockedCards };
}

export function setArcPhase(state: GameState, arcId: string, phase: ArcPhase): GameState {
  return {
    ...state,
    arcStates: {
      ...state.arcStates,
      [arcId]: phase,
    },
  };
}

export function resolveArcEnd(state: GameState, arc: ArcDefinition, endingId: string): GameState {
  const endingKey = `resolved_${endingId}` as ArcPhase;
  const transform = arc.worldTransforms[endingId] ?? {};
  const withPhase = setArcPhase(state, arc.id, endingKey);
  const transformed = applyWorldTransform(withPhase, transform);

  return {
    ...transformed.state,
    currentScreen: "endArc",
    endings: [...transformed.state.endings, { arcId: arc.id, endingId, day: state.time.day, turn: state.time.turn }],
    endingSummary: {
      arcId: arc.id,
      endingId,
      worldChanges: transformed.changes,
      unlockedCards: transformed.unlockedCards,
      statDelta: [
        `Corruption: ${state.player.corruption} -> ${transformed.state.player.corruption}`,
        `HP: ${state.player.hp} -> ${transformed.state.player.hp}`,
        `Mana: ${state.player.mana} -> ${transformed.state.player.mana}`,
      ],
    },
  };
}
