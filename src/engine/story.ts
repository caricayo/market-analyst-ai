import { resolveArcEnd } from "./arcs";
import { resolveRiskCheck, type RiskTier } from "./checks";
import { applyEffects } from "./effects";
import { completeCurrentDungeonNode, generateDungeonGraph, leaveDungeon, moveToNextDungeonNode } from "./dungeon";
import { rollLoot } from "./loot";
import { getArcByEntryCardId, isResolvedArcPhase } from "./objectives";
import { evaluateRequires } from "./predicates";
import { applyCost, applyLeveling, canPayCost, getCardRunCountForDay, getDailyDiminishingMultiplier, incrementCardRunCount } from "./state";
import type { Choice, ContentRegistry, GameState, NextTarget, Scene } from "./types";

type RiskResolveOptions = {
  applyNextTarget?: boolean;
  rewardMultiplier?: number;
};

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

function scaleRewardNumber(amount: number, multiplier: number): number {
  if (amount <= 0 || multiplier >= 1) {
    return amount;
  }
  return Math.max(1, Math.round(amount * multiplier));
}

function scaleRewardEffects(
  effects: Choice["effects"] | undefined,
  rewardMultiplier: number,
): Choice["effects"] | undefined {
  if (!effects || rewardMultiplier >= 1) {
    return effects;
  }
  return effects.map((effect) => {
    if (effect.type === "gainXp") {
      return { ...effect, amount: scaleRewardNumber(effect.amount, rewardMultiplier) };
    }
    if (effect.type === "adjustRep" && effect.by > 0) {
      return { ...effect, by: scaleRewardNumber(effect.by, rewardMultiplier) };
    }
    return effect;
  });
}

function hasRewardEffects(effects: Choice["effects"] | undefined): boolean {
  if (!effects || effects.length === 0) {
    return false;
  }
  return effects.some((effect) => effect.type === "gainXp" || effect.type === "adjustRep" || effect.type === "addItem");
}

