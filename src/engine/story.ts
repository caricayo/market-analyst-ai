import { resolveArcEnd } from "./arcs";
import { resolveRiskCheck, type RiskTier } from "./checks";
import { applyEffects } from "./effects";
import { completeCurrentDungeonNode, generateDungeonGraph, leaveDungeon, moveToNextDungeonNode } from "./dungeon";
import { rollLoot } from "./loot";
import { evaluateRequires } from "./predicates";
import { applyCost, applyLeveling, canPayCost } from "./state";
import type { Choice, ContentRegistry, GameState, NextTarget, Scene } from "./types";

function applySceneOnEnter(state: GameState, sceneId: string, registry: ContentRegistry): GameState {
  const scene = registry.byId.scenes[sceneId];
  if (!scene?.onEnterEffects?.length) {
    return state;
  }
  const applied = applyEffects(state, scene.onEnterEffects, registry);
  return {
    ...applied.state,
    outcomeLog: [...applied.state.outcomeLog, ...applied.logs],
  };
}

function applyNext(state: GameState, next: NextTarget, registry: ContentRegistry): GameState {
  switch (next.type) {
    case "scene":
      return applySceneOnEnter({
        ...state,
        currentScreen: "scene",
        activeSceneId: next.sceneId,
      }, next.sceneId, registry);
    case "atlas":
      return {
        ...state,
        currentScreen: "atlas",
        activeSceneId: undefined,
      };
    case "dungeon": {
      const generated = generateDungeonGraph(state, registry, next.dungeonId);
      return generated.state;
    }
    case "endArc": {
      const arc = registry.byId.arcs[next.arcId];
      if (!arc) return state;
      return resolveArcEnd(state, arc, next.endingId);
    }
    default:
      return state;
  }
}

function transitionDungeonToClimax(state: GameState, registry: ContentRegistry): GameState {
  const dungeonId = state.activeDungeon?.dungeonId;
  const fallback = leaveDungeon(state);
  const recoveredMana = Math.min(fallback.player.maxMana, Math.max(fallback.player.mana, 2));
  if (!dungeonId) return fallback;

  const dungeonDef = registry.byId.dungeons[dungeonId];
  if (!dungeonDef) return fallback;

  const arc = registry.byId.arcs[dungeonDef.arcId];
  if (!arc) return fallback;

  return {
    ...fallback,
    player: {
      ...fallback.player,
      mana: recoveredMana,
    },
    arcStates: { ...fallback.arcStates, [dungeonDef.arcId]: "climax" },
    activeSceneId: arc.climaxSceneId,
    currentScreen: "scene",
    outcomeLog: [...fallback.outcomeLog, "You steady yourself before the final decision."],
  };
}

function resolveChoiceByRisk(state: GameState, choice: Choice, registry: ContentRegistry): { state: GameState; log: string; tier?: RiskTier } {
  if (!choice.check) {
    const afterEffects = applyEffects(state, choice.effects, registry);
    const afterNext = applyNext(afterEffects.state, choice.next, registry);
    return { state: afterNext, log: afterEffects.logs.join(" ") || `You chose ${choice.text}.` };
  }

  const risk = resolveRiskCheck(state, choice.check);
  let next = { ...state, rng: risk.rng };

  const tierKey = risk.tier === "fail-forward" ? "failForward" : risk.tier;
  const tierOutcome = choice.outcomes?.[tierKey];

  const initialEffects = applyEffects(next, choice.effects, registry);
  next = initialEffects.state;

  const tierEffects = applyEffects(next, tierOutcome?.effects, registry);
  next = tierEffects.state;

  const nextTarget = tierOutcome?.next ?? choice.next;
  next = applyNext(next, nextTarget, registry);

  const label = tierOutcome?.text ?? `Risk check ${risk.tier}. (roll ${risk.roll} vs ${risk.target})`;
  return {
    state: next,
    log: [label, ...initialEffects.logs, ...tierEffects.logs].filter(Boolean).join(" "),
    tier: risk.tier,
  };
}

export function enterCard(state: GameState, registry: ContentRegistry, cardId: string): GameState {
  const card = registry.byId.cards[cardId];
  if (!card) return state;
  const regionCorruption = state.world.regions[card.regionId]?.corruption ?? 0;
  let updated = state;
  if (card.corruptionVariantAt !== undefined && regionCorruption >= card.corruptionVariantAt) {
    const transformed = applyEffects(updated, [{
      type: "transformCard",
      cardId: card.id,
      toStatus: "corrupted",
      toVariant: card.variantId ?? `${card.id}_corrupted`,
      addTags: ["corrupted"],
    }], registry);
    updated = transformed.state;
  }

  const base: GameState = {
    ...updated,
    activeCardId: cardId,
    activeSceneId: card.entrySceneId,
    currentScreen: "scene",
  };
  return applySceneOnEnter(base, card.entrySceneId, registry);
}

