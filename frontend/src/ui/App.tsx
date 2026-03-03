import { useEffect, useMemo, useState } from "react";
import { getRegistry } from "../engine/registry";
import { createInitialState, loadGame, saveGame } from "../engine/save";
import { getDoctrineRiskModifier, getRiskTarget } from "../engine/checks";
import { canPayCost, isCardUnlocked, spendStatPoint } from "../engine/state";
import { enterCard, getCurrentScene, resolveCurrentChoice } from "../engine/story";
import { evaluateRequires } from "../engine/predicates";
import type { CardDefinition, Choice, GameState, StatKey } from "../engine/types";
import { getCampaignGuidance } from "../engine/objectives";
import { CardImage } from "./components/CardImage";

const DOCTRINE_LABELS: Array<{ key: string; label: string }> = [
  { key: "doctrine_civilian_corridors", label: "Civilian Corridors (Pilgrim-aligned logistics)" },
  { key: "doctrine_shadow_tolls", label: "Shadow Tolls (Undercourt route leverage)" },
  { key: "doctrine_open_records", label: "Open Records (public archive disclosure)" },
  { key: "doctrine_command_secrecy", label: "Command Secrecy (Concord-controlled records)" },
  { key: "doctrine_public_routes", label: "Public Routes (open navigation rights)" },
  { key: "doctrine_private_routes", label: "Private Routes (privileged convoy rights)" },
];

function statusBadge(value: string): string {
  return value.replace("_", " ").toUpperCase();
}

function formatRiskPreview(state: GameState, choice: Choice): string | null {
  if (!choice.check) return null;
  const statValue = state.player.stats[choice.check.stat];
  const policy = getDoctrineRiskModifier(state, choice.check);
  const target = getRiskTarget(state, choice.check);
  const policyText = policy === 0 ? "policy +0" : `policy ${policy > 0 ? "+" : ""}${policy}`;
  return `risk: ${choice.check.stat.toUpperCase()} ${statValue}, diff ${choice.check.difficulty}, ${policyText}, target ${target}, mixed up to ${target + 15}`;
}