function canChoiceGrantRewards(choice: Choice): boolean {
  if (hasRewardEffects(choice.effects)) {
    return true;
  }
  if (!choice.outcomes) {
    return false;
  }
  return Object.values(choice.outcomes).some((outcome) => hasRewardEffects(outcome?.effects));
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

function formatRiskLog(
  choice: Choice,
  state: GameState,
  roll: number,
  target: number,
  tier: RiskTier,
  tierText?: string,
): string {
  const statValue = choice.check ? state.player.stats[choice.check.stat] : 0;
  const detail = `Risk ${tier.toUpperCase()} (roll ${roll} vs target ${target}; ${choice.check?.stat ?? "unknown"} ${statValue}, diff ${choice.check?.difficulty ?? "?"}).`;
  if (tierText) {
    return `${tierText} ${detail}`;
  }
  return detail;
}

function resolveChoiceByRisk(
  state: GameState,
  choice: Choice,
  registry: ContentRegistry,
  options?: RiskResolveOptions,
): { state: GameState; log: string; tier?: RiskTier } {
  const rewardMultiplier = options?.rewardMultiplier ?? 1;
  if (!choice.check) {
    const afterEffects = applyEffects(state, scaleRewardEffects(choice.effects, rewardMultiplier), registry);
    const afterNext = options?.applyNextTarget === false
      ? afterEffects.state
      : applyNext(afterEffects.state, choice.next, registry);
    const baseLog = afterEffects.logs.join(" ") || `You chose ${choice.text}.`;
    const scaledLog = rewardMultiplier < 1 ? `Diminishing returns: ${Math.round(rewardMultiplier * 100)}% rewards applied.` : "";
    return { state: afterNext, log: [baseLog, scaledLog].filter(Boolean).join(" ") };
  }

  const risk = resolveRiskCheck(state, choice.check);
  let next = { ...state, rng: risk.rng };

  const tierKey = risk.tier === "fail-forward" ? "failForward" : risk.tier;
  const tierOutcome = choice.outcomes?.[tierKey];

  const initialEffects = applyEffects(next, scaleRewardEffects(choice.effects, rewardMultiplier), registry);
  next = initialEffects.state;

  const tierEffects = applyEffects(next, scaleRewardEffects(tierOutcome?.effects, rewardMultiplier), registry);
  next = tierEffects.state;

  if (options?.applyNextTarget !== false) {
    const nextTarget = tierOutcome?.next ?? choice.next;
    next = applyNext(next, nextTarget, registry);
  }

  const label = formatRiskLog(choice, state, risk.roll, risk.target, risk.tier, tierOutcome?.text);
  const scaledLog = rewardMultiplier < 1 ? `Diminishing returns: ${Math.round(rewardMultiplier * 100)}% rewards applied.` : "";
  return {
    state: next,
    log: [label, ...initialEffects.logs, ...tierEffects.logs, scaledLog].filter(Boolean).join(" "),
    tier: risk.tier,
  };
}

export function enterCard(state: GameState, registry: ContentRegistry, cardId: string): GameState {
  if (state.activeDungeon) {
    return {
      ...state,
      currentScreen: "scene",
      activeSceneId: undefined,
      outcomeLog: [...state.outcomeLog, "The expedition is still underway. Resolve the current dungeon route first."],
    };
  }

  const card = registry.byId.cards[cardId];
  if (!card) return state;
  const entryArc = getArcByEntryCardId(registry, cardId);

  if (entryArc) {
    const phase = state.arcStates[entryArc.id] ?? "inactive";
    if (isResolvedArcPhase(phase)) {
      const transformed = applyEffects(state, [{
        type: "transformCard",
        cardId: card.id,
        toStatus: card.postArcStatus ?? "cleared",
        toVariant: card.postArcVariantId ?? `${card.id}_resolved`,
        addTags: ["resolved"],
      }], registry);

      if (!card.postArcSceneId) {
        return {
          ...transformed.state,
          currentScreen: "atlas",
          activeSceneId: undefined,
          activeCardId: card.id,
          outcomeLog: [...transformed.state.outcomeLog, "That arc is already resolved. The location has changed."],
        };
      }

      const postArcState: GameState = {
        ...transformed.state,
        activeCardId: card.id,
        activeSceneId: card.postArcSceneId,
        currentScreen: "scene",
      };
      return applySceneOnEnter(postArcState, card.postArcSceneId, registry);
    }
  }

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
    const nodeResolved = state.activeDungeon.completedNodeIds.includes(node.id);

    const choices: Choice[] = [];
    if (template.type === "exit") {
      choices.push({
        id: "leave_dungeon",
        text: "Leave the dungeon",
        cost: { time: 1 },
        next: { type: "scene", sceneId: "dungeon_exit" },
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

    if (!nodeResolved) {
      if (template.type === "rest") {
        choices.push({
          id: "rest_then_move",
          text: "Rest by the embers",
          cost: { time: 1 },
          effects: [{ type: "log", message: "You regain your breath before pressing on." }],
          next: { type: "scene", sceneId: "dungeon_node" },
        });
      } else if (template.type === "treasure") {
        choices.push({
          id: "search_cache",
          text: "Search the cache",
          cost: { time: 1 },
          effects: [{ type: "gainXp", amount: 12 }],
          next: { type: "scene", sceneId: "dungeon_node" },
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
          next: { type: "scene", sceneId: "dungeon_node" },
        });
        choices.push({
          id: "brute_force",
          text: "Force progress on grit",
          cost: { time: 1, hp: 2, corruption: 1 },
          effects: [
            { type: "gainXp", amount: 8 },
            { type: "log", message: "You grind through without proper focus." },
          ],
          next: { type: "scene", sceneId: "dungeon_node" },
        });
      }
    } else {
      if (nextCount >= 1) {
        choices.push({
          id: "advance_main",
          text: "Advance deeper",
          cost: { time: 1 },
          next: { type: "scene", sceneId: "dungeon_node" },
        });
      }

      if (nextCount >= 2) {
        choices.push({
          id: "advance_branch",
          text: "Take the side passage",
          cost: { time: 2 },
          next: { type: "scene", sceneId: "dungeon_node" },
        });
      }
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

export function getCurrentRenderableSceneId(state: GameState): string | null {
  if (state.activeDungeon) {
    return `dungeon:${state.activeDungeon.currentNodeId}`;
  }
  return state.activeSceneId ?? null;
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
    const node = state.activeDungeon.nodes[state.activeDungeon.currentNodeId];
    const template = registry.byId.dungeonTemplates[node.templateId];
    const nodeResolved = state.activeDungeon.completedNodeIds.includes(node.id);
    const isAdvanceChoice = choice.id === "advance_main" || choice.id === "advance_branch";
    const isNodeActionChoice = choice.id === "attempt"
      || choice.id === "search_cache"
      || choice.id === "rest_then_move"
      || choice.id === "brute_force";

    if (isAdvanceChoice && !nodeResolved) {
      return {
        ...state,
        outcomeLog: [...state.outcomeLog, "You must resolve this chamber before advancing."],
      };
    }

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
      const resolved = resolveChoiceByRisk(next, choice, registry, { applyNextTarget: false });
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
    if (choice.id !== "attempt" && choice.effects?.length) {
      const applied = applyEffects(next, choice.effects, registry);
      next = applied.state;
      if (applied.logs.length > 0) {
        next = {
          ...next,
          outcomeLog: [...next.outcomeLog, ...applied.logs],
        };
      }
    }

    if (choice.id === "leave_dungeon") {
      return applyLeveling(transitionDungeonToClimax(next, registry));
    }

    if (isNodeActionChoice) {
      next = completeCurrentDungeonNode(next);
      const nextChoices = next.activeDungeon?.nodes[next.activeDungeon.currentNodeId].next ?? [];
      if (nextChoices.length === 0) {
        return applyLeveling(transitionDungeonToClimax(next, registry));
      }
      return applyLeveling({
        ...next,
        currentScreen: "scene",
      });
    }

    if (isAdvanceChoice && next.activeDungeon) {
      const nextChoices = next.activeDungeon.nodes[next.activeDungeon.currentNodeId].next;
      if (nextChoices.length === 0) {
        return applyLeveling(transitionDungeonToClimax(next, registry));
      }
      const targetNode = choice.id === "advance_branch" && nextChoices.length > 1 ? nextChoices[1] : nextChoices[0];
      next = moveToNextDungeonNode(next, targetNode);
    }

    return applyLeveling(next);
  }

  const inferredRewardProfile = scene.rewardProfile ?? (scene.tags.some((tag) => tag.startsWith("arc")) ? "arcCritical" : "repeatable");
  const sceneIsDiminishingEligible = Boolean(scene.cardId)
    && (scene.diminishingEligible ?? true)
    && inferredRewardProfile === "repeatable";
  const rewardEligibleChoice = sceneIsDiminishingEligible && canChoiceGrantRewards(choice);
  const rewardMultiplier = rewardEligibleChoice && scene.cardId
    ? getDailyDiminishingMultiplier(getCardRunCountForDay(next, scene.cardId))
    : 1;

  const resolved = resolveChoiceByRisk(next, choice, registry, { rewardMultiplier });
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

  if (rewardEligibleChoice && scene.cardId) {
    next = incrementCardRunCount(next, scene.cardId);
  }

  if (resolved.log) {
    next = {
      ...next,
      outcomeLog: [...next.outcomeLog, resolved.log],
    };
  }

  return applyLeveling(next);
}

