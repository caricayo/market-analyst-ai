import type { ContentRegistry, Cost, GameState } from "./types";
import { evaluateRequires } from "./predicates";

export function xpToNext(level: number): number {
  return 50 + level * 25;
}

export function applyLeveling(state: GameState): GameState {
  let next = state;
  while (next.player.xp >= next.player.xpToNext) {
    const remainder = next.player.xp - next.player.xpToNext;
    next = {
      ...next,
      player: {
        ...next.player,
        level: next.player.level + 1,
        xp: remainder,
        xpToNext: xpToNext(next.player.level + 1),
        maxHp: next.player.maxHp + 5,
        hp: next.player.hp + 5,
        maxMana: next.player.maxMana + 1,
        mana: next.player.mana + 1,
      },
      flags: {
        ...next.flags,
        stat_points: Number(next.flags.stat_points ?? 0) + 1,
      },
      outcomeLog: [...next.outcomeLog, `Level up! You are now level ${next.player.level + 1}.`],
    };
  }
  return next;
}

export function canPayCost(state: GameState, cost?: Cost): boolean {
  if (!cost) return true;
  const manaCost = cost.mana ?? 0;
  const hpCost = cost.hp ?? 0;
  const corruptionCost = cost.corruption ?? 0;

  if (state.player.hp - hpCost <= 0) return false;

  const hasBloodquill = state.player.inventory.includes("artifact_bloodquill") || state.player.relics.includes("artifact_bloodquill");
  if (manaCost > state.player.mana && !hasBloodquill) {
    return false;
  }

  if (state.player.corruption + corruptionCost > 100) {
    return false;
  }

  return true;
}

export function applyCost(state: GameState, cost?: Cost): GameState {
  if (!cost) {
    return advanceTime(state, 1);
  }

  let mana = state.player.mana;
  let corruption = state.player.corruption;
  const hp = Math.max(1, state.player.hp - (cost.hp ?? 0));

  const manaCost = cost.mana ?? 0;
  const hasBloodquill = state.player.inventory.includes("artifact_bloodquill") || state.player.relics.includes("artifact_bloodquill");
  if (manaCost > mana && hasBloodquill) {
    const deficit = manaCost - mana;
    mana = 0;
    corruption += deficit;
  } else {
    mana = Math.max(0, mana - manaCost);
  }

  corruption += cost.corruption ?? 0;
  corruption = Math.min(100, Math.max(0, corruption));

  const withResources = {
    ...state,
    player: {
      ...state.player,
      hp,
      mana,
      corruption,
    },
  };

  return advanceTime(withResources, cost.time ?? 1);
}

function applyDailyUpkeep(state: GameState): GameState {
  const regainedMana = Math.min(state.player.maxMana, state.player.mana + 1);
  const reducedCorruption = Math.max(0, state.player.corruption - 1);

  const regions = { ...state.world.regions };
  for (const [regionId, data] of Object.entries(regions)) {
    regions[regionId] = { corruption: Math.min(100, data.corruption + 1) };
  }

  return {
    ...state,
    player: {
      ...state.player,
      mana: regainedMana,
      corruption: reducedCorruption,
    },
    flags: {
      ...state.flags,
      reroll_day_stamp: state.time.day,
      reroll_day_used: 0,
    },
    world: {
      ...state.world,
      regions,
    },
    outcomeLog: [...state.outcomeLog, `Dawn ${state.time.day}: the world shifts under pressure.`],
  };
}

export function advanceTime(state: GameState, turns: number): GameState {
  let next = state;
  for (let i = 0; i < turns; i += 1) {
    const nextTurn = next.time.turn + 1;
    const nextDay = Math.floor(nextTurn / 10) + 1;
    const dayChanged = nextDay !== next.time.day;
    next = {
      ...next,
      time: { turn: nextTurn, day: nextDay },
    };

    if (dayChanged) {
      next = applyDailyUpkeep(next);
    }
  }

  return next;
}

export function isCardUnlocked(state: GameState, registry: ContentRegistry, cardId: string): boolean {
  const card = registry.byId.cards[cardId];
  if (!card) return false;
  const location = state.world.locations[cardId];
  if (!location) return false;

  const hasLens = state.player.inventory.includes("artifact_void_lens") || state.player.relics.includes("artifact_void_lens");
  if (location.status === "hidden" && !hasLens) return false;

  return evaluateRequires(state, card.requires);
}
