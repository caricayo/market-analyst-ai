import type { GameState, Predicate } from "./types";

export function evaluatePredicate(state: GameState, predicate: Predicate): boolean {
  switch (predicate.type) {
    case "minLevel":
      return state.player.level >= predicate.value;
    case "flag": {
      const current = state.flags[predicate.key] ?? 0;
      if (predicate.op === "==") {
        return current === predicate.value;
      }
      if (typeof current !== "number" || typeof predicate.value !== "number") {
        return false;
      }
      return current >= predicate.value;
    }
    case "rep": {
      const rep = state.reputation[predicate.faction] ?? 0;
      return rep >= predicate.value;
    }
    case "hasItem":
      return state.player.inventory.includes(predicate.itemId) || state.player.relics.includes(predicate.itemId);
    case "regionCorruption": {
      const value = state.world.regions[predicate.regionId]?.corruption ?? 0;
      return value >= predicate.value;
    }
    default:
      return false;
  }
}

export function evaluateRequires(state: GameState, predicates?: Predicate[]): boolean {
  if (!predicates || predicates.length === 0) {
    return true;
  }
  return predicates.every((predicate) => evaluatePredicate(state, predicate));
}

