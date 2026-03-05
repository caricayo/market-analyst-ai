"""
src/ml/walk_forward_sim.py — Walk-forward simulation engine.

Steps forward one day at a time using only data available before that day.
Applies full risk rules: position sizing, kill switch, max positions, liquidity filter.

CRITICAL: Only simulate on dates AFTER the training cutoff (TRAIN_END_DATE).
          Simulating on training data produces misleadingly good results.
"""

import uuid
import pickle
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np
from loguru import logger

import config
from src.ml.feature_engineering import build_features, get_current_features, atr, FEATURE_NAMES
from src.ml.data_fetcher import load_ohlcv
from src.risk.position_sizer import calculate_position_size, calculate_stops
from src.database.writer import save_trade, update_trade, save_simulation_result


# ─── Simulation state ─────────────────────────────────────────────────────────

class SimState:
    def __init__(self, starting_usdt: float):
        self.usdt = starting_usdt
        self.starting_usdt = starting_usdt
        self.open_positions: dict[str, dict] = {}   # symbol → position
        self.trade_log: list[dict] = []
        self.daily_pnl: list[float] = []
        self.peak_value = starting_usdt

    def portfolio_value(self, prices: dict = None) -> float:
        total = self.usdt
        for sym, pos in self.open_positions.items():
            price = (prices or {}).get(sym, pos["entry_price"])
            total += pos["quantity"] * price
        return total

    def max_drawdown(self) -> float:
        """Max peak-to-trough drawdown as a negative fraction."""
        if not self.daily_pnl:
            return 0.0
        cumulative = 1.0
        peak = 1.0
        max_dd = 0.0
        for pnl in self.daily_pnl:
            cumulative *= (1 + pnl)
            if cumulative > peak:
                peak = cumulative
            dd = (cumulative - peak) / peak
            if dd < max_dd:
                max_dd = dd
        return max_dd


# ─── Data helpers ─────────────────────────────────────────────────────────────

def _load_all_data() -> dict[str, pd.DataFrame]:
    """Load all OHLCV data into memory once."""
    data = {}
    for symbol in config.WATCHLIST:
        df = load_ohlcv(symbol)
        if df is None:
            logger.warning(f"No data for {symbol} — skipping in simulation")
            continue
        data[symbol] = df
    return data


def _slice_before(df: pd.DataFrame, dt: datetime) -> pd.DataFrame:
    """Return only rows strictly before dt (no future leak)."""
    return df[df.index < pd.Timestamp(dt)]


def _get_prices_at(data: dict, dt: datetime) -> dict[str, float]:
    """Get closing prices at a specific datetime."""
    prices = {}
    for sym, df in data.items():
        sliced = _slice_before(df, dt + timedelta(hours=1))
        if len(sliced) > 0:
            prices[sym] = float(sliced["close"].iloc[-1])
    return prices


# ─── Core simulation ──────────────────────────────────────────────────────────

