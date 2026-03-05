"""
src/ml/feature_engineering.py — Technical indicators and feature matrix construction.

All features are computed on raw OHLCV data. No future data is used.
Target: binary — does the coin go up >PREDICTION_THRESHOLD_PCT in next PREDICTION_HORIZON_HOURS?
"""

import numpy as np
import pandas as pd
from loguru import logger
from typing import Optional

import config


# ─── Indicator helpers ────────────────────────────────────────────────────────

def rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger_bands(series: pd.Series, period=20, std_dev=2.0):
    mid = series.rolling(period).mean()
    std = series.rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    pct_b = (series - lower) / (upper - lower).replace(0, np.nan)
    width = (upper - lower) / mid.replace(0, np.nan)
    return pct_b, width


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period=14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def roc(series: pd.Series, periods: int) -> pd.Series:
    """Rate of change as a fraction: (current - prev) / prev"""
    return series.pct_change(periods=periods)


# ─── Feature matrix builder ───────────────────────────────────────────────────

FEATURE_NAMES = [
    "rsi_7", "rsi_14",
    "macd_line", "macd_hist",
    "bb_pct_b", "bb_width",
    "atr_norm",                     # ATR / close (normalised)
    "ema9_cross_ema21",             # 1 if ema9 > ema21, else 0
    "ema21_cross_ema55",
    "volume_ratio",                 # volume / 20-period avg volume
    "roc_1h", "roc_4h", "roc_24h",
    "hour_sin", "hour_cos",         # cyclical encoding of hour-of-day
    "dow_sin", "dow_cos",           # cyclical encoding of day-of-week
    "close_vs_ema9",                # (close - ema9) / close
    "close_vs_ema21",
    "close_vs_ema55",
    "high_low_range",               # (high - low) / close
    "body_ratio",                   # |open-close| / (high-low)
    "btc_prev_day_return",          # yesterday's BTC daily close return (market context)
]


def build_features(df: pd.DataFrame, btc_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """
    Compute all features from an OHLCV DataFrame.

    Args:
        df:     DataFrame with columns [open, high, low, close, volume], UTC datetime index.
        btc_df: Optional BTC/USD DataFrame used to compute btc_prev_day_return.
                If None, btc_prev_day_return is set to 0.

    Returns:
        DataFrame with FEATURE_NAMES columns. NaN rows (warm-up period) are dropped.
    """
    c = df["close"]
    h = df["high"]
    l = df["low"]
    o = df["open"]
    v = df["volume"]

    feat = pd.DataFrame(index=df.index)

    # Momentum
    feat["rsi_7"]  = rsi(c, 7)
    feat["rsi_14"] = rsi(c, 14)

    macd_l, macd_s, macd_h = macd(c)
    feat["macd_line"] = macd_l / c          # normalise by price
    feat["macd_hist"] = macd_h / c

    # Volatility / Bollinger
    feat["bb_pct_b"], feat["bb_width"] = bollinger_bands(c)

    # ATR normalised
    atr14 = atr(h, l, c, 14)
    feat["atr_norm"] = atr14 / c

    # EMA crossovers
    ema9  = ema(c, 9)
    ema21 = ema(c, 21)
    ema55 = ema(c, 55)
    feat["ema9_cross_ema21"]  = (ema9 > ema21).astype(int)
    feat["ema21_cross_ema55"] = (ema21 > ema55).astype(int)

    # Price vs EMA
    feat["close_vs_ema9"]  = (c - ema9)  / c
    feat["close_vs_ema21"] = (c - ema21) / c
    feat["close_vs_ema55"] = (c - ema55) / c

    # Volume (20-period ratio — original feature)
    vol_avg = v.rolling(20).mean()
    feat["volume_ratio"] = v / vol_avg.replace(0, np.nan)

    # Rate of change
    feat["roc_1h"]  = roc(c, 1)
    feat["roc_4h"]  = roc(c, 4)
    feat["roc_24h"] = roc(c, 24)

    # Candle shape
    feat["high_low_range"] = (h - l) / c
    body = (o - c).abs()
    candle_range = (h - l).replace(0, np.nan)
    feat["body_ratio"] = body / candle_range

    # Cyclical time features
    hour = df.index.hour
    dow  = df.index.dayofweek
    feat["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    feat["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    feat["dow_sin"]  = np.sin(2 * np.pi * dow / 7)
    feat["dow_cos"]  = np.cos(2 * np.pi * dow / 7)

    # BTC previous day return (market context, no look-ahead: shift(1) uses prior day)
    if btc_df is not None and len(btc_df) > 2:
        try:
            btc_daily = btc_df["close"].resample("D").last().dropna()
            btc_daily_ret = btc_daily.pct_change().shift(1)  # prev day's return, no look-ahead
            feat["btc_prev_day_return"] = btc_daily_ret.reindex(df.index, method="ffill")
        except Exception:
            feat["btc_prev_day_return"] = 0.0
    else:
        feat["btc_prev_day_return"] = 0.0

    # Ensure column order matches FEATURE_NAMES
    feat = feat[FEATURE_NAMES]

    # Drop NaN rows from indicator warm-up (e.g. EMA55 needs 55 candles)
    initial_len = len(feat)
    feat = feat.dropna()
    dropped = initial_len - len(feat)
    if dropped > 0:
        logger.debug(f"Dropped {dropped} NaN rows (indicator warm-up)")

    return feat


def build_target(df: pd.DataFrame, features_index: pd.DatetimeIndex) -> pd.Series:
    """
    Build binary classification target: 1 if close rises >THRESHOLD in next HORIZON hours.

    Uses only rows that are in features_index (aligned after dropna).
    Drops the last HORIZON rows (no future data available for them).
    """
    horizon = config.PREDICTION_HORIZON_HOURS
    threshold = config.PREDICTION_THRESHOLD_PCT

    close = df["close"].reindex(features_index)
    future_close = close.shift(-horizon)
    target = ((future_close - close) / close > threshold).astype(int)

    # Drop last `horizon` rows where future is unknown
    target = target.iloc[:-horizon]

    return target


def build_features_and_target(df: pd.DataFrame, btc_df: Optional[pd.DataFrame] = None):
    """
    Convenience function: returns (X, y) aligned DataFrames ready for training.

    Args:
        df:     Coin OHLCV DataFrame.
        btc_df: Optional BTC DataFrame for btc_prev_day_return feature.
    """
    X = build_features(df, btc_df=btc_df)
    y = build_target(df, X.index)
    # Align X to y (remove last horizon rows from X)
    X = X.loc[y.index]
    logger.info(f"Feature matrix: {X.shape}, target distribution: {y.value_counts().to_dict()}")
    return X, y


def get_current_features(df: pd.DataFrame, btc_df: Optional[pd.DataFrame] = None) -> pd.Series:
    """
    Build features for the most recent candle (for live prediction).
    Returns a single-row Series.

    Args:
        df:     Coin OHLCV DataFrame (sliced to data available now).
        btc_df: Optional BTC DataFrame for btc_prev_day_return feature.
    """
    feat = build_features(df, btc_df=btc_df)
    return feat.iloc[-1]
