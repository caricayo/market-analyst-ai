"""
src/ml/trainer.py — XGBoost model training with walk-forward cross-validation.

CRITICAL SAFETY RULES (enforced in code):
1. TimeSeriesSplit is ALWAYS used — never shuffle=True. Shuffling leaks future data.
2. Training data is truncated to TRAIN_END_DATE before anything runs.
3. Model is only saved if AUC >= 0.55.
"""

import json
import pickle
import hashlib
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.metrics import roc_auc_score
from loguru import logger

import config
from src.ml.feature_engineering import build_features_and_target, FEATURE_NAMES
from src.ml.data_fetcher import load_ohlcv
from src.database.writer import save_model_version


# ─── Training cutoff enforcement ─────────────────────────────────────────────

def _enforce_training_cutoff(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    """Trim data to TRAIN_END_DATE. Raises if result is empty."""
    cutoff = pd.Timestamp(config.TRAIN_END_DATE, tz="UTC") + pd.Timedelta(days=1)
    before = len(df)
    df = df[df.index < cutoff]
    after = len(df)
    if after == 0:
        raise ValueError(f"No training data for {symbol} before {config.TRAIN_END_DATE}")
    if after < before:
        logger.info(f"  Training cutoff applied: {before - after} rows removed ({symbol})")
    return df


# ─── Multi-coin dataset builder ───────────────────────────────────────────────

def build_training_dataset(symbols: list = None) -> tuple:
    """
    Load data for all symbols, enforce cutoff, build features, concatenate.

    Returns:
        (X, y): pandas DataFrames/Series ready for training.
    """
    symbols = symbols or config.WATCHLIST
    X_all, y_all = [], []

    # Load BTC data once for the btc_prev_day_return feature.
    # Enforcing training cutoff so no future data leaks into the feature.
    btc_df_raw = load_ohlcv("BTC/USD")
    btc_df_train = _enforce_training_cutoff(btc_df_raw, "BTC/USD") if btc_df_raw is not None else None

    for symbol in symbols:
        df = load_ohlcv(symbol)
        if df is None or len(df) < 500:
            logger.warning(f"Skipping {symbol}: insufficient data (need to run download_historical_data.py first)")
            continue

        df = _enforce_training_cutoff(df, symbol)
        X, y = build_features_and_target(df, btc_df=btc_df_train)

        if len(X) < 200:
            logger.warning(f"Skipping {symbol}: only {len(X)} feature rows after cutoff")
            continue

        X_all.append(X)
        y_all.append(y)
        logger.info(f"  {symbol}: {len(X)} samples, class balance = {y.mean():.1%} positive")

    if not X_all:
        raise RuntimeError("No training data available. Run download_historical_data.py first.")

    X_combined = pd.concat(X_all, axis=0)
    y_combined = pd.concat(y_all, axis=0)

    # Sort by datetime index to preserve temporal order
    sort_idx = X_combined.index.argsort()
    X_combined = X_combined.iloc[sort_idx]
    y_combined = y_combined.iloc[sort_idx]

    logger.info(f"Combined dataset: {X_combined.shape} | positive rate: {y_combined.mean():.1%}")
    return X_combined, y_combined


# ─── Walk-forward cross-validation ───────────────────────────────────────────

def walk_forward_auc(X: pd.DataFrame, y: pd.Series, n_splits: int = None) -> float:
    """
    Compute mean AUC using TimeSeriesSplit.
    NEVER uses shuffle. Each fold trains on past, validates on future.

    Returns:
        mean AUC across folds.
    """
    n_splits = n_splits or config.WF_N_SPLITS
    tscv = TimeSeriesSplit(n_splits=n_splits)
    model = XGBClassifier(**config.XGB_PARAMS)

    fold_aucs = []
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X), 1):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
        proba = model.predict_proba(X_val)[:, 1]
        fold_auc = roc_auc_score(y_val, proba)
        fold_aucs.append(fold_auc)
        logger.info(f"  Fold {fold}/{n_splits}: AUC = {fold_auc:.4f} (val size: {len(y_val)})")

    mean_auc = float(np.mean(fold_aucs))
    std_auc  = float(np.std(fold_aucs))
    logger.info(f"  Walk-forward AUC: {mean_auc:.4f} ± {std_auc:.4f}")
    return mean_auc


def walk_forward_auc_lgb(X: pd.DataFrame, y: pd.Series, n_splits: int = None) -> float:
    """
    Compute mean AUC for LightGBM using TimeSeriesSplit.
    NEVER uses shuffle. Each fold trains on past, validates on future.

    Returns:
        mean AUC across folds.
    """
    n_splits = n_splits or config.WF_N_SPLITS
    tscv = TimeSeriesSplit(n_splits=n_splits)
    model = LGBMClassifier(**config.LGB_PARAMS)

    fold_aucs = []
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X), 1):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)])
        proba = model.predict_proba(X_val)[:, 1]
        fold_auc = roc_auc_score(y_val, proba)
        fold_aucs.append(fold_auc)
        logger.info(f"  [LGB] Fold {fold}/{n_splits}: AUC = {fold_auc:.4f} (val size: {len(y_val)})")

    mean_auc = float(np.mean(fold_aucs))
    std_auc  = float(np.std(fold_aucs))
    logger.info(f"  [LGB] Walk-forward AUC: {mean_auc:.4f} ± {std_auc:.4f}")
    return mean_auc