def run_simulation(
    model_path: Path = None,
    start_date: str = None,
    end_date: str = None,
    starting_usdt: float = 10_000.0,
    run_id: str = None,
) -> dict:
    """
    Run a walk-forward simulation.

    Args:
        model_path:    Path to trained model pkl. Defaults to CURRENT_MODEL_PATH.
        start_date:    First simulation date (YYYY-MM-DD). Must be > TRAIN_END_DATE.
        end_date:      Last simulation date (YYYY-MM-DD). Defaults to today.
        starting_usdt: Starting paper balance.
        run_id:        Unique run identifier. Auto-generated if None.

    Returns:
        Summary statistics dict.
    """
    run_id = run_id or f"sim_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    model_path = model_path or config.CURRENT_MODEL_PATH
    start_date = start_date or config.SIMULATION_START_DATE
    end_date   = end_date   or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── Safety check: enforce simulation is after training cutoff ──────────
    if start_date <= config.TRAIN_END_DATE:
        raise ValueError(
            f"Simulation start_date ({start_date}) must be AFTER training cutoff "
            f"({config.TRAIN_END_DATE}). Simulating on training data produces "
            f"misleadingly good results."
        )

    logger.info("=" * 60)
    logger.info(f"Walk-Forward Simulation: {start_date} → {end_date}")
    logger.info(f"Starting balance: ${starting_usdt:,.2f}")
    logger.info(f"Run ID: {run_id}")
    logger.info("=" * 60)

    # Load XGB and LGB models
    with open(model_path, "rb") as f:
        xgb_model = pickle.load(f)
    lgb_model_path = config.CURRENT_LGB_MODEL_PATH
    with open(lgb_model_path, "rb") as f:
        lgb_model = pickle.load(f)

    # Load all OHLCV data
    all_data = _load_all_data()
    if not all_data:
        raise RuntimeError("No OHLCV data found. Run download_historical_data.py first.")

    state = SimState(starting_usdt)

    # Iterate day by day
    current_date = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_dt       = datetime.strptime(end_date,   "%Y-%m-%d").replace(tzinfo=timezone.utc)

    per_day_rows = []
    halted = False
    weekly_pnls = []

    # Pre-slice BTC data reference (updated each morning inside the loop)
    btc_symbol = "BTC/USD"

    while current_date <= end_dt:
        day_str = current_date.strftime("%Y-%m-%d")
        morning_dt = current_date.replace(hour=8, minute=0)
        eod_dt     = current_date.replace(hour=22, minute=0)

        # ── Morning: score watchlist ────────────────────────────────────────
        day_portfolio_start = state.portfolio_value()

        if halted:
            current_date += timedelta(days=1)
            continue

        # Skip blocked trading days entirely
        day_name = current_date.strftime("%A")
        if day_name in getattr(config, "BLOCKED_TRADING_DAYS", []):
            current_date += timedelta(days=1)
            continue

        # Slice BTC history for btc_prev_day_return feature
        btc_hist = _slice_before(all_data[btc_symbol], morning_dt) if btc_symbol in all_data else None

        signals = []
        for symbol, df in all_data.items():
            hist = _slice_before(df, morning_dt)
            if len(hist) < 200:
                continue
            try:
                features = get_current_features(hist, btc_df=btc_hist)
                X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)
                xgb_conf = float(xgb_model.predict_proba(X)[0][1])
                lgb_conf  = float(lgb_model.predict_proba(X)[0][1])
                avg_conf  = (xgb_conf + lgb_conf) / 2.0
                atr14 = float(atr(hist["high"], hist["low"], hist["close"], 14).iloc[-1])
                price = float(hist["close"].iloc[-1])
                # Apply coin-specific confidence threshold; both models must agree
                min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)
                if xgb_conf >= min_conf and lgb_conf >= min_conf:
                    signals.append({
                        "symbol":     symbol,
                        "confidence": avg_conf,
                        "price":      price,
                        "atr":        atr14,
                    })
            except Exception as e:
                logger.debug(f"  Feature error for {symbol} on {day_str}: {e}")

        # Sort by confidence; take top MAX_SIMULTANEOUS_TRADES
        signals.sort(key=lambda x: x["confidence"], reverse=True)

        # ── Open positions ──────────────────────────────────────────────────
        for sig in signals:
            if len(state.open_positions) >= config.MAX_SIMULTANEOUS_TRADES:
                break
            if sig["symbol"] in state.open_positions:
                continue

            pv = state.portfolio_value()
            if (pv - state.usdt) / pv >= config.MAX_PORTFOLIO_EXPOSURE:
                break

            pos_size = calculate_position_size(
                pv, sig["confidence"], sig["atr"], sig["price"]
            )
            stop, target = calculate_stops(sig["price"], sig["atr"])

            # Apply fee + slippage
            fill_price = sig["price"] * (1 + config.SIMULATED_SLIPPAGE_PCT)
            fee = pos_size * config.COINBASE_FEE_PCT
            quantity = pos_size / fill_price

            if pos_size + fee > state.usdt:
                continue

            state.usdt -= (pos_size + fee)
            state.open_positions[sig["symbol"]] = {
                "entry_price": fill_price,
                "quantity": quantity,
                "pos_size": pos_size,
                "stop": stop,
                "target": target,
                "confidence": sig["confidence"],
                "fee_in": fee,
                "opened_day": day_str,
            }

        # ── Intraday monitor (simulate at hourly candles) ────────────────────
        for hour_offset in range(1, 14):   # 09:00 → 21:55 UTC
            check_dt = current_date.replace(hour=9) + timedelta(hours=hour_offset)
            prices = _get_prices_at(all_data, check_dt)

            for symbol in list(state.open_positions.keys()):
                pos = state.open_positions[symbol]
                price = prices.get(symbol)
                if price is None:
                    continue

                exit_reason = None
                if price <= pos["stop"]:
                    exit_reason = "stop_loss"
                elif price >= pos["target"]:
                    exit_reason = "take_profit"

                if exit_reason:
                    exit_price = price * (1 - config.SIMULATED_SLIPPAGE_PCT)
                    gross = pos["quantity"] * exit_price
                    fee_out = gross * config.COINBASE_FEE_PCT
                    net = gross - fee_out
                    pnl = net - pos["pos_size"] - pos["fee_in"]
                    state.usdt += net

                    actual_return = (exit_price - pos["entry_price"]) / pos["entry_price"]
                    predicted_dir = "up"
                    correct = pnl > 0

                    per_day_rows.append({
                        "date":          day_str,
                        "symbol":        symbol,
                        "confidence":    f"{pos['confidence']:.0%}",
                        "predicted":     f"+{config.PREDICTION_THRESHOLD_PCT:.1%}",
                        "actual":        f"{actual_return:+.2%}",
                        "correct":       "✅" if correct else "❌",
                        "exit_reason":   exit_reason,
                        "pnl_usdt":      round(pnl, 2),
                    })
                    del state.open_positions[symbol]

                    # ── Intraday re-entry: only on take_profit, before 16:00 UTC ──
                    if (
                        exit_reason == "take_profit"
                        and check_dt.hour < 16
                        and len(state.open_positions) < config.MAX_SIMULTANEOUS_TRADES
                    ):
                        btc_hist_intra = (
                            _slice_before(all_data[btc_symbol], check_dt)
                            if btc_symbol in all_data else None
                        )
                        reentry_signals = []
                        for rsym, rdf in all_data.items():
                            if rsym in state.open_positions:
                                continue
                            rhist = _slice_before(rdf, check_dt)
                            if len(rhist) < 200:
                                continue
                            try:
                                rfeatures = get_current_features(rhist, btc_df=btc_hist_intra)
                                rX = pd.DataFrame([rfeatures[FEATURE_NAMES]], columns=FEATURE_NAMES)
                                rxgb = float(xgb_model.predict_proba(rX)[0][1])
                                rlgb = float(lgb_model.predict_proba(rX)[0][1])
                                ravg = (rxgb + rlgb) / 2.0
                                # Re-entry requires higher bar than morning (0.62 minimum)
                                rmin = max(0.62, getattr(config, "COIN_MIN_CONFIDENCE", {}).get(rsym, config.MIN_MODEL_CONFIDENCE))
                                if rxgb >= rmin and rlgb >= rmin:
                                    ratr = float(atr(rhist["high"], rhist["low"], rhist["close"], 14).iloc[-1])
                                    reentry_signals.append({
                                        "symbol": rsym,
                                        "confidence": ravg,
                                        "price": float(rhist["close"].iloc[-1]),
                                        "atr": ratr,
                                    })
                            except Exception:
                                pass
                        reentry_signals.sort(key=lambda x: x["confidence"], reverse=True)
                        for rsig in reentry_signals:
                            if len(state.open_positions) >= config.MAX_SIMULTANEOUS_TRADES:
                                break
                            if rsig["symbol"] in state.open_positions:
                                continue
                            rpv = state.portfolio_value()
                            if (rpv - state.usdt) / rpv >= config.MAX_PORTFOLIO_EXPOSURE:
                                break
                            rsize = calculate_position_size(rpv, rsig["confidence"], rsig["atr"], rsig["price"])
                            rstop, rtarget = calculate_stops(rsig["price"], rsig["atr"])
                            rfill = rsig["price"] * (1 + config.SIMULATED_SLIPPAGE_PCT)
                            rfee = rsize * config.COINBASE_FEE_PCT
                            if rsize + rfee > state.usdt:
                                continue
                            state.usdt -= (rsize + rfee)
                            state.open_positions[rsig["symbol"]] = {
                                "entry_price": rfill,
                                "quantity": rsize / rfill,
                                "pos_size": rsize,
                                "stop": rstop,
                                "target": rtarget,
                                "confidence": rsig["confidence"],
                                "fee_in": rfee,
                                "opened_day": day_str,
                            }
                            logger.debug(f"  Re-entry: {rsig['symbol']} @ ${rfill:.2f} conf={rsig['confidence']:.1%}")

                    break  # re-check after each exit

        # ── EOD forced exit ──────────────────────────────────────────────────
        eod_prices = _get_prices_at(all_data, eod_dt)
        for symbol in list(state.open_positions.keys()):
            pos = state.open_positions.pop(symbol)
            price = eod_prices.get(symbol, pos["entry_price"])
            exit_price = price * (1 - config.SIMULATED_SLIPPAGE_PCT)
            gross = pos["quantity"] * exit_price
            fee_out = gross * config.COINBASE_FEE_PCT
            net = gross - fee_out
            pnl = net - pos["pos_size"] - pos["fee_in"]
            state.usdt += net

            actual_return = (exit_price - pos["entry_price"]) / pos["entry_price"]
            per_day_rows.append({
                "date":       day_str,
                "symbol":     symbol,
                "confidence": f"{pos['confidence']:.0%}",
                "predicted":  f"+{config.PREDICTION_THRESHOLD_PCT:.1%}",
                "actual":     f"{actual_return:+.2%}",
                "correct":    "✅" if pnl > 0 else "❌",
                "exit_reason": "eod_exit",
                "pnl_usdt":   round(pnl, 2),
            })

        # ── Daily P&L tracking for kill switch ──────────────────────────────
        day_end_pv = state.portfolio_value()
        daily_pnl_pct = (day_end_pv - day_portfolio_start) / day_portfolio_start if day_portfolio_start > 0 else 0
        state.daily_pnl.append(daily_pnl_pct)

        # Accumulate weekly P&L (last 7 days)
        weekly_pnls.append(daily_pnl_pct)
        if len(weekly_pnls) > 7:
            weekly_pnls.pop(0)
        weekly_total = sum(weekly_pnls)

        # Check weekly circuit breaker
        if weekly_total <= -config.WEEKLY_CIRCUIT_BREAKER_PCT:
            logger.warning(f"  {day_str}: Weekly circuit breaker triggered ({weekly_total:.2%}) — halting simulation")
            halted = True

        if state.portfolio_value() > state.peak_value:
            state.peak_value = state.portfolio_value()

        current_date += timedelta(days=1)

    # ── Summary statistics ────────────────────────────────────────────────────
    if not per_day_rows:
        logger.warning("No trades executed during simulation period")
        return {}

    df_trades = pd.DataFrame(per_day_rows)
    total_trades = len(df_trades)
    wins  = (df_trades["correct"] == "✅").sum()
    losses = total_trades - wins
    win_rate = wins / total_trades if total_trades > 0 else 0

    df_trades["pnl_num"] = df_trades["pnl_usdt"]
    avg_win  = df_trades[df_trades["pnl_num"] > 0]["pnl_num"].mean()
    avg_loss = df_trades[df_trades["pnl_num"] < 0]["pnl_num"].mean()
    profit_factor = abs(avg_win / avg_loss) if avg_loss != 0 else float("inf")

    final_value = state.portfolio_value()
    total_return = (final_value - starting_usdt) / starting_usdt
    max_dd = state.max_drawdown()

    # Sharpe (annualised, simplified)
    if len(state.daily_pnl) > 1:
        daily_arr = np.array(state.daily_pnl)
        sharpe = (daily_arr.mean() / daily_arr.std() * np.sqrt(252)) if daily_arr.std() > 0 else 0
    else:
        sharpe = 0.0

    summary = {
        "run_id":           run_id,
        "sim_start":        start_date,
        "sim_end":          end_date,
        "total_trades":     total_trades,
        "wins":             int(wins),
        "losses":           int(losses),
        "win_rate":         round(win_rate, 4),
        "total_return_pct": round(total_return, 4),
        "max_drawdown_pct": round(max_dd, 4),
        "sharpe_ratio":     round(float(sharpe), 3),
        "avg_win_usdt":     round(float(avg_win or 0), 2),
        "avg_loss_usdt":    round(float(avg_loss or 0), 2),
        "profit_factor":    round(profit_factor, 3),
        "final_value":      round(final_value, 2),
        "starting_value":   starting_usdt,
        "trade_log":        df_trades,
    }

    # Win rate by coin
    by_coin = df_trades.groupby("symbol").apply(
        lambda g: {"trades": len(g), "win_rate": (g["correct"] == "✅").mean()}
    ).to_dict()
    summary["win_rate_by_coin"] = by_coin

    # Win rate by day-of-week
    df_trades["dow"] = pd.to_datetime(df_trades["date"]).dt.day_name()
    by_dow = df_trades.groupby("dow").apply(
        lambda g: {"trades": len(g), "win_rate": (g["correct"] == "✅").mean()}
    ).to_dict()
    summary["win_rate_by_dow"] = by_dow

    # Persist to DB
    try:
        save_simulation_result({
            "run_id": run_id,
            "run_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "sim_start": start_date,
            "sim_end": end_date,
            "total_trades": total_trades,
            "win_rate": win_rate,
            "total_return_pct": total_return,
            "max_drawdown_pct": max_dd,
            "sharpe_ratio": float(sharpe),
            "avg_win_pct": float(avg_win or 0) / starting_usdt,
            "avg_loss_pct": float(avg_loss or 0) / starting_usdt,
            "profit_factor": profit_factor,
            "model_version": str(model_path.stem),
        })
    except Exception as e:
        logger.warning(f"Could not save simulation result to DB: {e}")

    logger.info("=" * 60)
    logger.info(f"Simulation complete: {total_trades} trades")
    logger.info(f"  Win rate:     {win_rate:.1%}")
    logger.info(f"  Total return: {total_return:+.2%}")
    logger.info(f"  Max drawdown: {max_dd:.2%}")
    logger.info(f"  Sharpe ratio: {sharpe:.2f}")
    logger.info("=" * 60)

    return summary
