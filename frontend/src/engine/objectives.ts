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
        objective: "Answer the sealed charter summons and begin the basin crisis.",
        steps: [
          "Travel to Salt Gate Permit Hall and accept the charter case.",
          "Report to Synod Council Hall with the witness route.",
          "Choose process or defiance before Hollow Weirs opens.",
        ],
        recommendedCardIds: ["card_ember_hollow", "card_cinder_market"],
      };
    }

    if (ember === "discovery") {
      return {
        objective: "Set early doctrine for the ash charter escalation.",
        steps: [
          "Use Debt Gate Market or High Reader Archive for leverage.",
          "Commit to a witness strategy at Synod Council Hall.",
          "Prepare your approach to Hollow Weirs Gate.",
        ],
        recommendedCardIds: ["card_thorn_bastion", "card_cinder_market", "card_root_archive"],
      };
    }

    if (ember === "escalation") {
      return {
        objective: "Stabilize the route and breach the scarcity engine.",
        steps: [
          "Secure your chosen line into Hollow Weirs.",
          "Decide whether to delay for safety or push now.",
          "Enter the Hollow Weirs Infiltration dungeon.",
        ],
        recommendedCardIds: ["card_ashen_gate", "card_mire_bridge", "card_cinder_market"],
      };
    }

    if (ember === "dungeon") {
      return {
        objective: "Complete the weirs expedition and deliver the Part I verdict.",
        steps: [
          "Resolve dungeon chambers and preserve party resources.",
          "Exit into the Charter of Ash climax scene.",
          "Choose your Dawn, Ash, or Compact resolution.",
        ],
        recommendedCardIds: ["card_ashen_gate"],
      };
    }

    return {
      objective: "Deliver your final Glass Ash Covenant Part I ruling.",
      steps: [
        "Weigh relief transparency, regency control, or compact governance.",
        "Commit to one ending and record doctrine shift.",
        "Review post-arc world changes in the atlas.",
      ],
      recommendedCardIds: ["card_ember_hollow"],
    };
  }

  if (!astralResolved) {
    if (astral === "inactive") {
      return {
        objective: "Follow the receipt uprising into Glasswaste and open Covenant Part II.",
        steps: [
          "Use the Part I aftermath lead toward Mirror March.",
          "Reach Mirror March Front and commit to intervention.",
          "Advance to Open Cistern Records for escalation.",
        ],
        recommendedCardIds: ["card_ember_hollow", "card_prism_step"],
      };
    }

    if (astral === "discovery") {
      return {
        objective: "Secure a lawful route to Weirfall before militias fracture the basin.",
        steps: [
          "Decode Open Cistern records.",
          "Use Witness Basin and Floodline Forge to shape support.",
          "Advance through Glass Court to the final approach.",
        ],
        recommendedCardIds: ["card_sunken_orrery", "card_mirror_lake", "card_shard_forge"],
      };
    }

    if (astral === "escalation") {
      return {
        objective: "Open the Charter Engine Core route and commit to final intervention.",
        steps: [
          "Settle terms at Glass Court.",
          "Enter Charter Engine Core at peak readiness.",
          "Prepare for the regent seat climax.",
        ],
        recommendedCardIds: ["card_eclipse_court", "card_starwell_rim"],
      };
    }

    if (astral === "dungeon") {
      return {
        objective: "Clear the engine descent and deliver the final basin ruling.",
        steps: [
          "Resolve all core chambers.",
          "Exit into The Regent Seat climax.",
          "Select your ending doctrine.",
        ],
        recommendedCardIds: ["card_starwell_rim"],
      };
    }

    return {
      objective: "Complete the final Glass Ash Covenant judgment.",
      steps: [
        "Choose Rain, Veil, or Chorus resolution.",
        "Confirm ending and world transform.",
        "Review campaign closure and unlocked routes.",
      ],
      recommendedCardIds: ["card_prism_step"],
    };
  }

  return {
    objective: "Campaign complete. Explore aftermath loops or start New Game+ with a new doctrine.",
    steps: [
      "Review both ending summaries and world changes.",
      "Experiment with alternate doctrine paths.",
      "Start NG+ for harder seeded runs.",
    ],
    recommendedCardIds: ["card_ember_hollow", "card_prism_step"],
  };
}
