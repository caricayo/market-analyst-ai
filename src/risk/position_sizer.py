"""
src/risk/position_sizer.py — Tiered position sizing with ATR volatility scaling.

Confidence tiers:
  55–62% → 8%  of portfolio
  62–68% → 12% of portfolio
  68%+   → 15% of portfolio

Volatility scalar reduces size further when ATR/price is high.
Result is always capped to the tier ceiling.
"""

import math
from loguru import logger

import config


def tiered_position_pct(confidence: float) -> float:
    """
    Return position size as a fraction of portfolio based on confidence tier.
    55–62% → 8% | 62–68% → 12% | 68%+ → 15%
    """
    if confidence >= 0.68:
        return 0.15
    elif confidence >= 0.62:
        return 0.12
    else:
        return 0.08


def confidence_scalar(model_confidence: float) -> float:
    """
    (Legacy helper, kept for reference.)
    Scale position size based on model confidence.
    60% confidence → 0.5x; 80% → 1.0x; 95%+ → 1.2x (capped)
    """
    c = max(config.MIN_MODEL_CONFIDENCE, min(1.0, model_confidence))
    scalar = (c - config.MIN_MODEL_CONFIDENCE) / (1.0 - config.MIN_MODEL_CONFIDENCE) * 1.0 + 0.5
    return round(min(1.2, scalar), 4)


def volatility_scalar(atr: float, price: float) -> float:
    """
    Reduce position size when volatility is high.
    ATR/price < 1% → 1.0x; 2% → 0.75x; 3%+ → 0.5x (floor)
    """
    atr_pct = atr / price if price > 0 else 0.02
    if atr_pct <= 0.01:
        return 1.0
    elif atr_pct >= 0.03:
        return 0.5
    else:
        # Linear interpolation
        scalar = 1.0 - (atr_pct - 0.01) / (0.03 - 0.01) * 0.5
        return round(max(0.5, scalar), 4)


def calculate_position_size(
    portfolio_value: float,
    model_confidence: float,
    atr: float,
    current_price: float,
    soft_limit_triggered: bool = False,
) -> float:
    """
    Calculate position size in USDT.

    Args:
        portfolio_value:     Current total portfolio value in USDT.
        model_confidence:    ML confidence score (0.0–1.0).
        atr:                 ATR(14) for the coin.
        current_price:       Current price for ATR normalization.
        soft_limit_triggered: If True, apply 50% reduction (soft kill switch).

    Returns:
        Position size in USDT.
    """
    base_pct  = tiered_position_pct(model_confidence)
    base_size = portfolio_value * base_pct

    v_scalar = volatility_scalar(atr, current_price)
    size = base_size * v_scalar

    # Soft kill switch: 50% reduction
    if soft_limit_triggered:
        size *= 0.50
        logger.info(f"Position size halved due to soft kill switch: ${size:.2f}")

    # Hard cap at the tier ceiling (volatility scalar can only reduce, not exceed)
    size = min(size, base_size)

    logger.debug(
        f"Position sizing: tier={base_pct:.0%} base=${base_size:.2f} "
        f"× vol_scalar={v_scalar} → ${size:.2f}"
        + (" [SOFT LIMIT -50%]" if soft_limit_triggered else "")
    )
    return round(size, 2)


def calculate_stops(entry_price: float, atr: float) -> tuple[float, float]:
    """
    Calculate stop-loss and take-profit prices.

    Stop:   entry - (STOP_LOSS_ATR_MULT × ATR14)
    Target: entry + (TAKE_PROFIT_ATR_MULT × ATR14)

    Returns:
        (stop_loss_price, take_profit_price)
    """
    stop_loss   = entry_price - config.STOP_LOSS_ATR_MULT   * atr
    take_profit = entry_price + config.TAKE_PROFIT_ATR_MULT * atr

    # Safety: stop must always be below entry
    assert stop_loss < entry_price, f"Stop loss {stop_loss} >= entry {entry_price}"
    # Safety: take profit must always be above entry
    assert take_profit > entry_price, f"Take profit {take_profit} <= entry {entry_price}"

    return round(stop_loss, 8), round(take_profit, 8)
