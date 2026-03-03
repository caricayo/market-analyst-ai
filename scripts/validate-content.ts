import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type JsonValue = Record<string, unknown> | Array<unknown>;

const root = process.cwd();
const schemaDir = path.join(root, "src", "content", "schemas");
const packsDir = path.join(root, "src", "content", "packs");
const assetsDir = path.join(root, "public", "assets", "cards");

const targets = [
  ["regions.schema.json", "regions.json"],
  ["cards.schema.json", "cards.json"],
  ["arcs.schema.json", "arcs.json"],
  ["scenes.schema.json", "scenes.json"],
  ["encounters.schema.json", "dungeons.json"],
  ["enemies.schema.json", "enemies.json"],
  ["lootTables.schema.json", "lootTables.json"],
  ["items.schema.json", "items.json"],
  ["affixes.schema.json", "affixes.json"],
  ["qualities.schema.json", "qualities.json"],
] as const;

function loadJson(filePath: string): JsonValue {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const errors: string[] = [];

for (const [schemaFile, dataFile] of targets) {
  const schema = loadJson(path.join(schemaDir, schemaFile));
  const data = loadJson(path.join(packsDir, dataFile));
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    for (const issue of validate.errors ?? []) {
      errors.push(`${dataFile}: ${issue.instancePath} ${issue.message ?? "schema violation"}`);
    }
  }
}

const cards = loadJson(path.join(packsDir, "cards.json")) as Array<any>;
const regions = loadJson(path.join(packsDir, "regions.json")) as Array<any>;
const scenes = loadJson(path.join(packsDir, "scenes.json")) as Array<any>;
const arcs = loadJson(path.join(packsDir, "arcs.json")) as Array<any>;
const dungeons = loadJson(path.join(packsDir, "dungeons.json")) as Array<any>;
const templates = loadJson(path.join(packsDir, "dungeonTemplates.json")) as Array<any>;
const items = loadJson(path.join(packsDir, "items.json")) as Array<any>;
const qualities = loadJson(path.join(packsDir, "qualities.json")) as Array<any>;

const sceneIds = new Set(scenes.map((x) => x.id));
const cardIds = new Set(cards.map((x) => x.id));
const regionIds = new Set(regions.map((x) => x.id));
const arcIds = new Set(arcs.map((x) => x.id));
const dungeonIds = new Set(dungeons.map((x) => x.id));
const templateIds = new Set(templates.map((x) => x.id));
const itemIds = new Set(items.map((x) => x.id));
const qualityKeys = new Set(qualities.map((x) => x.key));

for (const card of cards) {
  if (!regionIds.has(card.regionId)) {
    errors.push(`cards.json: card ${card.id} references unknown region ${card.regionId}`);
  }
  if (!sceneIds.has(card.entrySceneId)) {
    errors.push(`cards.json: card ${card.id} references missing scene ${card.entrySceneId}`);
  }
  const imagePath = path.join(assetsDir, `${card.id}.png`);
  if (!fs.existsSync(imagePath)) {
    errors.push(`assets: missing card image ${card.id}.png`);
  }
}

for (const scene of scenes) {
  for (const choice of scene.choices ?? []) {
    const next = choice.next;
    if (!next || typeof next.type !== "string") {
      errors.push(`scenes.json: ${scene.id}/${choice.id} missing next target`);
      continue;
    }

    if (next.type === "scene" && !sceneIds.has(next.sceneId)) {
      errors.push(`scenes.json: ${scene.id}/${choice.id} next scene missing: ${next.sceneId}`);
    }
    if (next.type === "dungeon" && !dungeonIds.has(next.dungeonId)) {
      errors.push(`scenes.json: ${scene.id}/${choice.id} next dungeon missing: ${next.dungeonId}`);
    }
    if (next.type === "endArc" && !arcIds.has(next.arcId)) {
      errors.push(`scenes.json: ${scene.id}/${choice.id} next arc missing: ${next.arcId}`);
    }

    for (const requirement of choice.requires ?? []) {
      if (requirement.type === "minLevel" && requirement.value > 50) {
        errors.push(`scenes.json: ${scene.id}/${choice.id} impossible minLevel ${requirement.value}`);
      }
      if (requirement.type === "flag" && !qualityKeys.has(requirement.key)) {
        errors.push(`scenes.json: ${scene.id}/${choice.id} references unknown flag ${requirement.key}`);
      }
      if (requirement.type === "hasItem" && !itemIds.has(requirement.itemId)) {
        errors.push(`scenes.json: ${scene.id}/${choice.id} requires unknown item ${requirement.itemId}`);
      }
      if (requirement.type === "regionCorruption" && requirement.value > 100) {
        errors.push(`scenes.json: ${scene.id}/${choice.id} impossible corruption threshold ${requirement.value}`);
      }
    }
  }
}

for (const arc of arcs) {
  if (!sceneIds.has(arc.discoveryEntrySceneId)) {
    errors.push(`arcs.json: ${arc.id} missing discovery scene ${arc.discoveryEntrySceneId}`);
  }
  if (!sceneIds.has(arc.climaxSceneId)) {
    errors.push(`arcs.json: ${arc.id} missing climax scene ${arc.climaxSceneId}`);
  }
  if (!dungeonIds.has(arc.dungeonId)) {
    errors.push(`arcs.json: ${arc.id} missing dungeon ${arc.dungeonId}`);
  }
  if (!Array.isArray(arc.endingSceneIds) || arc.endingSceneIds.length < 2 || arc.endingSceneIds.length > 3) {
    errors.push(`arcs.json: ${arc.id} must declare 2-3 endingSceneIds`);
  }
  for (const sceneId of arc.endingSceneIds ?? []) {
    if (!sceneIds.has(sceneId)) {
      errors.push(`arcs.json: ${arc.id} missing ending scene ${sceneId}`);
    }
  }
}

for (const dungeon of dungeons) {
  if (!arcIds.has(dungeon.arcId)) {
    errors.push(`dungeons.json: ${dungeon.id} unknown arcId ${dungeon.arcId}`);
  }
  const ids = [dungeon.entryTemplateId, dungeon.bossTemplateId, dungeon.exitTemplateId, ...(dungeon.middleTemplateIds ?? [])];
  for (const templateId of ids) {
    if (!templateIds.has(templateId)) {
      errors.push(`dungeons.json: ${dungeon.id} unknown template ${templateId}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Content validation failed:\n");
  for (const issue of errors) {
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log("Content validation passed.");

