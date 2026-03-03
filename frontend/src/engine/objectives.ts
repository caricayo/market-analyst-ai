import type { GameState } from "./types";

export type CampaignGuidance = {
  objective: string;
  steps: string[];
  recommendedCardIds: string[];
};

function resolved(phase: string | undefined): boolean {
  return typeof phase === "string" && phase.startsWith("resolved_");
}

export function getCampaignGuidance(state: GameState): CampaignGuidance {
  const ember = state.arcStates.arc_ember_crown;
  const astral = state.arcStates.arc_astral_well;
  const emberResolved = resolved(ember);
  const astralResolved = resolved(astral);

  if (!emberResolved) {
    if (ember === "inactive") {
      return {
        objective: "Answer the ash-sigil summons and discover the Ember Crown crisis.",
        steps: [
          "Travel to Ember Hollow and accept the summons.",
          "Report findings to Thorn Bastion.",
          "Choose a response doctrine before breaching Ashen Gate.",
        ],
        recommendedCardIds: ["card_ember_hollow", "card_cinder_market"],
      };
    }

    if (ember === "discovery") {
      return {
        objective: "Set the Crownfire response leadership before the crisis escalates.",
        steps: [
          "Use Cinder Market or Root Archive to gather leverage.",
          "Commit to a command style at Thorn Bastion.",
          "Prepare the Ashen Gate approach route.",
        ],
        recommendedCardIds: ["card_thorn_bastion", "card_cinder_market", "card_root_archive"],
      };
    }

    if (ember === "escalation") {
      return {
        objective: "Stabilize the approach and breach the Embervault.",
        steps: [
          "Secure your chosen route to Ashen Gate.",
          "Decide whether to delay for civilians or breach immediately.",
          "Enter the Embervault dungeon.",
        ],
        recommendedCardIds: ["card_ashen_gate", "card_mire_bridge", "card_cinder_market"],
      };
    }

    if (ember === "dungeon") {
      return {
        objective: "Complete the Embervault expedition and reach the Crownfire verdict.",
        steps: [
          "Resolve dungeon chambers and survive attrition.",
          "Exit the dungeon into the climax scene.",
          "Choose the region-defining Ember resolution.",
        ],
        recommendedCardIds: ["card_ashen_gate"],
      };
    }

    return {
      objective: "Deliver a final Ember Crown ruling.",
      steps: [
        "Weigh civilian relief, command control, or treaty restraint.",
        "Commit to one ending and record the doctrine shift.",
        "Review post-arc world changes in the atlas.",
      ],
      recommendedCardIds: ["card_ember_hollow"],
    };
  }

  if (!astralResolved) {
    if (astral === "inactive") {
      return {
        objective: "Follow the second harmonic into the Glasswaste and discover the Wellsong knot.",
        steps: [
          "Return to Ember Hollow aftermath and take the Steppe lead.",
          "Reach Prism Steppe and commit to investigation.",
          "Move to Sunken Orrery for escalation.",
        ],
        recommendedCardIds: ["card_ember_hollow", "card_prism_step"],
      };
    }

    if (astral === "discovery") {
      return {
        objective: "Secure a route to Starwell before rival factions seize the sky-knot.",
        steps: [
          "Decode the Orrery route logic.",
          "Use Mirror Lake / Shard Forge to shape doctrine support.",
          "Advance to Eclipse Court and Starwell approach.",
        ],
        recommendedCardIds: ["card_sunken_orrery", "card_mirror_lake", "card_shard_forge"],
      };
    }

    if (astral === "escalation") {
      return {
        objective: "Open Starwell Rim and commit to final intervention.",
        steps: [
          "Settle faction terms at Eclipse Court.",
          "Enter Starwell Rim at peak readiness.",
          "Prepare for the sky-knot climax.",
        ],
        recommendedCardIds: ["card_eclipse_court", "card_starwell_rim"],
      };
    }

    if (astral === "dungeon") {
      return {
        objective: "Clear the Starwell dungeon and deliver the final cosmic ruling.",
        steps: [
          "Resolve all Starwell chambers.",
          "Exit to the Wellsong climax.",
          "Select one of the end-state doctrines.",
        ],
        recommendedCardIds: ["card_starwell_rim"],
      };
    }

    return {
      objective: "Complete the final Astral judgment.",
      steps: [
        "Choose Tide, Shroud, or Union resolution.",
        "Confirm ending and world transform.",
        "Review campaign closure and unlocked endings.",
      ],
      recommendedCardIds: ["card_prism_step"],
    };
  }

  return {
    objective: "Campaign complete. Explore aftermath loops or start New Game+ with a new doctrine strategy.",
    steps: [
      "Review both ending summaries and world changes.",
      "Experiment with alternate doctrine paths.",
      "Start NG+ for harder seeded runs.",
    ],
    recommendedCardIds: ["card_ember_hollow", "card_prism_step"],
  };
}
