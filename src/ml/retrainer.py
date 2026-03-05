"""
src/ml/retrainer.py — Weekly automated model retraining with acceptance logic.

Logic:
  1. Download latest 30 days of data (incremental update)
  2. Retrain model on rolling window (TRAIN_START → today-30d cutoff)
  3. Walk-forward AUC comparison: accept if AUC >= (old_AUC - 0.02)
  4. Run 30-day walk-forward simulation on most recent 30 days
  5. Send Discord report with AUC comparison + simulation summary
  6. Keep full version history — NEVER delete old models

Live accuracy monitoring:
  If 14-day rolling win rate < LIVE_WIN_RATE_MIN → alert + auto-reduce sizes
"""

import json
import pickle
from datetime import datetime, timezone, timedelta
from pathlib import Path
from loguru import logger

import config
from src.ml.data_fetcher import update_ohlcv
from src.ml.trainer import train_model, load_current_model
from src.ml.walk_forward_sim import run_simulation
from src.database.reader import get_current_model, get_rolling_win_rate
from src.alerts.discord_alerts import alert_retrain_result, alert_low_win_rate, send_raw


def _get_old_auc() -> float:
    """Get AUC of currently deployed model from DB. Returns 0 if no model exists."""
    model_meta = get_current_model()
    if model_meta and model_meta.wf_auc_mean:
        return model_meta.wf_auc_mean
    return 0.0


def run_weekly_retrain():
    """
    Full weekly retraining pipeline. Called by the scheduler every Sunday 01:00 UTC.
    """
    now = datetime.now(timezone.utc)
    logger.info("=" * 60)
    logger.info(f"Weekly Retrain started: {now.strftime('%Y-%m-%d %H:%M UTC')}")
    logger.info("=" * 60)

    # Step 1: Update data for all watchlist coins
    logger.info("Step 1: Updating market data...")
    for symbol in config.WATCHLIST:
        try:
            update_ohlcv(symbol)
        except Exception as e:
            logger.warning(f"  {symbol}: data update failed — {e}")

    # Step 2: Retrain model
    logger.info("Step 2: Retraining model...")
    old_auc = _get_old_auc()
    ts = now.strftime("%Y%m%d_%H%M%S")
    version_tag = f"xgb_weekly_{ts}"

    try:
        result = train_model(version_tag=version_tag)
    except Exception as e:
        msg = f"Retraining FAILED: {e}"
        logger.error(msg)
        send_raw(f"🚨 Weekly retrain FAILED: {e}")
        return

    new_auc = result["wf_auc_mean"]
    accepted = new_auc >= (old_auc - 0.02) and result["accepted"]

    if accepted:
        # Reload both models into the live predictor immediately — no restart needed
        try:
            from src.ml.predictor import reload_model
            reload_model()
            logger.info("  Live predictor reloaded with new models.")
        except Exception as e:
            logger.warning(f"  reload_model() failed — new models will load on next prediction: {e}")
    else:
        result["is_current"] = False
        logger.warning(
            f"New model REJECTED: AUC {new_auc:.4f} < (old {old_auc:.4f} - 0.02). "
            f"Keeping previous model."
        )

    # Step 3: 30-day walk-forward simulation on recent data
    logger.info("Step 3: Running 30-day walk-forward simulation on recent data...")
    sim_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    sim_win_rate = None

    # Only simulate if start is after training cutoff
    if sim_start > config.TRAIN_END_DATE:
        try:
            model_path = Path(result["file_path"])
            sim = run_simulation(
                model_path=model_path,
                start_date=sim_start,
                end_date=now.strftime("%Y-%m-%d"),
                run_id=f"retrain_sim_{ts}",
            )
            sim_win_rate = sim.get("win_rate")
        except Exception as e:
            logger.warning(f"30-day simulation failed: {e}")
    else:
        logger.info("  Skipping simulation — start date is within training window")

    # Step 4: Discord report
    alert_retrain_result(
        version_tag=version_tag,
        wf_auc=new_auc,
        old_auc=old_auc,
        accepted=accepted,
        sim_win_rate=sim_win_rate,
    )

    # Step 5: Check rolling win rate
    rolling_wr = get_rolling_win_rate(config.LIVE_WIN_RATE_WINDOW_DAYS, paper=config.PAPER_TRADING)
    if rolling_wr is not None and rolling_wr < config.LIVE_WIN_RATE_MIN:
        logger.warning(f"Rolling win rate {rolling_wr:.1%} below minimum {config.LIVE_WIN_RATE_MIN:.0%}")
        alert_low_win_rate(rolling_wr, config.LIVE_WIN_RATE_WINDOW_DAYS)

    logger.info(f"Weekly retrain complete: {version_tag} | AUC={new_auc:.4f} | accepted={accepted}")
    return result
