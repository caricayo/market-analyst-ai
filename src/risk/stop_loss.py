"""
src/risk/stop_loss.py — Stop-loss and take-profit monitoring utilities.

Thin helpers used by the intraday monitor to check price levels.
"""

from loguru import logger


def check_stop_and_target(
    current_price: float,
    stop_loss_price: float,
    take_profit_price: float,
) -> str | None:
    """
    Returns 'stop_loss', 'take_profit', or None.
    """
    if current_price <= stop_loss_price:
        return "stop_loss"
    if current_price >= take_profit_price:
        return "take_profit"
    return None


def price_to_stop_pct(entry: float, stop: float) -> float:
    """Returns the distance to stop as a negative percentage."""
    return (stop - entry) / entry


def risk_reward_ratio(entry: float, stop: float, target: float) -> float:
    """
    R:R = (target - entry) / (entry - stop)
    2.0 means we risk 1 to make 2.
    """
    risk   = entry - stop
    reward = target - entry
    if risk <= 0:
        return 0.0
    return round(reward / risk, 2)
