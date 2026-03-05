"""
scripts/optimize_risk_params.py — Bayesian risk-parameter search via Optuna + VectorBT.

HOW IT WORKS
============
Phase 1  Pre-compute morning (08:00 UTC) ML signals for the full simulation window.
         Both XGB and LGB models are scored per coin per day.
         Result cached to data/signals_cache.parquet (re-used on subsequent runs).
         Hourly OHLCV prices cached to data/ohlcv_cache.parquet.

Phase 2  Optuna TPE sampler runs N trials.  Each trial:
           • Filters cached signals by MIN_MODEL_CONFIDENCE (both models must agree)
           • Selects top-MAX_SIMULTANEOUS_TRADES coins per day by avg_conf
           • Builds entry / stop-loss / take-profit / EOD-exit arrays
           • Runs a vectorbt Portfolio.from_signals() backtest (OHLC-aware)
           • Returns: Sharpe − penalty(max_dd > 3%) − penalty(trades < 20)

Phase 3  Prints top 10 combinations ranked by Sharpe ratio.
         Full results saved to data/optimization_results.csv.

PARAMETER SEARCH SPACE
=======================
  STOP_LOSS_ATR_MULT       0.80 – 3.00
  TAKE_PROFIT_ATR_MULT     1.50 – 6.00
  MIN_MODEL_CONFIDENCE     0.52 – 0.72
  MAX_POSITION_PCT         0.05 – 0.20  (% of available cash per entry)
  MAX_SIMULTANEOUS_TRADES  1    – 4

SAFETY
======
  config.py is NEVER modified.  Results are advisory only.
  Per-coin COIN_MIN_CONFIDENCE overrides in config.py are always respected
  (trial min_confidence acts as a global floor; per-coin thresholds can only
  raise it further, never lower it).

USAGE
=====
  python -X utf8 scripts/optimize_risk_params.py              # 300 trials
  python -X utf8 scripts/optimize_risk_params.py --trials 50  # quick test
  python -X utf8 scripts/optimize_risk_params.py --refresh    # re-run signal cache
  python -X utf8 scripts/optimize_risk_params.py --start 2024-10-01
"""

import argparse
import pickle
import sys
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from loguru import logger

warnings.filterwarnings("ignore")

# ── Project root on sys.path ─────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent))

# ── Dependency guard ─────────────────────────────────────────────────────────
try:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
except ImportError:
    print("ERROR: optuna not installed.  Run: pip install optuna>=4.0.0")
    sys.exit(1)

try:
    import vectorbt as vbt
except ImportError:
    print("ERROR: vectorbt not installed.  Run: pip install vectorbt>=0.28.0")
    sys.exit(1)

import config
from src.ml.data_fetcher import load_ohlcv
from src.ml.feature_engineering import (
    FEATURE_NAMES,
    atr as _compute_atr,
    get_current_features,
)

# ─── Constants ────────────────────────────────────────────────────────────────

SIGNAL_CACHE  = Path("data/signals_cache.parquet")
OHLCV_CACHE   = Path("data/ohlcv_cache.parquet")
RESULTS_CSV   = Path("data/optimization_results.csv")
STARTING_USDT = 10_000.0
MIN_TRADE_FILTER = 5   # discard trials with fewer trades than this from the ranking


# ─── Phase 1: Pre-compute signals ────────────────────────────────────────────

def _slice_before(df: pd.DataFrame, dt: datetime) -> pd.DataFrame:
    """Return rows strictly before dt (no look-ahead)."""
    return df[df.index < pd.Timestamp(dt)]