def load_lgb_model():
    """Load the current LightGBM production model from disk."""
    path = config.CURRENT_LGB_MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"No LGB model found at {path}. Run: python scripts/train_model.py"
        )
    with open(path, "rb") as f:
        return pickle.load(f)


# ─── Model training ───────────────────────────────────────────────────────────

def train_model(symbols: list = None, version_tag: str = None) -> dict:
    """
    Full training pipeline (XGBoost + LightGBM dual-model):
    1. Build dataset (enforcing training cutoff)
    2. Walk-forward cross-validation for BOTH models
    3. Final fit on all training data for BOTH models
    4. Save both models only if BOTH AUC scores >= 0.55

    Returns:
        dict with keys: version_tag, file_path, auc_score, wf_auc_mean, lgb_wf_auc, accepted
    """
    logger.info("=" * 50)
    logger.info("Starting XGBoost + LightGBM dual-model training")
    logger.info(f"  Training window: {config.TRAIN_START_DATE} → {config.TRAIN_END_DATE}")
    logger.info(f"  Simulation window starts: {config.SIMULATION_START_DATE}")
    logger.info("=" * 50)

    X, y = build_training_dataset(symbols)

    # Walk-forward validation — XGBoost
    logger.info(f"Running {config.WF_N_SPLITS}-fold walk-forward validation (XGBoost)...")
    xgb_wf_auc = walk_forward_auc(X, y)

    # Walk-forward validation — LightGBM
    logger.info(f"Running {config.WF_N_SPLITS}-fold walk-forward validation (LightGBM)...")
    lgb_wf_auc = walk_forward_auc_lgb(X, y)

    # Both must clear 0.55 to be accepted
    accepted = (xgb_wf_auc >= 0.55) and (lgb_wf_auc >= 0.55)
    rejection_reason = None if accepted else (
        f"XGB AUC {xgb_wf_auc:.4f} < 0.55" if xgb_wf_auc < 0.55 else
        f"LGB AUC {lgb_wf_auc:.4f} < 0.55"
    )

    # Final XGBoost model on full training set
    logger.info("Training final XGBoost model on full training dataset...")
    final_xgb = XGBClassifier(**config.XGB_PARAMS)
    final_xgb.fit(X, y, verbose=False)

    # In-sample AUC (informational only)
    train_proba = final_xgb.predict_proba(X)[:, 1]
    train_auc = roc_auc_score(y, train_proba)
    logger.info(f"  XGB in-sample AUC: {train_auc:.4f} (walk-forward: {xgb_wf_auc:.4f})")

    # Final LightGBM model on full training set
    logger.info("Training final LightGBM model on full training dataset...")
    final_lgb = LGBMClassifier(**config.LGB_PARAMS)
    final_lgb.fit(X, y, eval_set=[(X, y)])

    # Version tag
    if version_tag is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        version_tag = f"xgb_v_{ts}"

    # Always save the versioned XGB file for inspection
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = config.MODELS_DIR / f"{version_tag}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump(final_xgb, f)

    result = {
        "version_tag": version_tag,
        "file_path": str(model_path),
        "train_start": config.TRAIN_START_DATE,
        "train_end": config.TRAIN_END_DATE,
        "auc_score": round(train_auc, 6),
        "wf_auc_mean": round(xgb_wf_auc, 6),
        "lgb_wf_auc": round(lgb_wf_auc, 6),
        "features_used": json.dumps(FEATURE_NAMES),
        "xgb_params": json.dumps(config.XGB_PARAMS),
        "accepted": accepted,
        "rejection_reason": rejection_reason,
        "is_current": accepted,
        "notes": f"Trained on {len(X)} samples across {len(symbols or config.WATCHLIST)} coins",
    }

    if accepted:
        # Update current XGB model
        current_xgb = config.CURRENT_MODEL_PATH
        with open(model_path, "rb") as src, open(current_xgb, "wb") as dst:
            dst.write(src.read())
        logger.info(f"  XGB model saved: {model_path}")
        logger.info(f"  XGB current model updated: {current_xgb}")

        # Save current LGB model
        lgb_path = config.CURRENT_LGB_MODEL_PATH
        with open(lgb_path, "wb") as f:
            pickle.dump(final_lgb, f)
        logger.info(f"  LGB model saved: {lgb_path}")
    else:
        logger.warning(
            f"  Models NOT accepted ({rejection_reason}). XGB saved for inspection: {model_path}"
        )

    # Persist to database
    try:
        save_model_version(result)
    except Exception as e:
        logger.warning(f"Could not save model version to DB: {e}")

    logger.info("=" * 50)
    if accepted:
        logger.info(f"  RESULT: ACCEPTED — {version_tag}")
        logger.info(f"  XGB walk-forward AUC: {xgb_wf_auc:.4f}")
        logger.info(f"  LGB walk-forward AUC: {lgb_wf_auc:.4f}")
        logger.info(f"  Ready for Phase 5b walk-forward simulation")
    else:
        logger.warning(f"  RESULT: REJECTED — {rejection_reason}")
        logger.warning(f"  Review features or collect more data before proceeding")
    logger.info("=" * 50)

    return result


def load_current_model():
    """Load the current production model from disk."""
    path = config.CURRENT_MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"No current model found at {path}. Run: python scripts/train_model.py"
        )
    with open(path, "rb") as f:
        return pickle.load(f)
