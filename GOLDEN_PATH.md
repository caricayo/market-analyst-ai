# GOLDEN_PATH

This file lists deterministic end-to-end completion routes for both arcs using exact IDs.

## Arc 1: The Glass Ash Covenant I (Dawn Ledger ending)

1. Atlas card: `card_ember_hollow`
   Intent: Receive the sealed charter and start the basin crisis route.
2. Scene `ember_discovery_1` -> choice `ember_follow_courier`
   Intent: Carry the charter to Synod council for formal escalation.
3. Scene `ember_escalation_1` -> choice `ember_take_oath`
   Intent: Accept Maela's lawful escort and preserve witness legitimacy.
4. Scene `ember_escalation_2` -> choice `ember_guard_braziers`
   Intent: Hold legal formation under pressure so the route stays open.
5. Scene `ember_dungeon_gate` -> choice `ember_enter_vault`
   Intent: Breach Hollow Weirs and expose the scarcity engine.
6. Dungeon generated: `dungeon_embervault`
   Intent: Survive lock chambers and reach the core decision point.
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
   Intent: Maintain deterministic forward tempo toward climax.
8. Exit node choice: `leave_dungeon`
   Intent: Surface into the doctrine verdict scene.
9. Scene `ember_climax` -> choice `ember_choose_dawn`
   Intent: Publish relief ledgers and open water access.
10. Scene `ember_resolution_dawn` -> choice `ember_end_dawn`
    Intent: Lock the Dawn Ledger precedent in world state.
11. End arc screen appears with ending `dawn`
    Intent: Confirm Part I consequences and trigger Part II handoff.

## Arc 2: The Glass Ash Covenant II (Rain Without Permission ending)

1. Atlas card: `card_prism_step`
   Intent: Follow the receipt uprising into Mirror March.
2. Scene `astral_discovery_1` -> choice `astral_trace_song`
   Intent: Trace Open Cistern records before militias seize gates.
3. Scene `astral_escalation_1` -> choice `astral_decode`
   Intent: Draft transparent lottery terms to prevent civil fracture.
4. Scene `astral_escalation_2` -> choice `astral_bargain`
   Intent: Trade memory collateral to keep the final route viable.
5. Scene `astral_dungeon_gate` -> choice `astral_enter_well`
   Intent: Commit to Weirfall descent before coalition collapse.
6. Dungeon generated: `dungeon_starwell`
   Intent: Reach the regent seat and charter engine core.
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
   Intent: Maintain deterministic forward tempo toward arc closure.
8. Exit node choice: `leave_dungeon`
   Intent: Surface into the final governance decision.
9. Scene `astral_climax` -> choice `astral_choose_tide`
   Intent: Sign decentralized water rights for every district.
10. Scene `astral_resolution_tide` -> choice `astral_end_tide`
    Intent: Commit Rain Without Permission as canonical campaign outcome.
11. End arc screen appears with ending `tide`
    Intent: Validate complete two-arc narrative resolution.