def precompute(start_date: str, force_refresh: bool = False):
    """
    Score every tradeable day in [start_date, today] at 08:00 UTC with both models.

    Returns
    -------
    signals_df : pd.DataFrame
        Columns: date (str), symbol, xgb_conf, lgb_conf, avg_conf, atr, price

    ohlcv_wide : pd.DataFrame
        MultiIndex columns (symbol, ohlc=open/high/low/close), hourly UTC rows
        from start_date onward.
    """
    if SIGNAL_CACHE.exists() and OHLCV_CACHE.exists() and not force_refresh:
        signals_df = pd.read_parquet(SIGNAL_CACHE)
        ohlcv_wide = pd.read_parquet(OHLCV_CACHE)
        logger.info(
            f"Signal cache loaded: {len(signals_df):,} rows | "
            f"Price cache: {ohlcv_wide.shape[0]:,} hourly bars"
        )
        return signals_df, ohlcv_wide

    logger.info("Pre-computing ML signals — cached after first run (~5 min)...")

    # Load models
    for path, label in [
        (config.CURRENT_MODEL_PATH,     "XGB model"),
        (config.CURRENT_LGB_MODEL_PATH, "LGB model"),
    ]:
        if not path.exists():
            logger.error(f"{label} not found at {path}. Run: python scripts/train_model.py")
            sys.exit(1)

    with open(config.CURRENT_MODEL_PATH, "rb") as f:
        xgb_model = pickle.load(f)
    with open(config.CURRENT_LGB_MODEL_PATH, "rb") as f:
        lgb_model = pickle.load(f)

    # Load all OHLCV data
    all_data: dict[str, pd.DataFrame] = {}
    for symbol in config.WATCHLIST:
        df = load_ohlcv(symbol)
        if df is not None:
            all_data[symbol] = df
        else:
            logger.warning(f"No OHLCV data for {symbol} — skipping")

    if not all_data:
        logger.error("No OHLCV data found. Run: python scripts/download_historical_data.py")
        sys.exit(1)

    btc_symbol  = "BTC/USD"
    start_dt    = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_dt      = datetime.now(timezone.utc)
    total_days  = max(1, (end_dt - start_dt).days)
    blocked     = getattr(config, "BLOCKED_TRADING_DAYS", [])

    signal_rows: list[dict] = []
    current     = start_dt
    processed   = 0

    while current <= end_dt:
        day_name = current.strftime("%A")
        if day_name in blocked:
            current += timedelta(days=1)
            continue

        morning_dt = current.replace(hour=8, minute=0, second=0, microsecond=0)
        btc_hist   = (
            _slice_before(all_data[btc_symbol], morning_dt)
            if btc_symbol in all_data else None
        )

        for symbol, df in all_data.items():
            hist = _slice_before(df, morning_dt)
            if len(hist) < 200:
                continue
            try:
                feat  = get_current_features(hist, btc_df=btc_hist)
                X     = pd.DataFrame([feat[FEATURE_NAMES]], columns=FEATURE_NAMES)
                xgb_c = float(xgb_model.predict_proba(X)[0][1])
                lgb_c = float(lgb_model.predict_proba(X)[0][1])
                atr14 = float(_compute_atr(hist["high"], hist["low"], hist["close"], 14).iloc[-1])
                price = float(hist["close"].iloc[-1])
                signal_rows.append({
                    "date":     current.strftime("%Y-%m-%d"),
                    "symbol":   symbol,
                    "xgb_conf": round(xgb_c, 6),
                    "lgb_conf": round(lgb_c, 6),
                    "avg_conf": round((xgb_c + lgb_c) / 2.0, 6),
                    "atr":      round(atr14, 8),
                    "price":    round(price, 8),
                })
            except Exception as e:
                logger.debug(f"Signal error {symbol} {current.date()}: {e}")

        processed += 1
        if processed % 30 == 0:
            logger.info(f"  Scoring days: {processed}/{total_days} ({processed/total_days:.0%})")

        current += timedelta(days=1)

    signals_df = pd.DataFrame(signal_rows)
    signals_df.to_parquet(SIGNAL_CACHE, index=False)
    logger.info(f"  Signals cached: {len(signals_df):,} rows across {signals_df['date'].nunique()} days")

    # Build wide OHLCV DataFrame with MultiIndex columns: (symbol, ohlc)
    pieces: dict[tuple, pd.Series] = {}
    for symbol, df in all_data.items():
        for col in ("open", "high", "low", "close"):
            if col in df.columns:
                pieces[(symbol, col)] = df[col]

    ohlcv_wide = pd.concat(pieces, axis=1)
    ohlcv_wide.columns = pd.MultiIndex.from_tuples(ohlcv_wide.columns, names=["symbol", "ohlc"])
    ohlcv_wide = ohlcv_wide[ohlcv_wide.index >= pd.Timestamp(start_date, tz="UTC")]
    # Forward-fill to handle sparse data gaps
    ohlcv_wide = ohlcv_wide.ffill()
    ohlcv_wide.to_parquet(OHLCV_CACHE)
    logger.info(f"  OHLCV cached: {ohlcv_wide.shape[0]:,} bars × {len(all_data)} coins")

    return signals_df, ohlcv_wide


# ─── Phase 2: Build VectorBT portfolio for one trial ─────────────────────────

