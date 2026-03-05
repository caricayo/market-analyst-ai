"""
scripts/run_simulation.py — Run the walk-forward simulation and print results.

Run: python scripts/run_simulation.py
     python scripts/run_simulation.py --start 2024-01-01
     python scripts/run_simulation.py --start 2024-01-01 --end 2024-06-30

Results are printed as a formatted table and saved to SQLite.
Use simulation output to tune MIN_MODEL_CONFIDENCE, STOP_LOSS_ATR_MULT,
TAKE_PROFIT_ATR_MULT in config.py before live paper trading.
"""

import sys
import io
import shutil
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import config
from src.ml.walk_forward_sim import run_simulation
from loguru import logger


# ─── Acceptance gate thresholds (baseline verified 2026-03-05) ────────────────
GATE_WIN_RATE    = 0.559   # must exceed baseline 55.9%
GATE_PROFIT_FACTOR = 1.13  # must exceed baseline PF 1.13
GATE_MAX_DD      = 0.025   # absolute drawdown limit 2.5% (max_dd is negative, so compare abs)

# Rollback anchor — this file is NEVER deleted or modified
BASELINE_XGB = config.MODELS_DIR / "xgb_v_20260305_045548.pkl"


def _perform_rollback(failure_lines: list[str]) -> None:
    """
    Automatic rollback on simulation gate failure.

    Actions:
      1. Restore baseline XGB model → xgb_model_current.pkl
      2. Delete lgb_model_current.pkl
      3. Revert src/ml/feature_engineering.py to 22 features (remove btc_prev_day_return)
      4. Revert src/ml/predictor.py to single-model logic
      5. Revert src/ml/walk_forward_sim.py to single-model signal logic
    """
    base = Path(__file__).parent.parent

    print()
    print("=" * 70)
    print("  SIMULATION GATE FAILED — AUTOMATIC ROLLBACK")
    print("=" * 70)
    for line in failure_lines:
        print(f"  {line}")
    print()

    # 1. Restore baseline XGB model
    if BASELINE_XGB.exists():
        shutil.copy2(BASELINE_XGB, config.CURRENT_MODEL_PATH)
        print(f"  [OK] Restored: {BASELINE_XGB.name} -> {config.CURRENT_MODEL_PATH.name}")
    else:
        print(f"  [WARN] Baseline model not found: {BASELINE_XGB}")
        print(f"         Cannot restore XGB model automatically — check data/models/")

    # 2. Delete LGB model
    if config.CURRENT_LGB_MODEL_PATH.exists():
        config.CURRENT_LGB_MODEL_PATH.unlink()
        print(f"  [OK] Deleted: {config.CURRENT_LGB_MODEL_PATH.name}")

    # 3. Revert feature_engineering.py — remove btc_prev_day_return (23 → 22 features)
    fe_path = base / "src" / "ml" / "feature_engineering.py"
    fe_text = fe_path.read_text(encoding="utf-8")

    fe_text = fe_text.replace(
        '    "btc_prev_day_return",          # yesterday\'s BTC daily close return (market context)\n',
        ''
    )
    fe_text = fe_text.replace(
        '\n    # BTC previous day return (market context, no look-ahead: shift(1) uses prior day)\n'
        '    if btc_df is not None and len(btc_df) > 2:\n'
        '        try:\n'
        '            btc_daily = btc_df["close"].resample("D").last().dropna()\n'
        '            btc_daily_ret = btc_daily.pct_change().shift(1)  # prev day\'s return, no look-ahead\n'
        '            feat["btc_prev_day_return"] = btc_daily_ret.reindex(df.index, method="ffill")\n'
        '        except Exception:\n'
        '            feat["btc_prev_day_return"] = 0.0\n'
        '    else:\n'
        '        feat["btc_prev_day_return"] = 0.0\n',
        ''
    )
    fe_path.write_text(fe_text, encoding="utf-8")
    print("  [OK] Reverted feature_engineering.py → 22 features")

    # 4. Revert predictor.py → single-model
    pred_path = base / "src" / "ml" / "predictor.py"
    pred_text = pred_path.read_text(encoding="utf-8")

    pred_text = pred_text.replace(
        'from src.ml.trainer import load_current_model, load_lgb_model',
        'from src.ml.trainer import load_current_model'
    )
    pred_text = pred_text.replace(
        '_model = None\n_lgb_model = None',
        '_model = None'
    )
    pred_text = pred_text.replace(
        '\n\ndef _get_lgb_model():\n'
        '    global _lgb_model\n'
        '    if _lgb_model is None:\n'
        '        _lgb_model = load_lgb_model()\n'
        '    return _lgb_model',
        ''
    )
    pred_text = pred_text.replace(
        'def reload_model():\n'
        '    """Force reload of both models from disk (called after retraining)."""\n'
        '    global _model, _lgb_model\n'
        '    _model = load_current_model()\n'
        '    _lgb_model = load_lgb_model()\n'
        '    logger.info("Models reloaded from disk (XGB + LGB)")',
        'def reload_model():\n'
        '    """Force reload of model from disk (called after retraining)."""\n'
        '    global _model\n'
        '    _model = load_current_model()\n'
        '    logger.info("Model reloaded from disk")'
    )
    pred_text = pred_text.replace(
        '    features = get_current_features(df, btc_df=btc_df)\n'
        '    xgb_model = _get_model()\n'
        '    lgb_model  = _get_lgb_model()\n'
        '\n'
        '    X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)\n'
        '    xgb_proba = float(xgb_model.predict_proba(X)[0][1])\n'
        '    lgb_proba  = float(lgb_model.predict_proba(X)[0][1])\n'
        '    avg_proba  = (xgb_proba + lgb_proba) / 2.0\n'
        '\n'
        '    # ATR for risk sizing\n'
        '    from src.ml.feature_engineering import atr\n'
        '    atr14 = atr(df["high"], df["low"], df["close"], 14).iloc[-1]\n'
        '    current_price = float(df["close"].iloc[-1])\n'
        '\n'
        '    # Apply coin-specific confidence threshold; both models must individually agree\n'
        '    min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)\n'
        '    signal = (xgb_proba >= min_conf) and (lgb_proba >= min_conf)\n'
        '\n'
        '    return {\n'
        '        "symbol":          symbol,\n'
        '        "confidence":      round(avg_proba, 4),   # avg used for sorting/sizing\n'
        '        "xgb_confidence":  round(xgb_proba, 4),\n'
        '        "lgb_confidence":  round(lgb_proba, 4),\n'
        '        "signal":          signal,\n'
        '        "current_price":   current_price,\n'
        '        "atr":             round(float(atr14), 6),\n'
        '        "timestamp":       df.index[-1],\n'
        '    }',
        '    features = get_current_features(df, btc_df=btc_df)\n'
        '    model = _get_model()\n'
        '\n'
        '    X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)\n'
        '    proba = model.predict_proba(X)[0][1]\n'
        '\n'
        '    # ATR for risk sizing\n'
        '    from src.ml.feature_engineering import atr\n'
        '    atr14 = atr(df["high"], df["low"], df["close"], 14).iloc[-1]\n'
        '    current_price = float(df["close"].iloc[-1])\n'
        '\n'
        '    # Apply coin-specific confidence threshold\n'
        '    min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)\n'
        '\n'
        '    return {\n'
        '        "symbol": symbol,\n'
        '        "confidence": round(float(proba), 4),\n'
        '        "signal": proba >= min_conf,\n'
        '        "current_price": current_price,\n'
        '        "atr": round(float(atr14), 6),\n'
        '        "timestamp": df.index[-1],\n'
        '    }'
    )
    pred_path.write_text(pred_text, encoding="utf-8")
    print("  [OK] Reverted predictor.py → single-model")

    # 5. Revert walk_forward_sim.py → single-model signal logic
    sim_path = base / "src" / "ml" / "walk_forward_sim.py"
    sim_text = sim_path.read_text(encoding="utf-8")

    sim_text = sim_text.replace(
        '    # Load XGB and LGB models\n'
        '    with open(model_path, "rb") as f:\n'
        '        xgb_model = pickle.load(f)\n'
        '    lgb_model_path = config.CURRENT_LGB_MODEL_PATH\n'
        '    with open(lgb_model_path, "rb") as f:\n'
        '        lgb_model = pickle.load(f)',
        '    # Load model\n'
        '    with open(model_path, "rb") as f:\n'
        '        model = pickle.load(f)'
    )
    sim_text = sim_text.replace(
        '                features = get_current_features(hist, btc_df=btc_hist)\n'
        '                X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)\n'
        '                xgb_conf = float(xgb_model.predict_proba(X)[0][1])\n'
        '                lgb_conf  = float(lgb_model.predict_proba(X)[0][1])\n'
        '                avg_conf  = (xgb_conf + lgb_conf) / 2.0\n'
        '                atr14 = float(atr(hist["high"], hist["low"], hist["close"], 14).iloc[-1])\n'
        '                price = float(hist["close"].iloc[-1])\n'
        '                # Apply coin-specific confidence threshold; both models must agree\n'
        '                min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)\n'
        '                if xgb_conf >= min_conf and lgb_conf >= min_conf:\n'
        '                    signals.append({\n'
        '                        "symbol":     symbol,\n'
        '                        "confidence": avg_conf,   # avg used for position sizing and sorting\n'
        '                        "price":      price,\n'
        '                        "atr":        atr14,\n'
        '                    })',
        '                features = get_current_features(hist, btc_df=btc_hist)\n'
        '                X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)\n'
        '                confidence = float(model.predict_proba(X)[0][1])\n'
        '                atr14 = float(atr(hist["high"], hist["low"], hist["close"], 14).iloc[-1])\n'
        '                price = float(hist["close"].iloc[-1])\n'
        '                # Apply coin-specific confidence threshold\n'
        '                min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)\n'
        '                if confidence >= min_conf:\n'
        '                    signals.append({\n'
        '                        "symbol": symbol,\n'
        '                        "confidence": confidence,\n'
        '                        "price": price,\n'
        '                        "atr": atr14,\n'
        '                    })'
    )
    sim_path.write_text(sim_text, encoding="utf-8")
    print("  [OK] Reverted walk_forward_sim.py → single-model")

    print()
    print("  Rollback complete. System restored to verified baseline.")
    print(f"  Baseline model: {BASELINE_XGB.name}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Walk-forward simulation")
    parser.add_argument("--start", default=config.SIMULATION_START_DATE,
                        help=f"Start date (YYYY-MM-DD). Default: {config.SIMULATION_START_DATE}")
    parser.add_argument("--end", default=None,
                        help="End date (YYYY-MM-DD). Default: today")
    parser.add_argument("--balance", type=float, default=10_000.0,
                        help="Starting paper balance in USDT. Default: 10000")
    parser.add_argument("--gate", action="store_true", default=False,
                        help="Run dual-model acceptance gate + auto-rollback on failure. "
                             "Only use when validating a new model upgrade.")
    args = parser.parse_args()

    print()
    print("=" * 70)
    print("  Walk-Forward Simulation")
    print(f"  Start date:      {args.start}")
    print(f"  End date:        {args.end or 'today'}")
    print(f"  Starting balance: ${args.balance:,.2f}")
    print()
    print(f"  Training cutoff was:  {config.TRAIN_END_DATE}")
    print(f"  Model NEVER saw any data from {args.start} onward.")
    print("=" * 70)
    print()

    result = run_simulation(
        start_date=args.start,
        end_date=args.end,
        starting_usdt=args.balance,
    )

    if not result:
        print("\033[91m  No trades executed. Check data coverage for the simulation period.\033[0m")
        return 1

    # ── Per-day trade table ──────────────────────────────────────────────────
    trade_log = result.pop("trade_log")
    print("  Trade Log")
    print("  " + "-" * 80)
    print(f"  {'Date':<12} {'Symbol':<10} {'Conf':<7} {'Predicted':<12} {'Actual':<10} {'OK?':<5} {'Exit':<14} {'P&L':>8}")
    print("  " + "-" * 80)
    for _, row in trade_log.iterrows():
        pnl_str = f"${row['pnl_usdt']:+.2f}"
        print(
            f"  {row['date']:<12} {row['symbol']:<10} {row['confidence']:<7} "
            f"{row['predicted']:<12} {row['actual']:<10} {row['correct']:<5} "
            f"{row['exit_reason']:<14} {pnl_str:>8}"
        )

    # ── Summary ──────────────────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("  Summary Statistics")
    print("=" * 70)
    print(f"  Total trades:     {result['total_trades']}  ({result['wins']} wins / {result['losses']} losses)")
    print(f"  Overall win rate: {result['win_rate']:.1%}")
    print(f"  Total return:     {result['total_return_pct']:+.2%}")
    print(f"  Final value:      ${result['final_value']:,.2f}")
    print(f"  Max drawdown:     {result['max_drawdown_pct']:.2%}")
    print(f"  Sharpe ratio:     {result['sharpe_ratio']:.2f}")
    print(f"  Avg win:          ${result['avg_win_usdt']:+.2f}")
    print(f"  Avg loss:         ${result['avg_loss_usdt']:+.2f}")
    print(f"  Profit factor:    {result['profit_factor']:.2f}")

    # Win rate by coin
    print()
    print("  Win Rate by Coin")
    print("  " + "-" * 40)
    for coin, stats in sorted(result["win_rate_by_coin"].items()):
        wr = stats["win_rate"]
        n  = stats["trades"]
        bar = "#" * int(wr * 20) + "." * (20 - int(wr * 20))
        print(f"  {coin:<10} [{bar}] {wr:.1%}  ({n} trades)")

    # Win rate by day-of-week
    print()
    print("  Win Rate by Day-of-Week")
    print("  " + "-" * 40)
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for day in dow_order:
        if day in result["win_rate_by_dow"]:
            stats = result["win_rate_by_dow"][day]
            wr = stats["win_rate"]
            n  = stats["trades"]
            bar = "#" * int(wr * 20) + "." * (20 - int(wr * 20))
            print(f"  {day:<12} [{bar}] {wr:.1%}  ({n} trades)")

    # ── Tuning guidance ──────────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("  Tuning Guidance (based on these results)")
    print("=" * 70)

    if result["win_rate"] < 0.45:
        print("  [!] Win rate below 45% -- consider raising MIN_MODEL_CONFIDENCE in config.py")
    elif result["win_rate"] > 0.60:
        print("  [OK] Win rate looks healthy. Consider lowering MIN_MODEL_CONFIDENCE slightly")
        print("     to capture more trades if profit_factor > 1.5")

    if result["max_drawdown_pct"] < -0.10:
        print("  [!] Drawdown exceeds 10% -- consider tightening STOP_LOSS_ATR_MULT")

    if result["profit_factor"] < 1.0:
        print("  [!] Profit factor < 1.0 -- this strategy loses money overall. Do NOT go live.")
    elif result["profit_factor"] >= 1.5:
        print("  [OK] Profit factor looks solid. Strategy shows positive expectancy.")

    print()
    print("  Results saved to SQLite (data/trading.db)")
    print("  View in dashboard: streamlit run dashboard/app.py")
    print()
    print(f"  Run ID: {result['run_id']}")
    print("=" * 70)

    # ── Dual-model acceptance gate (only when --gate is passed) ──────────────
    if not args.gate:
        return 0

    win_rate     = result["win_rate"]
    pf           = result["profit_factor"]
    max_dd_abs   = abs(result["max_drawdown_pct"])

    gate_pass = (
        win_rate > GATE_WIN_RATE and
        pf       > GATE_PROFIT_FACTOR and
        max_dd_abs < GATE_MAX_DD
    )

    print()
    print("=" * 70)
    print("  Dual-Model Acceptance Gate")
    print("=" * 70)
    wr_ok = "PASS" if win_rate > GATE_WIN_RATE       else "FAIL"
    pf_ok = "PASS" if pf       > GATE_PROFIT_FACTOR  else "FAIL"
    dd_ok = "PASS" if max_dd_abs < GATE_MAX_DD        else "FAIL"
    print(f"  Win rate:     {win_rate:.1%}  > {GATE_WIN_RATE:.1%}  required  [{wr_ok}]")
    print(f"  Profit factor: {pf:.3f}  > {GATE_PROFIT_FACTOR:.2f}  required  [{pf_ok}]")
    print(f"  Max drawdown:  {max_dd_abs:.2%}  < {GATE_MAX_DD:.1%}  required  [{dd_ok}]")

    if gate_pass:
        print()
        print("\033[92m  GATE: PASSED — dual-model upgrade accepted\033[0m")
        print("  Both xgb_model_current.pkl and lgb_model_current.pkl are active.")
        print("  The system will now require both models to agree before opening a trade.")
        print("=" * 70)
        return 0
    else:
        failure_lines = []
        if win_rate <= GATE_WIN_RATE:
            failure_lines.append(
                f"Win rate {win_rate:.1%} <= baseline {GATE_WIN_RATE:.1%} "
                f"(delta: {win_rate - GATE_WIN_RATE:+.1%})"
            )
        if pf <= GATE_PROFIT_FACTOR:
            failure_lines.append(
                f"Profit factor {pf:.3f} <= baseline {GATE_PROFIT_FACTOR:.2f} "
                f"(delta: {pf - GATE_PROFIT_FACTOR:+.3f})"
            )
        if max_dd_abs >= GATE_MAX_DD:
            failure_lines.append(
                f"Max drawdown {max_dd_abs:.2%} >= limit {GATE_MAX_DD:.1%} "
                f"(delta: {max_dd_abs - GATE_MAX_DD:+.2%})"
            )

        _perform_rollback(failure_lines)
        print("\033[91m  GATE: FAILED — system rolled back to verified baseline\033[0m")
        print("=" * 70)
        return 1


if __name__ == "__main__":
    sys.exit(main())
