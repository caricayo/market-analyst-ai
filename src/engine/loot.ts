import { pickWeighted, rollInt } from "./rng";
import type { ContentRegistry, GameState, ItemDefinition, LootTable } from "./types";

function filteredEntries(table: LootTable, level: number) {
  return table.entries.filter((entry) => {
    if (entry.minLevel !== undefined && level < entry.minLevel) return false;
    if (entry.maxLevel !== undefined && level > entry.maxLevel) return false;
    return true;
  });
}

export function rollLoot(state: GameState, registry: ContentRegistry, lootTableId: string): { state: GameState; item?: ItemDefinition; text?: string } {
  const table = registry.byId.lootTables[lootTableId];
  if (!table) {
    return { state, text: `No loot table ${lootTableId}` };
  }

  const entries = filteredEntries(table, state.player.level);
  if (entries.length === 0) {
    return { state, text: "No valid loot entries for this level." };
  }

  const weighted = entries.map((entry) => ({ weight: entry.weight + state.player.level, value: entry }));
  const picked = pickWeighted(state.rng, weighted);
  let nextState = { ...state, rng: picked.rng };
  let baseItem = registry.byId.items[picked.value.itemId];

  if (!baseItem) {
    return { state: nextState, text: "Loot roll failed to resolve item." };
  }

  const affixRoll = rollInt(nextState.rng, 1, 100);
  nextState = { ...nextState, rng: affixRoll.rng };
  if (!baseItem.unique && affixRoll.value >= 60) {
    const affixes = registry.affixes;
    const affixPick = rollInt(nextState.rng, 0, affixes.length - 1);
    nextState = { ...nextState, rng: affixPick.rng };
    const affix = affixes[affixPick.value];
    baseItem = {
      ...baseItem,
      name: `${affix.prefix ?? ""} ${baseItem.name}${affix.suffix ? ` ${affix.suffix}` : ""}`.replace(/\s+/g, " ").trim(),
      lore: `${baseItem.lore} ${affix.effectText}`,
    };
  }

  const curseRoll = rollInt(nextState.rng, 1, 100);
  nextState = { ...nextState, rng: curseRoll.rng };
  if (!baseItem.unique && curseRoll.value >= 92) {
    const cursePick = rollInt(nextState.rng, 0, registry.curses.length - 1);
    nextState = { ...nextState, rng: cursePick.rng };
    const curse = registry.curses[cursePick.value];
    baseItem = {
      ...baseItem,
      name: `${baseItem.name} (${curse.name})`,
      lore: `${baseItem.lore} Curse: ${curse.effectText}`,
    };
  }

  if (!nextState.player.inventory.includes(baseItem.id)) {
    nextState = {
      ...nextState,
      player: {
        ...nextState.player,
        inventory: [...nextState.player.inventory, baseItem.id],
      },
    };
  }

  return { state: nextState, item: baseItem, text: `You found ${baseItem.name}.` };
}

