import type { SetupType } from "@/lib/trading-types";

export type ConfidenceBand = "low" | "mid" | "high";

export type TierExecutionPlan = {
  entryTierDollars: number;
  targetTierDollars: number;
  stopTierDollars: number | null;
  confidenceBand: ConfidenceBand;
};

const ENTRY_TIERS = [0.6, 0.65, 0.7, 0.8] as const;
const ALL_TIERS = [0.6, 0.65, 0.7, 0.8, 0.9] as const;
const ENTRY_TIER_TOLERANCE_DOLLARS = 0.01;

export function isTierManagedSetup(setupType: SetupType) {
  return setupType === "trend" || setupType === "scalp";
}

export function getTierConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 85) {
    return "high";
  }

  if (confidence >= 70) {
    return "mid";
  }

  return "low";
}

export function getEligibleEntryTier(entryPriceDollars: number) {
  return (
    ENTRY_TIERS.find((tier) => Math.abs(entryPriceDollars - tier) <= ENTRY_TIER_TOLERANCE_DOLLARS + 0.0001) ?? null
  );
}

function getMappedTargetTier(entryTierDollars: number, confidenceBand: ConfidenceBand) {
  if (confidenceBand === "low") {
    return (
      {
        0.6: 0.65,
        0.65: 0.7,
        0.7: 0.8,
        0.8: 0.9,
      } as const
    )[entryTierDollars as 0.6 | 0.65 | 0.7 | 0.8];
  }

  if (confidenceBand === "mid") {
    return (
      {
        0.6: 0.7,
        0.65: 0.8,
        0.7: 0.9,
        0.8: 0.9,
      } as const
    )[entryTierDollars as 0.6 | 0.65 | 0.7 | 0.8];
  }

  return (
    {
      0.6: 0.8,
      0.65: 0.9,
      0.7: 0.9,
      0.8: 0.9,
    } as const
  )[entryTierDollars as 0.6 | 0.65 | 0.7 | 0.8];
}

export function buildTierExecutionPlan(setupType: SetupType, entryPriceDollars: number, confidence: number) {
  if (!isTierManagedSetup(setupType)) {
    return null;
  }

  const entryTierDollars = getEligibleEntryTier(entryPriceDollars);
  if (entryTierDollars === null) {
    return null;
  }

  const confidenceBand = getTierConfidenceBand(confidence);
  return {
    entryTierDollars,
    targetTierDollars: getMappedTargetTier(entryTierDollars, confidenceBand),
    stopTierDollars: null,
    confidenceBand,
  } satisfies TierExecutionPlan;
}

export function buildRecoveredTierExecutionPlan(setupType: SetupType, entryPriceDollars: number) {
  if (!isTierManagedSetup(setupType)) {
    return null;
  }

  const entryTierDollars =
    getEligibleEntryTier(entryPriceDollars) ??
    ENTRY_TIERS.reduce((closest, tier) =>
      Math.abs(tier - entryPriceDollars) < Math.abs(closest - entryPriceDollars) ? tier : closest,
    );

  return {
    entryTierDollars,
    targetTierDollars: (
      {
        0.6: 0.65,
        0.65: 0.7,
        0.7: 0.8,
        0.8: 0.9,
      } as const
    )[entryTierDollars as 0.6 | 0.65 | 0.7 | 0.8],
    stopTierDollars: null,
    confidenceBand: "low",
  } satisfies TierExecutionPlan;
}

export function getTieredStopFloor(
  entryTierDollars: number | null,
  targetTierDollars: number | null,
  peakPriceDollars: number,
) {
  if (entryTierDollars === null || targetTierDollars === null) {
    return null;
  }

  let stopTierDollars: number | null = null;
  for (let index = 1; index < ALL_TIERS.length; index += 1) {
    const tier = ALL_TIERS[index];
    const previousTier = ALL_TIERS[index - 1];

    if (tier <= entryTierDollars || tier > targetTierDollars) {
      continue;
    }

    if (peakPriceDollars + 0.0001 >= tier) {
      stopTierDollars = previousTier;
    }
  }

  return stopTierDollars;
}

export function describeTierTrigger(entryPriceDollars: number) {
  return `allowed tiers 0.60 / 0.65 / 0.70 / 0.80 with +/-${ENTRY_TIER_TOLERANCE_DOLLARS.toFixed(2)} tolerance; current ask was ${entryPriceDollars.toFixed(2)}.`;
}