export function getCurrentScene(state: GameState, registry: ContentRegistry): Scene | null {
  if (state.activeDungeon) {
    const node = state.activeDungeon.nodes[state.activeDungeon.currentNodeId];
    const template = registry.byId.dungeonTemplates[node.templateId];
    const nextCount = node.next.length;

    const choices: Choice[] = [];
    if (template.type === "exit") {
      choices.push({
        id: "leave_dungeon",
        text: "Return to the atlas",
        cost: { time: 1 },
        next: { type: "atlas" },
      });
      return {
        id: `dungeon_${node.id}`,
        title: template.title,
        cardId: state.activeCardId,
        body: [template.body, `Danger tier: ${node.difficulty}.`],
        tags: ["dungeon", template.type],
        choices,
      };
    }

    if (template.type === "rest") {
      choices.push({
        id: "rest_then_move",
        text: "Rest by the embers and move onward",
        cost: { time: 1 },
        effects: [{ type: "log", message: "You regain your breath." }],
        next: { type: "atlas" },
      });
    } else if (template.type === "treasure") {
      choices.push({
        id: "search_cache",
        text: "Search the cache",
        cost: { time: 1 },
        effects: [{ type: "gainXp", amount: 12 }],
        next: { type: "atlas" },
      });
    } else {
      choices.push({
        id: "attempt",
        text: "Face the chamber",
        cost: { time: 1, mana: 1 },
        check: { type: "risk", stat: template.stat, difficulty: Math.min(5, Math.max(1, node.difficulty)) as 1 | 2 | 3 | 4 | 5 },
        outcomes: {
          success: { text: "You seize momentum.", effects: [{ type: "gainXp", amount: 20 }] },
          mixed: { text: "You press through with wounds.", effects: [{ type: "log", message: "You lose composure." }] },
          failForward: { text: "You falter, but the story pushes on.", effects: [{ type: "log", message: "Failure leaves a scar." }] },
        },
        next: { type: "atlas" },
      });
    }

    if (nextCount >= 1) {
      choices.push({
        id: "advance_main",
        text: "Advance deeper",
        cost: { time: 1 },
        next: { type: "atlas" },
      });
    }

    if (nextCount >= 2) {
      choices.push({
        id: "advance_branch",
        text: "Take the side passage",
        cost: { time: 2 },
        next: { type: "atlas" },
      });
    }

    return {
      id: `dungeon_${node.id}`,
      title: template.title,
      cardId: state.activeCardId,
      body: [template.body, `Danger tier: ${node.difficulty}.`],
      tags: ["dungeon", template.type],
      choices,
    };
  }

  if (!state.activeSceneId) {
    return null;
  }
  return registry.byId.scenes[state.activeSceneId] ?? null;
}

export function resolveCurrentChoice(state: GameState, registry: ContentRegistry, choiceId: string): GameState {
  const scene = getCurrentScene(state, registry);
  if (!scene) return state;
  const choice = scene.choices.find((entry) => entry.id === choiceId);
  if (!choice) return state;

  if (!evaluateRequires(state, choice.requires)) {
    return {
      ...state,
      outcomeLog: [...state.outcomeLog, "Requirements not met."],
    };
  }

  if (!canPayCost(state, choice.cost)) {
    return {
      ...state,
      outcomeLog: [...state.outcomeLog, "You cannot afford that choice."],
    };
  }

  let next = applyCost(state, choice.cost);

  if (state.activeDungeon) {
    const template = registry.byId.dungeonTemplates[state.activeDungeon.nodes[state.activeDungeon.currentNodeId].templateId];

    if (choice.id === "search_cache" && template.lootTableId) {
      const loot = rollLoot(next, registry, template.lootTableId);
      next = loot.state;
      if (loot.text) {
        next = { ...next, outcomeLog: [...next.outcomeLog, loot.text] };
      }
    }

    if (choice.id === "rest_then_move") {
      next = {
        ...next,
        player: {
          ...next.player,
          hp: Math.min(next.player.maxHp, next.player.hp + 4),
          mana: Math.min(next.player.maxMana, next.player.mana + 1),
        },
      };
    }

    if (choice.id === "attempt") {
      const resolved = resolveChoiceByRisk(next, choice, registry);
      next = resolved.state;
      if (resolved.log) {
        next = { ...next, outcomeLog: [...next.outcomeLog, resolved.log] };
      }

      if (resolved.tier === "fail-forward") {
        next = {
          ...next,
          player: {
            ...next.player,
            hp: Math.max(1, next.player.hp - 3),
            corruption: Math.min(100, next.player.corruption + 2),
          },
        };
      }
    }

    next = completeCurrentDungeonNode(next);

    if (choice.id === "leave_dungeon") {
      return applyLeveling(transitionDungeonToClimax(next, registry));
    }

    if (next.activeDungeon) {
      const choices = next.activeDungeon.nodes[next.activeDungeon.currentNodeId].next;
      if (choices.length === 0) {
        return applyLeveling(transitionDungeonToClimax(next, registry));
      }
      const targetNode = choice.id === "advance_branch" && choices.length > 1 ? choices[1] : choices[0];
      next = moveToNextDungeonNode(next, targetNode);
    }

    return applyLeveling(next);
  }

  const resolved = resolveChoiceByRisk(next, choice, registry);
  next = resolved.state;

  if (scene.cardId) {
    const currentLoc = next.world.locations[scene.cardId];
    if (currentLoc) {
      next = {
        ...next,
        world: {
          ...next.world,
          locations: {
            ...next.world.locations,
            [scene.cardId]: { ...currentLoc, lastVisitedTurn: next.time.turn },
          },
        },
      };
    }
  }

  if (resolved.log) {
    next = {
      ...next,
      outcomeLog: [...next.outcomeLog, resolved.log],
    };
  }

  return applyLeveling(next);
}

