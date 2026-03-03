import { pickOne, rollInt } from "./rng";
import type { ArcPhase, ContentRegistry, DungeonDefinition, DungeonNode, DungeonNodeTemplate, GameState } from "./types";

const PHASE_DIFFICULTY_OFFSET: Record<string, number> = {
  inactive: 0,
  discovery: 0,
  escalation: 1,
  dungeon: 2,
  climax: 3,
};

function phaseOffset(phase: ArcPhase): number {
  const key = phase.startsWith("resolved_") ? "climax" : phase;
  return PHASE_DIFFICULTY_OFFSET[key] ?? 1;
}

function makeNode(id: string, template: DungeonNodeTemplate, difficulty: number, next: string[] = []): DungeonNode {
  return {
    id,
    templateId: template.id,
    type: template.type,
    difficulty,
    next,
  };
}

export function generateDungeonGraph(
  state: GameState,
  registry: ContentRegistry,
  dungeonId: string,
): { dungeon: GameState["activeDungeon"]; state: GameState } {
  const definition: DungeonDefinition | undefined = registry.byId.dungeons[dungeonId];
  if (!definition) {
    throw new Error(`Unknown dungeon: ${dungeonId}`);
  }

  let rng = state.rng;
  const arcPhase = state.arcStates[definition.arcId] ?? "dungeon";
  const difficultyBase = Math.max(1, Math.floor(state.player.level / 2) + phaseOffset(arcPhase));

  const entryTemplate = registry.byId.dungeonTemplates[definition.entryTemplateId];
  const bossTemplate = registry.byId.dungeonTemplates[definition.bossTemplateId];
  const exitTemplate = registry.byId.dungeonTemplates[definition.exitTemplateId];

  const midCountRoll = rollInt(rng, 2, 5);
  rng = midCountRoll.rng;
  const midCount = midCountRoll.value;

  const nodes: Record<string, DungeonNode> = {};
  const middleNodeIds: string[] = [];

  nodes.entry = makeNode("entry", entryTemplate, Math.max(1, difficultyBase - 1));

  for (let i = 0; i < midCount; i += 1) {
    const pick = pickOne(rng, definition.middleTemplateIds);
    rng = pick.rng;
    const template = registry.byId.dungeonTemplates[pick.value];
    const id = `mid_${i + 1}`;
    nodes[id] = makeNode(id, template, difficultyBase + Math.floor(i / 2));
    middleNodeIds.push(id);
  }

  nodes.boss = makeNode("boss", bossTemplate, difficultyBase + 2);
  nodes.exit = makeNode("exit", exitTemplate, 1);

  nodes.entry.next = [middleNodeIds[0]];
  for (let i = 0; i < middleNodeIds.length - 1; i += 1) {
    nodes[middleNodeIds[i]].next = [middleNodeIds[i + 1]];
  }
  nodes[middleNodeIds[middleNodeIds.length - 1]].next = ["boss"];

  const branchRoll = rollInt(rng, 0, 1);
  rng = branchRoll.rng;
  if (branchRoll.value === 1 && middleNodeIds.length >= 3) {
    const branchFrom = middleNodeIds[0];
    const branchTo = middleNodeIds[Math.min(2, middleNodeIds.length - 1)];
    nodes[branchFrom].next = [middleNodeIds[1], branchTo];
  }

  nodes.boss.next = ["exit"];
  nodes.exit.next = [];

  const nextState = {
    ...state,
    rng,
    activeArcId: definition.arcId,
    arcStates: {
      ...state.arcStates,
      [definition.arcId]: "dungeon" as const,
    },
    activeDungeon: {
      dungeonId,
      nodes,
      currentNodeId: "entry",
      completedNodeIds: [],
      generatedAtTurn: state.time.turn,
    },
    currentScreen: "scene" as const,
    activeSceneId: undefined,
  };

  return { dungeon: nextState.activeDungeon, state: nextState };
}

export function moveToNextDungeonNode(state: GameState, nextNodeId: string): GameState {
  if (!state.activeDungeon) return state;
  return {
    ...state,
    activeDungeon: {
      ...state.activeDungeon,
      currentNodeId: nextNodeId,
    },
  };
}

export function completeCurrentDungeonNode(state: GameState): GameState {
  if (!state.activeDungeon) return state;
  const current = state.activeDungeon.currentNodeId;
  if (state.activeDungeon.completedNodeIds.includes(current)) {
    return state;
  }
  return {
    ...state,
    activeDungeon: {
      ...state.activeDungeon,
      completedNodeIds: [...state.activeDungeon.completedNodeIds, current],
    },
  };
}

export function leaveDungeon(state: GameState): GameState {
  return {
    ...state,
    activeDungeon: undefined,
    currentScreen: "atlas",
  };
}

