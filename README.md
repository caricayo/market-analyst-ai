# Mystic Atlas RPG

Text-first exploration RPG built around Environment Preview Cards. Gameplay is deterministic and content-driven (no runtime LLM choices/story generation).

## Quick Start

1. `npm install`
2. `npm run validate-content`
3. `npm run generate-card-art` (optional; placeholder cards are auto-supported)
4. `npm run dev`

## Commands

- `npm run dev` - local dev server
- `npm run build` - production build
- `npm run test:run` - run tests once
- `npm run validate-content` - validate content schemas and references
- `npm run generate-card-art` - generate missing card images

## Content Authoring

All gameplay content lives in `src/content/packs/*.json` and is validated by JSON schemas in `src/content/schemas`.

### Add A New Story Arc

1. Add arc metadata to `src/content/packs/arcs.json`.
2. Add arc scenes to `src/content/packs/scenes.json` with required contract fields.
3. Add or reuse cards in `src/content/packs/cards.json`.
4. Add dungeon definition in `src/content/packs/dungeons.json`.
5. Add any arc-only enemies/loot in `enemies.json`/`lootTables.json`/`items.json`.
6. Add `worldTransforms` for each ending in `arcs.json`.
7. Run `npm run validate-content` and tests.
8. Update `GOLDEN_PATH.md` with exact IDs.

## Determinism

- RNG is `seed + step` based and persisted in save state.
- All random systems route through `src/engine/rng.ts`.

## Save / Load

- Auto-saves after each resolved choice.
- Local storage key includes versioned payload.
- Migration stub supports future versions.

## Card Art Generation

- Without `OPENAI_API_KEY`: script creates deterministic placeholder PNGs.
- With `OPENAI_API_KEY`: script generates missing art via OpenAI Images API.
- Output folder: `public/assets/cards/`.

## Infra Notes

- Supabase, Railway, and Stripe hooks are preserved as optional integrations.
- Core single-player loop runs without external services.