export function App() {
  const registry = useMemo(() => getRegistry(), []);
  const [seedInput, setSeedInput] = useState("emberfall");
  const [state, setState] = useState<GameState>(() => loadGame(registry) ?? createInitialState("emberfall", registry));
  const [filterRegion, setFilterRegion] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [fontScale, setFontScale] = useState<number>(() => Number(localStorage.getItem("ui_font_scale") ?? 100));
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => localStorage.getItem("ui_reduced_motion") === "true");
  const [theme, setTheme] = useState<"dark" | "light">((localStorage.getItem("ui_theme") as "dark" | "light") ?? "dark");
  const [showWorldPanel, setShowWorldPanel] = useState(true);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(false);

  useEffect(() => {
    if (state.currentScreen !== "title") {
      saveGame(state);
    }
  }, [state]);

  useEffect(() => {
    localStorage.setItem("ui_font_scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem("ui_reduced_motion", String(reducedMotion));
  }, [reducedMotion]);

  useEffect(() => {
    localStorage.setItem("ui_theme", theme);
  }, [theme]);

  const currentScene = getCurrentScene(state, registry);
  const tags = Array.from(new Set(registry.cards.flatMap((card) => card.tags))).sort();
  const unspentStatPoints = Number(state.flags.stat_points ?? 0);
  const activeDoctrines = DOCTRINE_LABELS.filter((entry) => state.flags[entry.key] === true).map((entry) => entry.label);
  const guidance = getCampaignGuidance(state);
  const recommendedCardIds = new Set(guidance.recommendedCardIds);

  const cards = registry.cards.filter((card) => {
    if (filterRegion !== "all" && card.regionId !== filterRegion) return false;
    if (filterTag !== "all" && !card.tags.includes(filterTag)) return false;
    if (showRecommendedOnly && !recommendedCardIds.has(card.id)) return false;
    return true;
  }).sort((a, b) => {
    const aRecommended = recommendedCardIds.has(a.id) ? 1 : 0;
    const bRecommended = recommendedCardIds.has(b.id) ? 1 : 0;
    if (aRecommended !== bRecommended) return bRecommended - aRecommended;
    const aUnlocked = isCardUnlocked(state, registry, a.id) ? 1 : 0;
    const bUnlocked = isCardUnlocked(state, registry, b.id) ? 1 : 0;
    if (aUnlocked !== bUnlocked) return bUnlocked - aUnlocked;
    return a.title.localeCompare(b.title);
  });

  const beginNewRun = () => {
    const seed = seedInput.trim() || "emberfall";
    const fresh = createInitialState(seed, registry);
    setState({ ...fresh, currentScreen: "atlas" });
  };

  const continueRun = () => {
    const loaded = loadGame(registry);
    if (loaded) {
      setState(loaded);
    }
  };

  const handleCardSelect = (card: CardDefinition) => {
    const interactable = isCardUnlocked(state, registry, card.id);
    if (!interactable) return;
    setState((prev) => enterCard(prev, registry, card.id));
  };

  const handleChoice = (choice: Choice) => {
    setState((prev) => resolveCurrentChoice(prev, registry, choice.id));
  };

  const allocateStat = (stat: StatKey) => {
    setState((prev) => spendStatPoint(prev, stat));
  };

  const applyNgPlus = () => {
    const seed = `${seedInput || "emberfall"}-ng${state.ngPlusTier + 1}`;
    const fresh = createInitialState(seed, registry);
    setState({
      ...fresh,
      ngPlusTier: state.ngPlusTier + 1,
      player: {
        ...fresh.player,
        level: fresh.player.level + 1,
        stats: {
          resolve: fresh.player.stats.resolve + 1,
          knowledge: fresh.player.stats.knowledge + 1,
          might: fresh.player.stats.might + 1,
          craft: fresh.player.stats.craft + 1,
        },
      },
      currentScreen: "atlas",
      outcomeLog: ["New Game+ begins. The atlas remembers you."],
    });
  };

  const rootClass = `${theme === "dark" ? "theme-dark" : "theme-light"} ${reducedMotion ? "reduced-motion" : ""}`;

  return (
    <div className={rootClass} style={{ fontSize: `${fontScale}%` }}>
      <div className="fog-overlay" aria-hidden="true" />
      <header className="topbar">
        <h1>Mystic Atlas RPG</h1>
        <nav className="topnav">
          <button onClick={() => setState((prev) => prev.activeDungeon ? { ...prev, currentScreen: "scene" } : { ...prev, currentScreen: "atlas" })}>
            Atlas
          </button>
          <button onClick={() => setState((prev) => ({ ...prev, currentScreen: "character" }))}>Character</button>
          <button onClick={() => setState((prev) => ({ ...prev, currentScreen: "settings" }))}>Settings</button>
        </nav>
      </header>

      {state.currentScreen === "title" && (
        <main className="panel title-screen">
          <h2>Atlas of Drowned Embers</h2>
          <p>Choose your seed and begin a deterministic journey through living tarot-cards.</p>
          <label>
            Seed
            <input aria-label="Seed" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} />
          </label>
          <div className="row">
            <button className="primary" onClick={beginNewRun}>New Run</button>
            <button onClick={continueRun}>Continue</button>
          </div>
        </main>
      )}

      {state.currentScreen === "atlas" && (
        <main className="atlas-layout">
          <button className="mobile-world-toggle" onClick={() => setShowWorldPanel((value) => !value)}>
            {showWorldPanel ? "Hide World Panel" : "Show World Panel"}
          </button>

          <aside className={`panel world-panel ${showWorldPanel ? "" : "collapsed"}`}>
            <h2>World Panel</h2>
            <p>Day {state.time.day}, Turn {state.time.turn}</p>
            <p>Level {state.player.level} ({state.player.xp}/{state.player.xpToNext} XP)</p>
            <p>HP {state.player.hp}/{state.player.maxHp} | Mana {state.player.mana}/{state.player.maxMana}</p>
            <p>Corruption: {state.player.corruption}</p>
            <p><strong>Campaign Objective:</strong> {guidance.objective}</p>
            {state.activeDungeon && <p className="alert-line">Expedition active: finish the current dungeon route.</p>}
            <h3>Next Steps</h3>
            <ol className="step-list">
              {guidance.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <h3>Arc Status</h3>
            <ul>
              {registry.arcs.map((arc) => (
                <li key={arc.id}>{arc.title}: <strong>{statusBadge(state.arcStates[arc.id])}</strong></li>
              ))}
            </ul>
            <h3>Active Doctrines</h3>
            <ul>
              {activeDoctrines.length > 0
                ? activeDoctrines.map((entry) => <li key={entry}>{entry}</li>)
                : <li>No doctrine locked yet. Hub decisions will define campaign policy.</li>}
            </ul>
            <h3>Endings</h3>
            <p>{state.endings.length} unlocked</p>
          </aside>

          <section className="panel atlas-panel">
            <div className="filters">
              <label>
                Region
                <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
                  <option value="all">All</option>
                  {registry.regions.map((region) => (
                    <option key={region.id} value={region.id}>{region.title}</option>
                  ))}
                </select>
              </label>
              <label>
                Tag
                <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
                  <option value="all">All</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={showRecommendedOnly ? "primary" : ""}
                onClick={() => setShowRecommendedOnly((value) => !value)}
              >
                {showRecommendedOnly ? "Show All Cards" : "Focus Recommended"}
              </button>
            </div>

            <div className="card-grid">
              {cards.map((card) => {
                const unlocked = isCardUnlocked(state, registry, card.id);
                const locationState = state.world.locations[card.id];
                const variantTriggered = card.corruptionVariantAt !== undefined && (state.world.regions[card.regionId]?.corruption ?? 0) >= card.corruptionVariantAt;
                return (
                  <button
                    key={card.id}
                    className={`env-card ${unlocked ? "" : "locked"}`}
                    onClick={() => handleCardSelect(card)}
                    disabled={!unlocked}
                    aria-label={`${card.title} ${unlocked ? "available" : "locked"}`}
                  >
                    <CardImage cardId={card.id} alt={card.title} />
                    <div className="env-meta">
                      <h3>{card.title}</h3>
                      <p>{card.flavor}</p>
                      <div className="chip-row">
                        {card.tags.slice(0, 4).map((tag) => <span key={tag} className="chip">{tag}</span>)}
                        {recommendedCardIds.has(card.id) && <span className="chip chip-recommended">recommended</span>}
                      </div>
                      <p className="danger">Danger {card.danger}/5 | {card.rarity}</p>
                      <p className="status">Status: {locationState?.status ?? "hidden"}{variantTriggered ? " (Variant Shift)" : ""}</p>
                      {!unlocked && <p className="lock">Locked</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {state.currentScreen === "scene" && currentScene && (
        <main className="panel scene-panel">
          <div className="scene-header">
            <CardImage cardId={currentScene.cardId ?? "placeholder"} alt={currentScene.title} compact />
            <div>
              <h2>{currentScene.title}</h2>
              <p className="muted">{currentScene.tags.join(" | ")}</p>
              {currentScene.npcs && currentScene.npcs.length > 0 && (
                <p className="muted"><strong>Who's Here:</strong> {currentScene.npcs.join(", ")}</p>
              )}
              {currentScene.lore && (
                <p className="muted"><strong>Lore:</strong> {currentScene.lore}</p>
              )}
            </div>
          </div>

          <article>
            {currentScene.body.map((line, index) => <p key={index}>{line}</p>)}
          </article>

          <section className="choices">
            {currentScene.choices.map((choice) => {
              const meetsRequires = evaluateRequires(state, choice.requires);
              const canAfford = canPayCost(state, choice.cost);
              const ok = meetsRequires && canAfford;
              const costText = choice.cost
                ? `cost: t${choice.cost.time ?? 1} m${choice.cost.mana ?? 0} hp${choice.cost.hp ?? 0} c${choice.cost.corruption ?? 0}`
                : "cost: t1";
              const riskPreview = formatRiskPreview(state, choice);

              return (
                <button key={choice.id} disabled={!ok} onClick={() => handleChoice(choice)} className="choice">
                  <strong>{choice.text}</strong>
                  <span>{costText}</span>
                  {riskPreview && <span className="check-line">{riskPreview}</span>}
                  {!ok && <span className="hint">{!meetsRequires ? "requirements unmet" : "not enough resources"}</span>}
                </button>
              );
            })}
          </section>

          <section className="panel log-panel">
            <h3>Outcome Log</h3>
            <ul>
              {state.outcomeLog.slice(-10).map((line, idx) => <li key={`${line}-${idx}`}>{line}</li>)}
            </ul>
          </section>
        </main>
      )}

      {state.currentScreen === "character" && (
        <main className="panel">
          <h2>Inventory & Character</h2>
          <p>Level {state.player.level} | XP {state.player.xp}/{state.player.xpToNext}</p>
          <p>Stats: RES {state.player.stats.resolve}, KNO {state.player.stats.knowledge}, MGT {state.player.stats.might}, CRF {state.player.stats.craft}</p>
          <p>Stat points available: {unspentStatPoints}</p>
          <div className="stat-row">
            <button disabled={unspentStatPoints <= 0 || state.player.stats.resolve >= 10} onClick={() => allocateStat("resolve")}>+ Resolve</button>
            <button disabled={unspentStatPoints <= 0 || state.player.stats.knowledge >= 10} onClick={() => allocateStat("knowledge")}>+ Knowledge</button>
            <button disabled={unspentStatPoints <= 0 || state.player.stats.might >= 10} onClick={() => allocateStat("might")}>+ Might</button>
            <button disabled={unspentStatPoints <= 0 || state.player.stats.craft >= 10} onClick={() => allocateStat("craft")}>+ Craft</button>
          </div>
          <p>Corruption {state.player.corruption} | Rep (Pilgrims {state.reputation.pilgrims}, Concord {state.reputation.concord}, Undercourt {state.reputation.undercourt})</p>
          <div className="inventory-grid">
            {state.player.inventory.map((itemId) => {
              const item = registry.byId.items[itemId];
              if (!item) return null;
              return (
                <article key={item.id} className="inventory-item">
                  <h3>{item.name}</h3>
                  <p className="muted">{item.rarity}</p>
                  <p>{item.lore}</p>
                  <ul>
                    {item.effects.map((effect) => <li key={effect}>{effect}</li>)}
                  </ul>
                </article>
              );
            })}
            {state.player.inventory.length === 0 && <p>No items yet. Explore cards and dungeons.</p>}
          </div>
        </main>
      )}

      {state.currentScreen === "settings" && (
        <main className="panel">
          <h2>Settings</h2>
          <label>
            Font scale ({fontScale}%)
            <input type="range" min={85} max={130} value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} />
          </label>
          <label>
            <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
            Reduced motion
          </label>
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
              <option value="dark">Dark parchment</option>
              <option value="light">Light parchment</option>
            </select>
          </label>
          <div className="row">
            <button onClick={() => setState((prev) => ({ ...prev, currentScreen: "atlas" }))}>Back</button>
            <button onClick={() => setState((prev) => ({ ...createInitialState(seedInput, registry), currentScreen: "title" }))}>Reset Run</button>
          </div>
        </main>
      )}

      {state.currentScreen === "endArc" && state.endingSummary && (
        <main className="panel">
          <h2>Arc Resolved: {state.endingSummary.arcId}</h2>
          <p>Ending: <strong>{state.endingSummary.endingId}</strong></p>
          <h3>World Changes</h3>
          <ul>{state.endingSummary.worldChanges.map((line) => <li key={line}>{line}</li>)}</ul>
          <h3>Unlocked Cards</h3>
          <ul>
            {state.endingSummary.unlockedCards.length > 0
              ? state.endingSummary.unlockedCards.map((line) => <li key={line}>{line}</li>)
              : <li>No newly revealed cards.</li>}
          </ul>
          <h3>Stat Delta</h3>
          <ul>{state.endingSummary.statDelta.map((line) => <li key={line}>{line}</li>)}</ul>
          <div className="row">
            <button onClick={() => setState((prev) => ({ ...prev, currentScreen: "atlas", endingSummary: undefined }))}>Continue</button>
            <button className="primary" onClick={applyNgPlus}>New Game+</button>
          </div>
        </main>
      )}
    </div>
  );
}
