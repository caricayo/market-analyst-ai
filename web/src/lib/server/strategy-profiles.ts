import { tradingConfig } from "@/lib/server/trading-config";

export type StrategyProfile = {
  slug: string;
  name: string;
  isChampion: boolean;
  allowReversal: boolean;
  blockHighRiskOpen: boolean;
  blockCloseWindow: boolean;
  trendEdgeThreshold: number;
  trendConfidenceThreshold: number;
  scalpPrimaryDistanceFloor: number;
  scalpPrimaryAtrMultiplier: number;
  scalpLateDistanceFloor: number;
  scalpLateAtrMultiplier: number;
  scalpConfidenceThreshold: number;
  scalpLateConfidenceThreshold: number;
  reversalPrimaryDistanceFloor: number;
  reversalPrimaryAtrMultiplier: number;
  reversalLateDistanceFloor: number;
  reversalLateAtrMultiplier: number;
  reversalConfidenceThreshold: number;
  reversalLateConfidenceThreshold: number;
};

export function getChampionStrategyProfile(): StrategyProfile {
  return {
    slug: "champion-live",
    name: "Champion Live",
    isChampion: true,
    allowReversal: true,
    blockHighRiskOpen: true,
    blockCloseWindow: true,
    trendEdgeThreshold: 0.6,
    trendConfidenceThreshold: 68,
    scalpPrimaryDistanceFloor: 35,
    scalpPrimaryAtrMultiplier: 0.9,
    scalpLateDistanceFloor: 65,
    scalpLateAtrMultiplier: 1.2,
    scalpConfidenceThreshold: 64,
    scalpLateConfidenceThreshold: 72,
    reversalPrimaryDistanceFloor: tradingConfig.reversalPrimaryDistanceFloor,
    reversalPrimaryAtrMultiplier: tradingConfig.reversalPrimaryAtrMultiplier,
    reversalLateDistanceFloor: tradingConfig.reversalLateDistanceFloor,
    reversalLateAtrMultiplier: tradingConfig.reversalLateAtrMultiplier,
    reversalConfidenceThreshold: 66,
    reversalLateConfidenceThreshold: 70,
  };
}

export function getResearchStrategyProfiles(): StrategyProfile[] {
  const champion = getChampionStrategyProfile();

  return [
    champion,
    {
      ...champion,
      slug: "legacy-dual-playbook",
      name: "Legacy Dual Playbook",
      isChampion: false,
      allowReversal: false,
      scalpPrimaryDistanceFloor: 45,
      scalpLateDistanceFloor: 65,
    },
    {
      ...champion,
      slug: "loose-dual-playbook",
      name: "Loose Dual Playbook",
      isChampion: false,
      allowReversal: false,
      scalpPrimaryDistanceFloor: 35,
      scalpLateDistanceFloor: 65,
    },
    {
      ...champion,
      slug: "conservative-trend-core",
      name: "Conservative Trend Core",
      isChampion: false,
      allowReversal: false,
      trendEdgeThreshold: 0.7,
      trendConfidenceThreshold: 72,
      scalpPrimaryDistanceFloor: 45,
      scalpLateDistanceFloor: 75,
      scalpLateConfidenceThreshold: 76,
    },
  ];
}
