# MMO Text-Game Design Report (March 3, 2026)

## 1) Research Goal
Build a stronger MMO-like text RPG loop: coherent campaign flow, connected locations, meaningful consequences, and less "disconnected card vignette" feeling.

## 2) Research Findings (with sources)
1. **Different players seek different fun vectors (achievement, social, exploration, dominance).**  
   Source: Bartle taxonomy for MUDs.  
   https://mud.co.uk/richard/hcds.htm
2. **Strong games align mechanics -> dynamics -> player aesthetics.**  
   Source: MDA framework.  
   https://users.cs.northwestern.edu/~hunicke/MDA.pdf
3. **Online game motivation clusters consistently include Achievement, Social, and Immersion factors.**  
   Source: Yee (DiGRA).  
   https://www.digra.org/wp-content/uploads/digital-library/06276.41516.pdf
4. **Autonomy, competence, and relatedness increase motivation and enjoyment in games.**  
   Source: Ryan, Rigby, Przybylski (SDT in video games).  
   https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MotivationPullVGames.pdf
5. **Fail-forward resolution keeps momentum while preserving stakes (success / partial / fail with consequence).**  
   Source: Blades in the Dark action roll model.  
   https://bladesinthedark.com/action-roll
6. **Storylets/quality-based narrative reduce branch explosion and support recombination.**  
   Source: Emily Short on storylets.  
   https://emshort.blog/2019/11/29/storylets-you-want-them/
7. **New player onboarding in text MMOs works best with explicit guided next actions.**  
   Sources: Achaea help/new player guidance, Aardwolf newbie guide.  
   https://www.achaea.com/game-help/  
   https://www.aardwolf.com/wiki/index.php/Help_NewbieGuide
8. **Too many options can reduce decision quality and commitment when not structured.**  
   Sources: choice overload literature summaries/reviews.  
   https://www.cmu.edu/dietrich/sds/docs/loewenstein/What,sChoosing.pdf  
   https://pubmed.ncbi.nlm.nih.gov/26169626/

## 3) Current Game Audit (before this pass)
- Content size: `12` cards, `35` scenes, `2` arcs, `2` dungeons.
- Average choices per scene: `1.89` (many scenes are short, 1-2 decisions).
- New-run atlas had multiple available fronts early, which could feel like parallel vignettes.
- Arc 2 gating was improved, but in-run direction still needed stronger "what next and why".
- Consequences were visible in text, but doctrine impacts were mostly narrative rather than mechanical.

## 4) Gap Analysis vs Research
- **Onboarding/breadcrumbs gap:** needed persistent step-by-step guidance (Achaea/Aardwolf pattern).
- **Choice-load gap:** needed focus mode and recommendation sorting to reduce early overwhelm.
- **Consequence-mechanics gap:** doctrine choices should alter probability math, not only lore text.
- **Continuity gap:** cards should feel like one campaign path, not unrelated snippets.

## 5) Implemented Changes (this pass)
1. **Campaign Guidance Engine**
   - Added deterministic guidance (`objective + 3 steps + recommended card IDs`) by arc phase.
   - File: `src/engine/objectives.ts`.
2. **Atlas Focus + Recommendation UX**
   - Added `Focus Recommended` toggle.
   - Recommended cards are sorted first and tagged with a visible badge.
   - World Panel now includes explicit **Next Steps** checklist.
   - File: `src/ui/App.tsx`, `src/ui/styles.css`.
3. **Doctrine -> Mechanics Link**
   - Added doctrine-based risk modifiers on top of locked risk constants.
   - Risk preview now shows policy modifier contribution.
   - File: `src/engine/checks.ts`, `src/ui/App.tsx`.
4. **Stronger Arc-1 Continuity/Gating**
   - Root Archive and Mire Bridge now unlock after Ember discovery.
   - Discovery choice now reveals those cards plus Thorn Bastion.
   - Ashen Gate is explicitly set visible on dungeon-gate entry.
   - File: `src/content/packs/cards.json`, `src/content/packs/scenes.json`.
5. **Narrative Cohesion Prior Work Integrated**
   - Post-arc entry scene routing, reduced repetitive Ember branching, and one-time delay handling remain in place from the preceding pass.

## 6) Validation
- `npm run validate-content` passes.
- `npm run test:run` passes (expanded test suite).
- `npm run build` passes.

## 7) Remaining High-Value Backlog
1. Add relationship clocks for named NPCs (not just faction rep).
2. Add multi-step quest chains per hub card (3-5 stateful variants per card).
3. Add async social simulation layer (faction moves between turns) to better mimic MMO world persistence.
4. Expand scene length/texture for key arc beats (currently many scenes remain concise).
