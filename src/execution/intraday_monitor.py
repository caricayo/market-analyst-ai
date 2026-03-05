"""
src/execution/intraday_monitor.py — 5-minute intraday monitor.

Checks stop-loss and take-profit for all open positions.
Evaluates kill switch on each cycle.
"""

from datetime import datetime, timezone
from loguru import logger

import config
from src.exchange.client import ExchangeClient
from src.exchange.portfolio import PaperPortfolio
from src.risk.kill_switch import evaluate_kill_switch, is_trading_halted
from src.alerts.discord_alerts import alert_trade_closed
from src.database.writer import record_heartbeat, save_daily_stat


def run_monitor_cycle(
    client: ExchangeClient,
    portfolio: PaperPortfolio,
    starting_value: float,
    date_str: str = None,
) -> dict:
    """
    One iteration of the intraday monitor.

    Args:
        client:          Exchange client for current prices.
        portfolio:       Paper portfolio.
        starting_value:  Portfolio value at start of today (for kill switch).
        date_str:        Today's date string (YYYY-MM-DD).

    Returns:
        dict: {exits: int, kill_switch_level: str|None, halt: bool}
    """
    date_str = date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if is_trading_halted():
        logger.debug("Monitor: trading halted — skipping cycle")
        return {"exits": 0, "kill_switch_level": None, "halt": True}

    open_symbols = list(portfolio.open_trades.keys())
    if not open_symbols:
        record_heartbeat("intraday_monitor", "ok", "no_open_positions")
        return {"exits": 0, "kill_switch_level": None, "halt": False}

    exits = 0

    for symbol in list(open_symbols):
        if symbol not in portfolio.open_trades:
            continue   # may have been closed earlier in this cycle

        try:
            current_price = client.get_current_price(symbol)
        except Exception as e:
            logger.warning(f"Could not fetch price for {symbol}: {e}")
            continue

        exit_reason = portfolio.check_stops(symbol, current_price)
        if exit_reason:
            result = portfolio.execute_sell(symbol, current_price, exit_reason)
            if result:
                exits += 1
                try:
                    alert_trade_closed(
                        symbol=symbol,
                        exit_price=result["exit_price"],
                        pnl_usdt=result["pnl_usdt"],
                        pnl_pct=result["pnl_pct"],
                        exit_reason=exit_reason,
                        paper=config.PAPER_TRADING,
                    )
                except Exception as alert_err:
                    logger.error(f"Alert failed for {symbol} (trade was closed): {alert_err}")

    # Kill switch evaluation
    current_value = portfolio.portfolio_value()
    ks = evaluate_kill_switch(current_value, starting_value)

    if ks["level"] == "daily" or ks["level"] == "weekly":
        logger.warning(f"Kill switch {ks['level']} — halting all trading")
        # Close all positions immediately
        def get_price(sym):
            return client.get_current_price(sym)
        closed = portfolio.close_all_positions(get_price, reason="kill_switch_exit")
        exits += len(closed)
        for t in closed:
            try:
                alert_trade_closed(
                    symbol=t["symbol"],
                    exit_price=t["exit_price"],
                    pnl_usdt=t["pnl_usdt"],
                    pnl_pct=t["pnl_pct"],
                    exit_reason="kill_switch_exit",
                    paper=config.PAPER_TRADING,
                )
            except Exception as alert_err:
                logger.error(f"Alert failed for kill_switch_exit {t['symbol']} (trade was closed): {alert_err}")

    record_heartbeat("intraday_monitor", "ok",
                     f"exits={exits} ks={ks['level']} open={len(portfolio.open_trades)}")

    return {
        "exits": exits,
        "kill_switch_level": ks["level"],
        "halt": ks["halt_trading"],
        "reduce_size": ks["reduce_size"],
        "daily_pnl_pct": ks["daily_pnl_pct"],
    }
