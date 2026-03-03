import regionsData from "../content/packs/regions.json";
import cardsData from "../content/packs/cards.json";
import scenesData from "../content/packs/scenes.json";
import arcsData from "../content/packs/arcs.json";
import dungeonsData from "../content/packs/dungeons.json";
import dungeonTemplatesData from "../content/packs/dungeonTemplates.json";
import itemsData from "../content/packs/items.json";
import affixesData from "../content/packs/affixes.json";
import cursesData from "../content/packs/curses.json";
import lootTablesData from "../content/packs/lootTables.json";
import enemiesData from "../content/packs/enemies.json";

import type { ContentRegistry } from "./types";

let cachedRegistry: ContentRegistry | null = null;

function mapById<T extends { id: string }>(items: T[]): Record<string, T> {
  return items.reduce<Record<string, T>>((acc, item) => {
    if (acc[item.id]) {
      throw new Error(`Duplicate id: ${item.id}`);
    }
    acc[item.id] = item;
    return acc;
  }, {});
}

function validateRegistry(registry: ContentRegistry): void {
  for (const card of registry.cards) {
    if (!registry.byId.regions[card.regionId]) {
      throw new Error(`Card ${card.id} references unknown region ${card.regionId}`);
    }
    if (!registry.byId.scenes[card.entrySceneId]) {
      throw new Error(`Card ${card.id} references missing entry scene ${card.entrySceneId}`);
    }
  }

  for (const scene of registry.scenes) {
    for (const choice of scene.choices) {
      if (choice.next.type === "scene" && !registry.byId.scenes[choice.next.sceneId]) {
        throw new Error(`Scene ${scene.id} choice ${choice.id} points to missing scene ${choice.next.sceneId}`);
      }
      if (choice.next.type === "dungeon" && !registry.byId.dungeons[choice.next.dungeonId]) {
        throw new Error(`Scene ${scene.id} choice ${choice.id} points to missing dungeon ${choice.next.dungeonId}`);
      }
      if (choice.next.type === "endArc" && !registry.byId.arcs[choice.next.arcId]) {
        throw new Error(`Scene ${scene.id} choice ${choice.id} points to missing arc ${choice.next.arcId}`);
      }
    }
  }

  for (const arc of registry.arcs) {
    if (!registry.byId.scenes[arc.discoveryEntrySceneId]) {
      throw new Error(`Arc ${arc.id} missing discovery scene ${arc.discoveryEntrySceneId}`);
    }
    if (!registry.byId.dungeons[arc.dungeonId]) {
      throw new Error(`Arc ${arc.id} missing dungeon ${arc.dungeonId}`);
    }
    if (!registry.byId.scenes[arc.climaxSceneId]) {
      throw new Error(`Arc ${arc.id} missing climax scene ${arc.climaxSceneId}`);
    }
    for (const sceneId of arc.endingSceneIds) {
      if (!registry.byId.scenes[sceneId]) {
        throw new Error(`Arc ${arc.id} missing ending scene ${sceneId}`);
      }
    }
  }

  for (const dungeon of registry.dungeons) {
    const ids = [dungeon.entryTemplateId, dungeon.bossTemplateId, dungeon.exitTemplateId, ...dungeon.middleTemplateIds];
    for (const templateId of ids) {
      if (!registry.byId.dungeonTemplates[templateId]) {
        throw new Error(`Dungeon ${dungeon.id} missing template ${templateId}`);
      }
    }
    if (!registry.byId.arcs[dungeon.arcId]) {
      throw new Error(`Dungeon ${dungeon.id} references missing arc ${dungeon.arcId}`);
    }
  }

  for (const table of registry.lootTables) {
    for (const entry of table.entries) {
      if (!registry.byId.items[entry.itemId]) {
        throw new Error(`Loot table ${table.id} references missing item ${entry.itemId}`);
      }
    }
  }
}

export function buildRegistry(): ContentRegistry {
  const regions = regionsData as unknown as ContentRegistry["regions"];
  const cards = cardsData as unknown as ContentRegistry["cards"];
  const scenes = scenesData as unknown as ContentRegistry["scenes"];
  const arcs = arcsData as unknown as ContentRegistry["arcs"];
  const dungeons = dungeonsData as unknown as ContentRegistry["dungeons"];
  const dungeonTemplates = dungeonTemplatesData as unknown as ContentRegistry["dungeonTemplates"];
  const items = itemsData as unknown as ContentRegistry["items"];
  const affixes = affixesData as unknown as ContentRegistry["affixes"];
  const curses = cursesData as unknown as ContentRegistry["curses"];
  const lootTables = lootTablesData as unknown as ContentRegistry["lootTables"];
  const enemies = enemiesData as unknown as ContentRegistry["enemies"];

  const registry: ContentRegistry = {
    regions,
    cards,
    scenes,
    arcs,
    dungeons,
    dungeonTemplates,
    items,
    affixes,
    curses,
    lootTables,
    enemies,
    byId: {
      regions: mapById(regions),
      cards: mapById(cards),
      scenes: mapById(scenes),
      arcs: mapById(arcs),
      dungeons: mapById(dungeons),
      dungeonTemplates: mapById(dungeonTemplates),
      items: mapById(items),
      affixes: mapById(affixes),
      curses: mapById(curses),
      lootTables: mapById(lootTables),
      enemies: mapById(enemies),
    },
  };

  validateRegistry(registry);
  return registry;
}

export function getRegistry(): ContentRegistry {
  if (!cachedRegistry) {
    cachedRegistry = buildRegistry();
  }
  return cachedRegistry;
}

