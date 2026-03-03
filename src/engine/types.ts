export type StatKey = "resolve" | "knowledge" | "might" | "craft";

export type Predicate =
  | { type: "minLevel"; value: number }
  | { type: "flag"; key: string; op: "==" | ">="; value: number | boolean }
  | { type: "rep"; faction: string; op: ">="; value: number }
  | { type: "hasItem"; itemId: string }
  | { type: "regionCorruption"; regionId: string; op: ">="; value: number };

export type Cost = {
  time?: number;
  mana?: number;
  hp?: number;
  corruption?: number;
};

export type RiskCheck = {
  type: "risk";
  stat: StatKey;
  difficulty: 1 | 2 | 3 | 4 | 5;
};

export type TransformCardEffect = {
  type: "transformCard";
  cardId: string;
  toStatus?: CardStatus;
  toVariant?: string;
  addTags?: string[];
  removeTags?: string[];
};

export type Effect =
  | { type: "setFlag"; key: string; value: number | boolean }
  | { type: "incFlag"; key: string; by: number }
  | { type: "addItem"; itemId: string }
  | { type: "removeItem"; itemId: string }
  | TransformCardEffect
  | { type: "startDungeon"; dungeonId: string }
  | { type: "advanceArcPhase"; arcId: string; phase: ArcPhase }
  | { type: "gainXp"; amount: number }
  | { type: "adjustRep"; faction: string; by: number }
  | { type: "log"; message: string };

export type NextTarget =
  | { type: "scene"; sceneId: string }
  | { type: "atlas" }
  | { type: "dungeon"; dungeonId: string }
  | { type: "endArc"; arcId: string; endingId: string };

export type CheckOutcome = {
  effects?: Effect[];
  next?: NextTarget;
  text?: string;
};

export type Choice = {
  id: string;
  text: string;
  requires?: Predicate[];
  cost?: Cost;
  check?: RiskCheck;
  effects?: Effect[];
  outcomes?: {
    success?: CheckOutcome;
    mixed?: CheckOutcome;
    failForward?: CheckOutcome;
  };
  next: NextTarget;
};

export type Scene = {
  id: string;
  title: string;
  cardId?: string;
  body: string[];
  tags: string[];
  onEnterEffects?: Effect[];
  choices: Choice[];
};

export type CardStatus = "hidden" | "visible" | "cleared" | "corrupted" | "occupied";

export type CardDefinition = {
  id: string;
  title: string;
  flavor: string;
  regionId: string;
  tags: string[];
  danger: number;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  entrySceneId: string;
  requires?: Predicate[];
  corruptionVariantAt?: number;
  variantId?: string;
};

export type RegionDefinition = {
  id: string;
  title: string;
  flavor: string;
  tags: string[];
};

export type ArcPhase =
  | "inactive"
  | "discovery"
  | "escalation"
  | "dungeon"
  | "climax"
  | `resolved_${string}`;

export type WorldTransform = {
  setCardStatus?: Array<{ cardId: string; status: CardStatus }>;
  adjustRegionCorruption?: Array<{ regionId: string; by: number }>;
  revealCards?: string[];
  setFlags?: Array<{ key: string; value: number | boolean }>;
};

export type ArcDefinition = {
  id: string;
  title: string;
  discoveryEntrySceneId: string;
  dungeonId: string;
  climaxSceneId: string;
  endingSceneIds: string[];
  worldTransforms: Record<string, WorldTransform>;
};

export type DungeonTemplateType = "combat" | "hazard" | "puzzle" | "rest" | "treasure" | "exit";

export type DungeonNodeTemplate = {
  id: string;
  type: DungeonTemplateType;
  title: string;
  body: string;
  stat: StatKey;
  baseDifficulty: number;
  lootTableId?: string;
};

export type DungeonDefinition = {
  id: string;
  arcId: string;
  title: string;
  entryTemplateId: string;
  bossTemplateId: string;
  exitTemplateId: string;
  middleTemplateIds: string[];
};

export type ItemRarity = "common" | "uncommon" | "rare" | "legendary";

export type ItemDefinition = {
  id: string;
  name: string;
  rarity: ItemRarity;
  tags: string[];
  lore: string;
  effects: string[];
  unique?: boolean;
};

export type AffixDefinition = {
  id: string;
  prefix?: string;
  suffix?: string;
  effectText: string;
};

export type CurseDefinition = {
  id: string;
  name: string;
  effectText: string;
};

export type LootEntry = {
  itemId: string;
  weight: number;
  minLevel?: number;
  maxLevel?: number;
  uniqueOnly?: boolean;
};

export type LootTable = {
  id: string;
  entries: LootEntry[];
};

export type EnemyDefinition = {
  id: string;
  name: string;
  danger: number;
  statBias: StatKey;
  flavor: string;
};

export type DungeonNode = {
  id: string;
  templateId: string;
  type: DungeonTemplateType;
  difficulty: number;
  next: string[];
};

export type ActiveDungeon = {
  dungeonId: string;
  nodes: Record<string, DungeonNode>;
  currentNodeId: string;
  completedNodeIds: string[];
  generatedAtTurn: number;
};

export type PlayerState = {
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  corruption: number;
  stats: Record<StatKey, number>;
  inventory: string[];
  relics: string[];
  tags: string[];
};

export type LocationState = {
  status: CardStatus;
  variant?: string;
  tags: string[];
  lastVisitedTurn?: number;
};

export type GameState = {
  version: number;
  runId: string;
  currentScreen: "title" | "atlas" | "scene" | "character" | "settings" | "endArc";
  activeSceneId?: string;
  activeCardId?: string;
  activeArcId?: string;
  activeDungeon?: ActiveDungeon;
  endingSummary?: {
    arcId: string;
    endingId: string;
    worldChanges: string[];
    statDelta: string[];
    unlockedCards: string[];
  };
  player: PlayerState;
  time: {
    turn: number;
    day: number;
  };
  flags: Record<string, number | boolean>;
  reputation: Record<string, number>;
  world: {
    regions: Record<string, { corruption: number }>;
    locations: Record<string, LocationState>;
  };
  arcStates: Record<string, ArcPhase>;
  endings: Array<{ arcId: string; endingId: string; day: number; turn: number }>;
  ngPlusTier: number;
  rng: { seed: number; step: number };
  outcomeLog: string[];
};

export type ContentRegistry = {
  regions: RegionDefinition[];
  cards: CardDefinition[];
  scenes: Scene[];
  arcs: ArcDefinition[];
  dungeons: DungeonDefinition[];
  dungeonTemplates: DungeonNodeTemplate[];
  items: ItemDefinition[];
  affixes: AffixDefinition[];
  curses: CurseDefinition[];
  lootTables: LootTable[];
  enemies: EnemyDefinition[];
  byId: {
    regions: Record<string, RegionDefinition>;
    cards: Record<string, CardDefinition>;
    scenes: Record<string, Scene>;
    arcs: Record<string, ArcDefinition>;
    dungeons: Record<string, DungeonDefinition>;
    dungeonTemplates: Record<string, DungeonNodeTemplate>;
    items: Record<string, ItemDefinition>;
    affixes: Record<string, AffixDefinition>;
    curses: Record<string, CurseDefinition>;
    lootTables: Record<string, LootTable>;
    enemies: Record<string, EnemyDefinition>;
  };
};

