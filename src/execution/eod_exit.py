"""
src/execution/eod_exit.py — End-of-day forced exit at 22:00 UTC.

Closes all open positions with market sells.
Sends URGENT Discord alert if any positions remain open at 22:15 UTC.
"""

from datetime import datetime, timezone
from loguru import logger

import config
from src.exchange.client import ExchangeClient
from src.exchange.portfolio import PaperPortfolio
from src.alerts.discord_alerts import alert_eod_positions_closed, alert_eod_stuck_positions
from src.database.writer import record_heartbeat, save_daily_stat


def run_eod_exit(
    client: ExchangeClient,
    portfolio: PaperPortfolio,
    starting_value: float,
) -> dict:
    """
    Close all open positions. Called at 22:00 UTC.

    Returns:
        dict: {closed: int, total_pnl_usdt: float}
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    logger.info(f"=== EOD Exit: {date_str} 22:00 UTC ===")

    open_symbols = list(portfolio.open_trades.keys())
    if not open_symbols:
        logger.info("EOD: No open positions")
        record_heartbeat("eod_exit", "ok", "no_open_positions")
        _save_end_of_day(portfolio, starting_value, date_str, closed_count=0)
        return {"closed": 0, "total_pnl_usdt": 0.0}

    logger.info(f"EOD: Closing {len(open_symbols)} position(s): {', '.join(open_symbols)}")

    def get_price(symbol):
        return client.get_current_price(symbol)

    closed = portfolio.close_all_positions(get_price, reason="eod_exit")

    total_pnl = sum(t.get("pnl_usdt", 0) for t in closed)
    logger.info(f"EOD: Closed {len(closed)} position(s) | Total P&L: ${total_pnl:+.2f}")

    alert_eod_positions_closed(closed)
    record_heartbeat("eod_exit", "ok", f"closed={len(closed)} pnl={total_pnl:.2f}")
    _save_end_of_day(portfolio, starting_value, date_str, closed_count=len(closed))

    return {"closed": len(closed), "total_pnl_usdt": total_pnl}


def run_eod_verification(portfolio: PaperPortfolio, client: ExchangeClient = None):
    """
    Called at 22:10 UTC. Verify all positions are closed.
    If any are stuck, attempts one retry close before sending URGENT alert.
    """
    open_symbols = list(portfolio.open_trades.keys())
    if not open_symbols:
        logger.info("EOD verification: all clear ✓")
        return

    logger.error(f"EOD verification: {len(open_symbols)} stuck positions: {open_symbols}")

    # Retry closing if we have an exchange client
    if client is not None:
        logger.warning("EOD verification: attempting retry close...")
        try:
            closed = portfolio.close_all_positions(
                lambda sym: client.get_current_price(sym),
                reason="eod_verification_retry",
            )
            if closed:
                logger.info(f"EOD verification retry closed {len(closed)} position(s)")
            still_open = list(portfolio.open_trades.keys())
            if not still_open:
                return   # all clear after retry
            open_symbols = still_open
        except Exception as e:
            logger.error(f"EOD verification retry failed: {e}")

    logger.critical(f"EOD verification: {len(open_symbols)} positions STILL open after retry: {open_symbols}")
    alert_eod_stuck_positions(open_symbols)


def _save_end_of_day(portfolio: PaperPortfolio, starting_value: float,
                     date_str: str, closed_count: int):
    """Persist end-of-day stats to the database."""
    end_value = portfolio.portfolio_value()
    daily_pnl_usdt = end_value - starting_value
    daily_pnl_pct  = daily_pnl_usdt / starting_value if starting_value > 0 else 0

    try:
        save_daily_stat({
            "date": date_str,
            "portfolio_value_start": starting_value,
            "portfolio_value_end": end_value,
            "daily_pnl_usdt": round(daily_pnl_usdt, 2),
            "daily_pnl_pct": round(daily_pnl_pct, 6),
            "trades_closed": closed_count,
            "paper": config.PAPER_TRADING,
        })
    except Exception as e:
        logger.error(f"Failed to save daily stats: {e}")
