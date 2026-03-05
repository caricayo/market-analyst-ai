"""
src/execution/morning_routine.py — Daily morning trading routine.

Flow:
  1. Clear previous day's halt files
  2. Run AI gatekeeper
  3. Check kill switch
  4. Score watchlist
  5. Filter by confidence + liquidity
  6. Calculate position sizes and stops
  7. Execute buys (top 3 signals)
  8. Discord alerts per trade
"""

from datetime import datetime, timezone
from loguru import logger

import config
from src.market_context.ai_gatekeeper import run_gatekeeper
from src.ml.predictor import score_watchlist
from src.ml.data_fetcher import update_ohlcv
from src.risk.kill_switch import clear_daily_halt, is_trading_halted, evaluate_kill_switch, is_soft_limit_active
from src.risk.position_sizer import calculate_position_size, calculate_stops
from src.exchange.client import ExchangeClient
from src.exchange.portfolio import PaperPortfolio
from src.alerts.discord_alerts import alert_trade_opened, alert_gatekeeper
from src.database.writer import save_daily_stat, record_heartbeat, log_event


def run_morning_routine(
    client: ExchangeClient,
    portfolio: PaperPortfolio,
    starting_value: float,
) -> dict:
    """
    Execute the full morning routine.

    Args:
        client:          Exchange client for market data.
        portfolio:       Paper (or live) portfolio.
        starting_value:  Portfolio value at start of day (for kill switch tracking).

    Returns:
        dict with keys: gatekeeper_result, trades_opened, skipped_reasons
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    logger.info(f"=== Morning Routine: {date_str} ===")

    # Blocked trading days — skip entirely before any external calls
    # (bypassed in TEST_MODE so every run can attempt trades)
    day_name = now.strftime("%A")
    blocked_days = getattr(config, "BLOCKED_TRADING_DAYS", [])
    if day_name in blocked_days and not config.TEST_MODE:
        logger.info(f"Today is {day_name} — blocked trading day, skipping morning routine")
        record_heartbeat("morning_routine", "ok", f"blocked_day_{day_name}")
        return {"gatekeeper_result": False, "trades_opened": 0, "skipped_reasons": [f"blocked_day_{day_name}"]}

    # Step 1: Clear previous day's halt files
    clear_daily_halt()

    # Step 2: Kill switch check (in case we're starting mid-halt)
    if is_trading_halted():
        logger.warning("Trading is halted — morning routine aborted")
        record_heartbeat("morning_routine", "ok", "halted")
        return {"gatekeeper_result": False, "trades_opened": 0, "skipped_reasons": ["trading_halted"]}

    # Step 3: AI gatekeeper
    gatekeeper = run_gatekeeper()
    alert_gatekeeper(
        gatekeeper["trade_today"],
        gatekeeper["primary_reason"],
        gatekeeper["regime"],
    )

    save_daily_stat({
        "date": date_str,
        "portfolio_value_start": starting_value,
        "gatekeeper_result": gatekeeper["trade_today"],
        "gatekeeper_reason": gatekeeper["primary_reason"],
        "paper": config.PAPER_TRADING,
    })

    # Log gatekeeper decision to live feed
    gate_level = "info" if gatekeeper["trade_today"] else "warn"
    gate_verdict = "TRADE" if gatekeeper["trade_today"] else "SKIP"
    log_event(
        event_type="gatekeeper",
        message=f"Gatekeeper: {gate_verdict} — {gatekeeper['primary_reason']}",
        level=gate_level,
        data={
            "trade_today": gatekeeper["trade_today"],
            "regime": gatekeeper.get("regime"),
            "primary_reason": gatekeeper.get("primary_reason"),
            "fear_greed": gatekeeper.get("fear_greed"),
            "btc_dominance": gatekeeper.get("btc_dominance"),
        },
    )

    if config.BYPASS_GATEKEEPER and not gatekeeper["trade_today"]:
        logger.warning("BYPASS_GATEKEEPER=true — overriding gatekeeper SKIP (TEST MODE ONLY)")
        gatekeeper["trade_today"] = True

    if not gatekeeper["trade_today"]:
        logger.info("Gatekeeper: skip today")
        record_heartbeat("morning_routine", "ok", "gatekeeper_skip")
        return {"gatekeeper_result": False, "trades_opened": 0, "skipped_reasons": ["gatekeeper"]}

    # Step 4: Update data + score watchlist
    logger.info("Updating market data and scoring watchlist...")
    try:
        signals = score_watchlist(update_data=True)
    except Exception as e:
        logger.error(f"Watchlist scoring failed: {e}")
        record_heartbeat("morning_routine", "error", str(e))
        return {"gatekeeper_result": True, "trades_opened": 0, "skipped_reasons": [f"scoring_error: {e}"]}

    # Log all coin scores to live feed (one event per coin)
    for sig in signals:
        if "error" in sig:
            log_event(
                event_type="coin_score",
                message=f"{sig['symbol']}: scoring error — {sig['error']}",
                symbol=sig.get("symbol"),
                level="error",
                data=sig,
            )
        else:
            conf = sig.get("confidence", 0)
            above = sig.get("signal", False)
            log_event(
                event_type="coin_score",
                message=(
                    f"{sig['symbol']}: conf={conf:.1%}  {'SIGNAL' if above else 'below threshold'}"
                    + (f"  price=${sig.get('current_price', 0):,.4f}" if sig.get("current_price") else "")
                ),
                symbol=sig.get("symbol"),
                level="info" if above else "info",
                data={
                    "confidence": round(conf, 4),
                    "signal": above,
                    "current_price": sig.get("current_price"),
                    "atr": sig.get("atr"),
                    "predicted_return": sig.get("predicted_return"),
                },
            )

    # Step 5: Filter — only signals above threshold, with liquidity
    actionable = []
    for sig in signals:
        if not sig.get("signal"):
            continue
        if "error" in sig:
            continue
        # Liquidity check
        try:
            if not client.is_liquid(sig["symbol"]):
                logger.warning(f"  {sig['symbol']}: insufficient liquidity — skipped")
                continue
        except Exception:
            pass   # If liquidity check fails, allow through
        actionable.append(sig)

    if not actionable:
        logger.info("No actionable signals this morning")
        record_heartbeat("morning_routine", "ok", "no_signals")
        return {"gatekeeper_result": True, "trades_opened": 0, "skipped_reasons": ["no_signals"]}

    # Step 6: Take top MAX_SIMULTANEOUS_TRADES signals
    top_signals = actionable[:config.MAX_SIMULTANEOUS_TRADES]
    soft_limit = is_soft_limit_active()
    portfolio_value = portfolio.portfolio_value()

    trades_opened = 0
    skipped = []

    for sig in top_signals:
        if portfolio.is_at_max_positions():
            logger.info("Max positions reached — stopping buys")
            break

        symbol = sig["symbol"]
        confidence = sig["confidence"]
        current_price = sig["current_price"]
        atr_val = sig["atr"]

        # Calculate position size
        pos_size = calculate_position_size(
            portfolio_value=portfolio_value,
            model_confidence=confidence,
            atr=atr_val,
            current_price=current_price,
            soft_limit_triggered=soft_limit,
        )

        # Calculate stops
        stop_loss, take_profit = calculate_stops(current_price, atr_val)

        # Execute buy
        trade_id = portfolio.execute_buy(
            symbol=symbol,
            entry_price=current_price,
            position_value=pos_size,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            atr=atr_val,
            model_confidence=confidence,
        )

        if trade_id is not None:
            trades_opened += 1
            alert_trade_opened(
                symbol=symbol,
                entry_price=current_price,
                quantity=pos_size / current_price,
                position_value=pos_size,
                stop=stop_loss,
                target=take_profit,
                confidence=confidence,
                paper=config.PAPER_TRADING,
            )
            log_event(
                event_type="trade_open",
                message=f"Opened {symbol} @ ${current_price:,.4f}  conf={confidence:.1%}  size=${pos_size:.2f}",
                symbol=symbol,
                level="info",
                data={
                    "trade_id": trade_id,
                    "entry_price": current_price,
                    "quantity": round(pos_size / current_price, 8),
                    "position_value": round(pos_size, 2),
                    "stop_loss": stop_loss,
                    "take_profit": take_profit,
                    "confidence": round(confidence, 4),
                    "paper": config.PAPER_TRADING,
                },
            )
            logger.info(f"  Opened: {symbol} conf={confidence:.1%} size=${pos_size:.2f}")
        else:
            skipped.append(symbol)

    record_heartbeat("morning_routine", "ok",
                     f"opened={trades_opened} signals={len(actionable)}")
    logger.info(f"Morning routine complete: {trades_opened} trades opened")
    return {"gatekeeper_result": True, "trades_opened": trades_opened, "skipped_reasons": skipped}
