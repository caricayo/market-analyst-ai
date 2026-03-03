# GOLDEN_PATH

This file lists deterministic end-to-end completion routes for both arcs using exact IDs.

## Arc 1: The Ember Crown (Dawn ending)

1. Atlas card: `card_ember_hollow`
   Intent: Respond immediately to the first Fracture Choir knot in Gloamreach.
2. Scene `ember_discovery_1` -> choice `ember_follow_courier`
   Intent: Align with formal containment leadership at Thorn Bastion.
3. Scene `ember_escalation_1` -> choice `ember_take_oath`
   Intent: Commit to a disciplined Crownfire recovery doctrine.
4. Scene `ember_escalation_2` -> choice `ember_guard_braziers`
   Intent: Preserve the stabilizing ritual during escalation.
5. Scene `ember_dungeon_gate` -> choice `ember_enter_vault`
   Intent: Cut the crisis source before regional wards collapse.
6. Dungeon generated: `dungeon_embervault`
   Intent: Survive the pressure tunnel and secure access to the Regent chamber.
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
   Intent: Push steady progress over detours to reach climax quickly.
8. Exit node choice: `leave_dungeon`
   Intent: Surface and immediately deliver final policy verdict.
9. Scene `ember_climax` -> choice `ember_choose_dawn`
   Intent: Disperse power to reduce authoritarian capture risk.
10. Scene `ember_resolution_dawn` -> choice `ember_end_dawn`
    Intent: Lock the “Dawn Mercy” settlement in world state.
11. End arc screen appears with ending `dawn`
    Intent: Confirm region-wide consequences and unlock onward pressure.

## Arc 2: The Astral Well (Tide ending)

1. Atlas card: `card_prism_step`
   Intent: Pursue the second crisis knot linked to Ember outcomes.
2. Scene `astral_discovery_1` -> choice `astral_trace_song`
   Intent: Track the Wellsong source before rivals consolidate passage.
3. Scene `astral_escalation_1` -> choice `astral_decode`
   Intent: Secure a stable approach map via disciplined analysis.
4. Scene `astral_escalation_2` -> choice `astral_bargain`
   Intent: Trade short-term autonomy for speed under mounting pressure.
5. Scene `astral_dungeon_gate` -> choice `astral_enter_well`
   Intent: Commit to decisive descent before sky-lane drift worsens.
6. Dungeon generated: `dungeon_starwell`
   Intent: Penetrate the Well route and reach Seraph adjudication.
7. For each dungeon node scene, choose `attempt` then `advance_main` until `exit`
   Intent: Maintain deterministic forward tempo toward arc closure.
8. Exit node choice: `leave_dungeon`
   Intent: Surface for final cross-faction sky policy decision.
9. Scene `astral_climax` -> choice `astral_choose_tide`
   Intent: Favor shared stability over coercive control.
10. Scene `astral_resolution_tide` -> choice `astral_end_tide`
    Intent: Commit the Tide Accord as canonical campaign outcome.
11. End arc screen appears with ending `tide`
    Intent: Validate complete two-arc narrative resolution.

