import type { ArcDefinition, ArcPhase, GameState, WorldTransform } from "./types";
import { isResolvedArcPhase } from "./objectives";

export function applyWorldTransform(state: GameState, transform: WorldTransform): { state: GameState; changes: string[]; unlockedCards: string[] } {
  let next = state;
  const changes: string[] = [];
  const unlockedCards: string[] = [];

  if (transform.setCardStatus) {
    for (const patch of transform.setCardStatus) {
      const current = next.world.locations[patch.cardId];
      if (!current) continue;
      const wasHidden = current.status === "hidden";
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
      if (patch.status === "visible" && wasHidden) {
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
        changes.push(`revealed ${cardId}`);
      }
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
  const currentPhase = state.arcStates[arc.id] ?? "inactive";
  if (isResolvedArcPhase(currentPhase)) {
    return {
      ...state,
      currentScreen: "endArc",
      endingSummary: {
        arcId: arc.id,
        endingId: currentPhase.replace("resolved_", ""),
        worldChanges: ["Arc already resolved in this run."],
        unlockedCards: [],
        statDelta: [
          `Corruption: ${state.player.corruption} -> ${state.player.corruption}`,
          `HP: ${state.player.hp} -> ${state.player.hp}`,
          `Mana: ${state.player.mana} -> ${state.player.mana}`,
        ],
      },
    };
  }

  const endingKey = `resolved_${endingId}` as ArcPhase;
  const transform = arc.worldTransforms[endingId] ?? {};
  const withPhase = setArcPhase(state, arc.id, endingKey);
  const transformed = applyWorldTransform(withPhase, transform);
  const recovered = {
    ...transformed.state,
    player: {
      ...transformed.state.player,
      hp: Math.min(transformed.state.player.maxHp, transformed.state.player.hp + 3),
      mana: Math.min(transformed.state.player.maxMana, transformed.state.player.mana + 2),
    },
  };

  const endingExists = recovered.endings.some((entry) => entry.arcId === arc.id && entry.endingId === endingId);
  const nextEndings = endingExists
    ? recovered.endings
    : [...recovered.endings, { arcId: arc.id, endingId, day: state.time.day, turn: state.time.turn }];

  return {
    ...recovered,
    currentScreen: "endArc",
    endings: nextEndings,
    endingSummary: {
      arcId: arc.id,
      endingId,
      worldChanges: transformed.changes,
      unlockedCards: transformed.unlockedCards,
      statDelta: [
        `Corruption: ${state.player.corruption} -> ${recovered.player.corruption}`,
        `HP: ${state.player.hp} -> ${recovered.player.hp}`,
        `Mana: ${state.player.mana} -> ${recovered.player.mana}`,
      ],
    },
  };
}

