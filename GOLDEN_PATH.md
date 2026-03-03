# GOLDEN_PATH

This file lists deterministic end-to-end completion routes for both arcs using exact IDs.

## Arc 1: The Ember Crown (Dawn ending)

1. Atlas card: `card_ember_hollow`
2. Scene `ember_discovery_1` -> choice `ember_follow_courier`
3. Scene `ember_escalation_1` -> choice `ember_take_oath`
4. Scene `ember_escalation_2` -> choice `ember_guard_braziers`
5. Scene `ember_dungeon_gate` -> choice `ember_enter_vault`
6. Dungeon generated: `dungeon_embervault`
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
8. Exit node choice: `leave_dungeon`
9. Scene `ember_climax` -> choice `ember_choose_dawn`
10. Scene `ember_resolution_dawn` -> choice `ember_end_dawn`
11. End arc screen appears with ending `dawn`

## Arc 2: The Astral Well (Tide ending)

1. Atlas card: `card_prism_step`
2. Scene `astral_discovery_1` -> choice `astral_trace_song`
3. Scene `astral_escalation_1` -> choice `astral_decode`
4. Scene `astral_escalation_2` -> choice `astral_bargain`
5. Scene `astral_dungeon_gate` -> choice `astral_enter_well`
6. Dungeon generated: `dungeon_starwell`
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
8. Exit node choice: `leave_dungeon`
9. Scene `astral_climax` -> choice `astral_choose_tide`
10. Scene `astral_resolution_tide` -> choice `astral_end_tide`
11. End arc screen appears with ending `tide`
