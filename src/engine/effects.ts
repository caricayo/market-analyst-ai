import type { ContentRegistry, Effect, GameState } from "./types";
import { generateDungeonGraph } from "./dungeon";

export function applyEffects(state: GameState, effects: Effect[] | undefined, registry: ContentRegistry): { state: GameState; logs: string[] } {
  if (!effects || effects.length === 0) {
    return { state, logs: [] };
  }

  let next = state;
  const logs: string[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case "setFlag":
        next = { ...next, flags: { ...next.flags, [effect.key]: effect.value } };
        break;
      case "incFlag": {
        const current = Number(next.flags[effect.key] ?? 0);
        next = { ...next, flags: { ...next.flags, [effect.key]: current + effect.by } };
        break;
      }
      case "addItem":
        if (!next.player.inventory.includes(effect.itemId)) {
          next = {
            ...next,
            player: { ...next.player, inventory: [...next.player.inventory, effect.itemId] },
          };
        }
        break;
      case "removeItem":
        next = {
          ...next,
          player: { ...next.player, inventory: next.player.inventory.filter((id) => id !== effect.itemId) },
        };
        break;
      case "transformCard": {
        const current = next.world.locations[effect.cardId];
        if (!current) break;
        const mergedTags = new Set(current.tags);
        effect.addTags?.forEach((tag) => mergedTags.add(tag));
        effect.removeTags?.forEach((tag) => mergedTags.delete(tag));
        next = {
          ...next,
          world: {
            ...next.world,
            locations: {
              ...next.world.locations,
              [effect.cardId]: {
                ...current,
                status: effect.toStatus ?? current.status,
                variant: effect.toVariant ?? current.variant,
                tags: Array.from(mergedTags),
              },
            },
          },
        };
        break;
      }
      case "startDungeon": {
        const generated = generateDungeonGraph(next, registry, effect.dungeonId);
        next = generated.state;
        logs.push(`A dungeon opens: ${effect.dungeonId}`);
        break;
      }
      case "advanceArcPhase":
        next = {
          ...next,
          arcStates: {
            ...next.arcStates,
            [effect.arcId]: effect.phase,
          },
        };
        break;
      case "gainXp":
        next = {
          ...next,
          player: {
            ...next.player,
            xp: next.player.xp + effect.amount,
          },
        };
        break;
      case "adjustRep": {
        const current = next.reputation[effect.faction] ?? 0;
        next = {
          ...next,
          reputation: {
            ...next.reputation,
            [effect.faction]: current + effect.by,
          },
        };
        break;
      }
      case "log":
        logs.push(effect.message);
        break;
      default:
        break;
    }
  }

  return { state: next, logs };
}
