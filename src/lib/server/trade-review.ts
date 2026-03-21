import type { ManagedTrade, TradeReview } from "@/lib/trading-types";

function round(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function getResult(realizedPnlDollars: number | null): TradeReview["result"] {
  if (realizedPnlDollars === null || Math.abs(realizedPnlDollars) < 0.005) {
    return "flat";
  }

  return realizedPnlDollars > 0 ? "win" : "loss";
}

function getEntryPriceTakeaway(trade: ManagedTrade) {
  if (trade.entryPriceDollars >= 0.8) {
    return "Entry was expensive, so the remaining upside was compressed before fees.";
  }

  if (trade.entryPriceDollars <= 0.65) {
    return "Entry came in relatively cheap, which left more room for the move to pay.";
  }

  return null;
}

export function buildTradeReview(trade: ManagedTrade): TradeReview {
  const result = getResult(trade.realizedPnlDollars);
  const closedAt = trade.updatedAt || trade.createdAt;
  const peakGainDollars =
    trade.peakPriceDollars === null ? null : round(trade.peakPriceDollars - trade.entryPriceDollars, 2);
  const realizedMoveDollars =
    trade.exitPriceDollars === null ? null : round(trade.exitPriceDollars - trade.entryPriceDollars, 2);
  const targetDistanceDollars = round(trade.targetPriceDollars - trade.entryPriceDollars, 2);
  const stopDistanceDollars = round(trade.entryPriceDollars - trade.stopPriceDollars, 2);
  const capturedPeakPct =
    peakGainDollars !== null && peakGainDollars > 0 && realizedMoveDollars !== null
      ? round((realizedMoveDollars / peakGainDollars) * 100, 0)
      : null;
  const happened: string[] = [];
  const takeaways: string[] = [];

  happened.push(
    `${trade.setupType} ${trade.entryOutcome} entered at ${trade.entryPriceDollars.toFixed(2)} for ${trade.contracts} contracts with a ${targetDistanceDollars?.toFixed(2) ?? "n/a"} target move and ${stopDistanceDollars?.toFixed(2) ?? "n/a"} stop distance.`,
  );

  if (trade.peakPriceDollars !== null) {
    happened.push(
      `Best seen bid reached ${trade.peakPriceDollars.toFixed(2)}${peakGainDollars !== null ? `, or ${peakGainDollars.toFixed(2)} above entry` : ""}.`,
    );
  }

  if (trade.exitPriceDollars !== null) {
    happened.push(
      `Trade exited at ${trade.exitPriceDollars.toFixed(2)} via ${trade.exitReason ?? "unknown"} for ${trade.realizedPnlDollars === null ? "an unrecorded" : trade.realizedPnlDollars >= 0 ? "+" : ""}${trade.realizedPnlDollars?.toFixed(2) ?? "n/a"} PnL.`,
    );
  } else {
    happened.push(`Trade closed via ${trade.exitReason ?? "unknown"} without a confirmed exit fill price.`);
  }

  const entryTakeaway = getEntryPriceTakeaway(trade);
  if (entryTakeaway) {
    takeaways.push(entryTakeaway);
  }

  let summary = "Trade closed.";

  if (result === "win") {
    if (trade.exitReason === "target") {
      summary = "Winner: the move reached the planned target and paid cleanly.";
      takeaways.push("Target discipline worked; the bot took a clean winner instead of overstaying the move.");
    } else if (trade.exitReason === "stop") {
      summary = "Winner: adaptive protection locked profit before the move fully reversed.";
      takeaways.push("Adaptive stop logic protected the green trade when momentum faded.");
    } else {
      summary = "Winner: the position closed positive even without hitting the primary target.";
      takeaways.push("The trade still made money, but the exit path suggests more profit may have been available.");
    }

    if (capturedPeakPct !== null && capturedPeakPct < 60) {
      takeaways.push(`Only about ${capturedPeakPct}% of the best intratrade move was captured, so profit protection may still be too loose.`);
    } else if (capturedPeakPct !== null) {
      takeaways.push(`The exit captured about ${capturedPeakPct}% of the best move seen while the trade was open.`);
    }
  } else if (result === "loss") {
    if (trade.exitReason === "stop" && (peakGainDollars ?? 0) <= 0.02) {
      summary = "Loser: the trade never developed enough edge after entry and stopped out quickly.";
      takeaways.push("This looks like weak follow-through after entry, so the signal was either late or the tape never confirmed.");
    } else if (trade.exitReason === "stop" && (peakGainDollars ?? 0) > 0.02) {
      summary = "Loser: the trade was green first, then reversed hard enough to hit the stop.";
      takeaways.push("The setup had some follow-through, but profit protection did not tighten fast enough before the reversal.");
    } else if (trade.exitReason === "time" || trade.exitReason === "expired") {
      summary = "Loser: the trade ran out of time before the move paid.";
      takeaways.push("This trade likely needed either earlier entry or a shorter leash once time-to-close got tight.");
    } else {
      summary = "Loser: the exit path did not recover the entry cost.";
      takeaways.push("Review whether the signal quality justified the risk at the actual entry price.");
    }

    if (trade.exitReason === "stop" && trade.exitPriceDollars !== null && trade.exitPriceDollars < trade.stopPriceDollars - 0.02) {
      takeaways.push("The fill landed well through the planned stop, so fast adverse movement or thin liquidity added slippage.");
    }
  } else {
    summary = "Flat: the trade closed around breakeven.";
    takeaways.push("The setup neither failed decisively nor paid enough to matter, which points to marginal edge.");
  }

  return {
    id: trade.id,
    marketTicker: trade.marketTicker,
    marketTitle: trade.marketTitle,
    setupType: trade.setupType,
    entryOutcome: trade.entryOutcome,
    createdAt: trade.createdAt,
    closedAt,
    contracts: trade.contracts,
    entryPriceDollars: trade.entryPriceDollars,
    exitPriceDollars: trade.exitPriceDollars,
    targetPriceDollars: trade.targetPriceDollars,
    stopPriceDollars: trade.stopPriceDollars,
    peakPriceDollars: trade.peakPriceDollars,
    realizedPnlDollars: trade.realizedPnlDollars,
    exitReason: trade.exitReason,
    result,
    summary,
    happened,
    takeaways,
  };
}

export function buildTradeReviews(trades: ManagedTrade[]) {
  return trades.map(buildTradeReview);
}
