"""
src/ml/predictor.py — Live signal generation from the trained model.

Returns confidence scores for all watchlist coins and filters by MIN_MODEL_CONFIDENCE.
"""

import pandas as pd
from loguru import logger
from typing import Optional

import config
from src.ml.trainer import load_current_model, load_lgb_model
from src.ml.feature_engineering import get_current_features, build_features, FEATURE_NAMES
from src.ml.data_fetcher import load_ohlcv, update_ohlcv


_model = None
_lgb_model = None


def _get_model():
    global _model
    if _model is None:
        _model = load_current_model()
    return _model


def _get_lgb_model():
    global _lgb_model
    if _lgb_model is None:
        _lgb_model = load_lgb_model()
    return _lgb_model


def reload_model():
    """Force reload of both models from disk (called after retraining)."""
    global _model, _lgb_model
    _model = load_current_model()
    _lgb_model = load_lgb_model()
    logger.info("Models reloaded from disk (XGB + LGB)")


def predict_symbol(
    symbol: str,
    df: Optional[pd.DataFrame] = None,
    btc_df: Optional[pd.DataFrame] = None,
) -> dict:
    """
    Generate a prediction for a single symbol.

    Args:
        symbol: e.g. "BTC/USD"
        df:     OHLCV DataFrame. If None, loads from disk.
        btc_df: BTC/USD DataFrame for btc_prev_day_return feature.

    Returns:
        dict with keys: symbol, confidence, signal (True/False), current_price, atr
    """
    if df is None:
        df = load_ohlcv(symbol)
        if df is None:
            raise FileNotFoundError(f"No data for {symbol}. Run download_historical_data.py first.")

    if len(df) < 200:
        raise ValueError(f"Insufficient data for {symbol}: {len(df)} rows")

    features = get_current_features(df, btc_df=btc_df)
    xgb_model = _get_model()
    lgb_model  = _get_lgb_model()

    X = pd.DataFrame([features[FEATURE_NAMES]], columns=FEATURE_NAMES)
    xgb_proba = float(xgb_model.predict_proba(X)[0][1])
    lgb_proba  = float(lgb_model.predict_proba(X)[0][1])
    avg_proba  = (xgb_proba + lgb_proba) / 2.0

    # ATR for risk sizing
    import math
    from src.ml.feature_engineering import atr
    atr14 = atr(df["high"], df["low"], df["close"], 14).iloc[-1]
    current_price = float(df["close"].iloc[-1])

    if math.isnan(float(atr14)) or float(atr14) <= 0:
        raise ValueError(f"Invalid ATR ({atr14}) for {symbol} — insufficient warm-up data or zero volatility")

    # Apply coin-specific confidence threshold; both models must individually agree
    min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)
    signal = (xgb_proba >= min_conf) and (lgb_proba >= min_conf)

    return {
        "symbol":          symbol,
        "confidence":      round(avg_proba, 4),
        "xgb_confidence":  round(xgb_proba, 4),
        "lgb_confidence":  round(lgb_proba, 4),
        "signal":          signal,
        "current_price":   current_price,
        "atr":             round(float(atr14), 6),
        "timestamp":       df.index[-1],
    }


def score_watchlist(update_data: bool = False) -> list[dict]:
    """
    Score all watchlist coins. Returns sorted list (highest confidence first).
    Applies per-coin confidence thresholds (COIN_MIN_CONFIDENCE in config).

    Args:
        update_data: If True, fetches latest candles before scoring.
    """
    # Load BTC once for the btc_prev_day_return feature (None is safe — feature defaults to 0)
    try:
        btc_df = load_ohlcv("BTC/USD")
    except Exception as e:
        logger.warning(f"Could not load BTC/USD for btc_prev_day_return feature: {e}")
        btc_df = None

    results = []
    for symbol in config.WATCHLIST:
        try:
            if update_data:
                df = update_ohlcv(symbol)
            else:
                df = load_ohlcv(symbol)

            pred = predict_symbol(symbol, df, btc_df=btc_df)
            results.append(pred)
            min_conf = getattr(config, "COIN_MIN_CONFIDENCE", {}).get(symbol, config.MIN_MODEL_CONFIDENCE)
            status = "SIGNAL" if pred["signal"] else "skip"
            logger.info(f"  {symbol}: {pred['confidence']:.1%} confidence (min {min_conf:.0%}) → {status}")
        except Exception as e:
            logger.error(f"  {symbol}: prediction failed — {e}")
            results.append({
                "symbol": symbol,
                "confidence": 0.0,
                "signal": False,
                "error": str(e),
            })

    # Sort by confidence descending
    results.sort(key=lambda x: x["confidence"], reverse=True)
    signals = [r for r in results if r.get("signal")]
    logger.info(f"Scoring complete: {len(signals)}/{len(config.WATCHLIST)} coins above their respective thresholds")
    return results