def _build_portfolio(
    signals_df: pd.DataFrame,
    ohlcv_wide: pd.DataFrame,
    min_conf:   float,
    sl_mult:    float,
    tp_mult:    float,
    pos_pct:    float,
    max_trades: int,
) -> object:
    """
    Translate trial parameters + pre-computed signals into a vectorbt Portfolio.

    Entry rule   08:00 UTC, both models ≥ per-coin threshold, top-N by avg_conf
    Stop-loss    entry_price − sl_mult × ATR14   (fraction of entry price)
    Take-profit  entry_price + tp_mult × ATR14   (fraction of entry price)
    EOD exit     22:00 UTC forced close (whichever exit condition hits first wins)
    """
    avail_symbols = set(ohlcv_wide.columns.get_level_values("symbol").unique())
    symbols       = [s for s in signals_df["symbol"].unique() if s in avail_symbols]

    idx = ohlcv_wide.index

    # Extract per-symbol price DataFrames, align to shared index
    try:
        close_df = ohlcv_wide.xs("close", level="ohlc", axis=1).reindex(columns=symbols)
        high_df  = ohlcv_wide.xs("high",  level="ohlc", axis=1).reindex(columns=symbols)
        low_df   = ohlcv_wide.xs("low",   level="ohlc", axis=1).reindex(columns=symbols)
    except KeyError:
        # Fallback if 'ohlc' level name differs
        close_df = ohlcv_wide.loc[:, (symbols, "close")].droplevel(1, axis=1)
        high_df  = ohlcv_wide.loc[:, (symbols, "high")].droplevel(1, axis=1)
        low_df   = ohlcv_wide.loc[:, (symbols, "low")].droplevel(1, axis=1)

    # Allocate entry and stop arrays (NaN = no stop; only populated at entry bars)
    entries  = pd.DataFrame(False,   index=idx, columns=symbols)
    sl_stops = pd.DataFrame(np.nan,  index=idx, columns=symbols)
    tp_stops = pd.DataFrame(np.nan,  index=idx, columns=symbols)

    coin_confs = getattr(config, "COIN_MIN_CONFIDENCE", {})

    for date_str, day_df in signals_df.groupby("date"):
        # Both models must individually meet the per-coin threshold
        valid: list[pd.Series] = []
        for _, row in day_df.iterrows():
            thresh = max(min_conf, coin_confs.get(row["symbol"], min_conf))
            if row["xgb_conf"] >= thresh and row["lgb_conf"] >= thresh:
                valid.append(row)

        if not valid:
            continue

        # Rank by ensemble confidence, keep top-N
        valid.sort(key=lambda r: r["avg_conf"], reverse=True)
        valid = valid[:max_trades]

        entry_ts = pd.Timestamp(date_str + " 08:00:00", tz="UTC")
        if entry_ts not in idx:
            continue

        for row in valid:
            sym = row["symbol"]
            if sym not in entries.columns:
                continue
            entries.at[entry_ts, sym]  = True
            # Stop/target expressed as a fraction of entry price
            sl_stops.at[entry_ts, sym] = float((sl_mult * row["atr"]) / row["price"])
            tp_stops.at[entry_ts, sym] = float((tp_mult * row["atr"]) / row["price"])

    # EOD forced exit: close all open positions at 22:00 UTC
    eod_exits = pd.DataFrame(False, index=idx, columns=symbols)
    eod_mask  = idx.hour == 22
    eod_exits.loc[eod_mask] = True

    # Build portfolio: shared cash pool, percent-of-available-cash sizing
    pf = vbt.Portfolio.from_signals(
        close        = close_df,
        high         = high_df,
        low          = low_df,
        entries      = entries,
        exits        = eod_exits,
        sl_stop      = sl_stops,
        tp_stop      = tp_stops,
        size         = pos_pct,
        size_type    = "percent",    # % of available cash per entry
        group_by     = True,         # all coins share one portfolio
        cash_sharing = True,
        fees         = config.COINBASE_FEE_PCT,
        slippage     = config.SIMULATED_SLIPPAGE_PCT,
        init_cash    = STARTING_USDT,
        freq         = "1h",
    )
    return pf


def _extract_metrics(pf) -> dict:
    """Pull standardised metrics from a VectorBT Portfolio object."""
    sharpe       = float(pf.sharpe_ratio())
    max_dd       = float(pf.max_drawdown())        # negative fraction
    total_return = float(pf.total_return())
    n_trades     = int(pf.trades.count())

    win_rate = 0.0
    pf_ratio = 0.0

    if n_trades > 0:
        try:
            records   = pf.trades.records_readable
            pnl_col   = next(
                (c for c in records.columns if c.lower() in ("pnl", "pnl (usd)")),
                None,
            )
            if pnl_col:
                pnls     = records[pnl_col].values
                wins     = (pnls > 0).sum()
                win_rate = float(wins / len(pnls)) if len(pnls) > 0 else 0.0
                avg_win  = float(pnls[pnls > 0].mean()) if (pnls > 0).any() else 0.0
                avg_loss = float(pnls[pnls < 0].mean()) if (pnls < 0).any() else 0.0
                if avg_loss != 0.0:
                    pf_ratio = abs(avg_win / avg_loss)
        except Exception:
            pass

    return {
        "sharpe":        sharpe       if not np.isnan(sharpe)       else -999.0,
        "max_drawdown":  max_dd       if not np.isnan(max_dd)       else -1.0,
        "total_return":  total_return if not np.isnan(total_return) else -1.0,
        "total_trades":  n_trades,
        "win_rate":      win_rate,
        "profit_factor": pf_ratio,
    }


