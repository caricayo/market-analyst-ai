import { createSeedFromString } from "./rng";
import type { ContentRegistry, GameState } from "./types";

export const SAVE_VERSION = 1;
const SAVE_KEY = "mystic-atlas-save";

export type SaveEnvelope = {
  version: number;
  state: GameState;
};

export function createInitialState(seedText: string, registry: ContentRegistry): GameState {
  const seed = createSeedFromString(seedText || "emberfall");
  const locations = registry.cards.reduce<Record<string, GameState["world"]["locations"][string]>>((acc, card) => {
    acc[card.id] = {
      status: card.requires?.length ? "hidden" : "visible",
      tags: [...card.tags],
      variant: card.variantId,
    };
    return acc;
  }, {});

  const regions = registry.regions.reduce<Record<string, { corruption: number }>>((acc, region) => {
    acc[region.id] = { corruption: 0 };
    return acc;
  }, {});

  const arcStates = registry.arcs.reduce<Record<string, GameState["arcStates"][string]>>((acc, arc) => {
    acc[arc.id] = "inactive";
    return acc;
  }, {});

  return {
    version: SAVE_VERSION,
    runId: `${Date.now()}-${seed}`,
    currentScreen: "title",
    player: {
      level: 1,
      xp: 0,
      xpToNext: 75,
      hp: 20,
      maxHp: 20,
      mana: 5,
      maxMana: 5,
      corruption: 0,
      stats: {
        resolve: 2,
        knowledge: 2,
        might: 2,
        craft: 2,
      },
      inventory: [],
      relics: [],
      tags: [],
    },
    time: { turn: 0, day: 1 },
    flags: {
      reroll_day_used: 0,
      reroll_day_stamp: 1,
    },
    reputation: {
      pilgrims: 0,
      concord: 0,
      undercourt: 0,
    },
    world: {
      regions,
      locations,
    },
    arcStates,
    endings: [],
    ngPlusTier: 0,
    rng: { seed, step: 0 },
    outcomeLog: ["A new atlas awakens."],
  };
}

export function saveGame(state: GameState): void {
  const envelope: SaveEnvelope = { version: state.version, state };
  localStorage.setItem(SAVE_KEY, JSON.stringify(envelope));
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

export function loadGame(registry: ContentRegistry): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SaveEnvelope;
    return migrateState(parsed, registry);
  } catch {
    return null;
  }
}

function migrateState(envelope: SaveEnvelope, registry: ContentRegistry): GameState {
  if (envelope.version === SAVE_VERSION) {
    return envelope.state;
  }
  // Migration stub for future save versions.
  return {
    ...createInitialState("migrated-seed", registry),
    outcomeLog: ["Save migration fallback applied."],
  };
}