# ─── Phase 3: Optuna objective ────────────────────────────────────────────────

def _make_objective(signals_df: pd.DataFrame, ohlcv_wide: pd.DataFrame):
    """Factory — returns (objective_fn, results_list)."""
    all_results: list[dict] = []

    def objective(trial: optuna.Trial) -> float:
        sl_mult    = trial.suggest_float("stop_atr_mult",          0.8,  3.0)
        tp_mult    = trial.suggest_float("take_profit_atr_mult",   1.5,  6.0)
        min_conf   = trial.suggest_float("min_confidence",         0.52, 0.72)
        pos_pct    = trial.suggest_float("max_position_pct",       0.05, 0.20)
        max_trades = trial.suggest_int(  "max_simultaneous_trades", 1,    4)

        try:
            pf      = _build_portfolio(
                signals_df, ohlcv_wide, min_conf, sl_mult, tp_mult, pos_pct, max_trades
            )
            metrics = _extract_metrics(pf)

            # Primary objective: Sharpe ratio
            score = metrics["sharpe"]

            # Penalty 1: max drawdown exceeds 3%
            dd_pct = abs(metrics["max_drawdown"])
            if dd_pct > 0.03:
                score -= (dd_pct - 0.03) * 10.0

            # Penalty 2: too few trades (insufficient statistical confidence)
            if metrics["total_trades"] < 20:
                score -= (20 - metrics["total_trades"]) * 0.10

            all_results.append({
                **metrics,
                "score":                   round(score, 6),
                "stop_atr_mult":           round(sl_mult,    3),
                "take_profit_atr_mult":    round(tp_mult,    3),
                "min_confidence":          round(min_conf,   4),
                "max_position_pct":        round(pos_pct,    4),
                "max_simultaneous_trades": max_trades,
            })

            return score

        except Exception as e:
            logger.debug(f"Trial {trial.number} failed: {e}")
            return -999.0

    return objective, all_results


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bayesian risk-parameter optimiser (Optuna + VectorBT)"
    )
    parser.add_argument("--trials",  type=int,  default=300,      help="Optuna trial count")
    parser.add_argument("--refresh", action="store_true",          help="Invalidate signal cache")
    parser.add_argument("--start",   default=config.SIMULATION_START_DATE,
                        help="Simulation start date (YYYY-MM-DD)")
    args = parser.parse_args()

    # Safety: never simulate on training data
    if args.start <= config.TRAIN_END_DATE:
        logger.error(
            f"--start ({args.start}) must be AFTER training cutoff ({config.TRAIN_END_DATE})."
        )
        sys.exit(1)

    logger.info("=" * 70)
    logger.info("Risk Parameter Optimizer  —  Optuna × VectorBT")
    logger.info(f"  Trials   : {args.trials}")
    logger.info(f"  Window   : {args.start} → today")
    logger.info(f"  XGB      : {config.CURRENT_MODEL_PATH.name}")
    logger.info(f"  LGB      : {config.CURRENT_LGB_MODEL_PATH.name}")
    logger.info(f"  Starting : ${STARTING_USDT:,.0f}")
    logger.info("=" * 70)

    # ── Phase 1 ──────────────────────────────────────────────────────────────
    signals_df, ohlcv_wide = precompute(args.start, force_refresh=args.refresh)

    if signals_df.empty:
        logger.error("No signals — check data and models.")
        sys.exit(1)

    n_days  = signals_df["date"].nunique()
    n_coins = signals_df["symbol"].nunique()
    logger.info(
        f"Signal universe: {len(signals_df):,} rows | "
        f"{n_days} trading days | {n_coins} coins"
    )
    logger.info(
        f"Avg signals/day: {len(signals_df)/n_days:.1f} | "
        f"Price bars: {len(ohlcv_wide):,}"
    )

    # ── Phase 2: Optimise ────────────────────────────────────────────────────
    objective_fn, all_results = _make_objective(signals_df, ohlcv_wide)
    study = optuna.create_study(
        direction = "maximize",
        sampler   = optuna.samplers.TPESampler(seed=42),
    )

    logger.info(f"Starting {args.trials} Optuna trials...")
    logger.info("  Note: first trial may take 30–60 s for Numba JIT compilation.")

    study.optimize(objective_fn, n_trials=args.trials, show_progress_bar=True)

    # ── Phase 3: Results ─────────────────────────────────────────────────────
    if not all_results:
        logger.error("No results recorded — all trials failed.")
        sys.exit(1)

    res_df = (
        pd.DataFrame(all_results)
        .sort_values("sharpe", ascending=False)
        .reset_index(drop=True)
    )

    # Separate the usable results (≥ MIN_TRADE_FILTER trades) for ranking
    ranked = res_df[res_df["total_trades"] >= MIN_TRADE_FILTER].reset_index(drop=True)
    top10  = (ranked if not ranked.empty else res_df).head(10)

    # ── Print table ──────────────────────────────────────────────────────────
    W = 96
    print()
    print("=" * W)
    print("  TOP 10 PARAMETER COMBINATIONS  —  ranked by Sharpe ratio")
    print("=" * W)
    print(
        f"  {'#':>3}  {'Sharpe':>7}  {'Return':>8}  {'WinRate':>8}  {'PF':>5}  "
        f"{'MaxDD':>7}  {'Trades':>6}  "
        f"{'SL_ATR':>6}  {'TP_ATR':>6}  {'MinConf':>7}  {'PosPct':>6}  {'MaxPos':>6}"
    )
    print("  " + "-" * (W - 2))

    for rank, (_, row) in enumerate(top10.iterrows(), start=1):
        print(
            f"  {rank:>3}.  "
            f"{row['sharpe']:>7.3f}  "
            f"{row['total_return']:>+7.2%}  "
            f"{row['win_rate']:>7.1%}  "
            f"{min(row['profit_factor'], 99.99):>5.2f}  "
            f"{row['max_drawdown']:>7.2%}  "
            f"{int(row['total_trades']):>6}  "
            f"{row['stop_atr_mult']:>6.2f}  "
            f"{row['take_profit_atr_mult']:>6.2f}  "
            f"{row['min_confidence']:>7.0%}  "
            f"{row['max_position_pct']:>6.0%}  "
            f"{int(row['max_simultaneous_trades']):>6}"
        )

    print("=" * W)

    # ── Current config comparison ─────────────────────────────────────────
    print()
    print("  Current config.py values (for comparison):")
    cur = {
        "STOP_LOSS_ATR_MULT":      (config.STOP_LOSS_ATR_MULT,      "0.80 – 3.00"),
        "TAKE_PROFIT_ATR_MULT":    (config.TAKE_PROFIT_ATR_MULT,    "1.50 – 6.00"),
        "MIN_MODEL_CONFIDENCE":    (config.MIN_MODEL_CONFIDENCE,    "0.52 – 0.72"),
        "MAX_POSITION_PCT":        (config.MAX_POSITION_PCT,        "0.05 – 0.20"),
        "MAX_SIMULTANEOUS_TRADES": (config.MAX_SIMULTANEOUS_TRADES, "1 – 4"),
    }
    for name, (val, rng) in cur.items():
        print(f"    {name:<28} = {val}  (searched: {rng})")

    print()
    print("  → config.py was NOT modified.  Review results and update manually.")
    print()

    # ── Save full results ─────────────────────────────────────────────────
    res_df.to_csv(RESULTS_CSV, index=False, float_format="%.6f")
    print(f"  Full {len(res_df)} results saved to: {RESULTS_CSV}")
    print("=" * W)
    print()

    if top10.empty:
        logger.warning("No results with sufficient trades. Rerun with --trials 300.")
        return

    # ── Best trial summary ────────────────────────────────────────────────
    best = top10.iloc[0]
    print("  BEST COMBINATION:")
    for col in ("stop_atr_mult", "take_profit_atr_mult", "min_confidence",
                "max_position_pct", "max_simultaneous_trades"):
        print(f"    {col:<28} = {best[col]}")
    print(
        f"\n  Expected: Sharpe {best['sharpe']:.3f} | "
        f"Return {best['total_return']:+.2%} | "
        f"WR {best['win_rate']:.1%} | "
        f"PF {min(best['profit_factor'], 99.99):.2f} | "
        f"MaxDD {best['max_drawdown']:.2%}"
    )
    print()


if __name__ == "__main__":
    main()
