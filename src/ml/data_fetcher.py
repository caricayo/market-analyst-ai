"""
src/ml/data_fetcher.py — Download and update OHLCV historical data.

Primary data source: CryptoCompare histohour API.
  - Free, no API key required, no geo-restrictions.
  - 2000 candles per request, data back to coin launch.
  - Symbols: BTC/USD -> fsym=BTC&tsym=USD.

Live prices during trading still come from Coinbase (see exchange/client.py).
ccxt is kept for live price fetching only (via ExchangeClient.get_current_price).
"""

import time
import math
import requests
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

import ccxt
import pandas as pd
import numpy as np
from loguru import logger

import config

# yfinance import is lazy (only used as fallback for live updates if CC fails)
_yf = None


def _get_yf():
    global _yf
    if _yf is None:
        import yfinance as yf
        _yf = yf
    return _yf


# ─── CryptoCompare API ────────────────────────────────────────────────────────

_CC_BASE = "https://min-api.cryptocompare.com/data/v2/histohour"
_CC_PAGE_SIZE = 2000   # max per request
_CC_RETRY_MAX = 4
_CC_BACKOFF = 2.0


def _parse_symbol(symbol: str):
    """'BTC/USD' -> ('BTC', 'USD')"""
    return symbol.split("/")


def fetch_ohlcv_cryptocompare(
    symbol: str,
    since_dt: Optional[datetime] = None,
    until_dt: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Fetch hourly OHLCV from CryptoCompare.
    Paginates backward in time from until_dt to since_dt.

    Returns DataFrame with columns [open, high, low, close, volume], UTC datetime index.
    """
    base, quote = _parse_symbol(symbol)
    since_dt = since_dt or (datetime.now(timezone.utc) - timedelta(days=730))
    until_dt = until_dt or datetime.now(timezone.utc)

    since_ts = int(since_dt.timestamp())
    until_ts = int(until_dt.timestamp())

    logger.info(f"Fetching {symbol} from CryptoCompare: {since_dt.date()} to {until_dt.date()}")

    all_rows = []
    to_ts = until_ts  # We page backward from here

    while True:
        params = {
            "fsym": base,
            "tsym": quote,
            "limit": _CC_PAGE_SIZE,
            "toTs": to_ts,
        }

        for attempt in range(_CC_RETRY_MAX):
            try:
                resp = requests.get(_CC_BASE, params=params, timeout=20)
                resp.raise_for_status()
                break
            except Exception as e:
                if attempt < _CC_RETRY_MAX - 1:
                    wait = _CC_BACKOFF ** attempt
                    logger.warning(f"CryptoCompare retry {attempt+1}: {e} - waiting {wait:.0f}s")
                    time.sleep(wait)
                else:
                    raise RuntimeError(f"CryptoCompare failed after {_CC_RETRY_MAX} attempts: {e}") from e

        data = resp.json()
        if data.get("Response") != "Success":
            raise ValueError(f"CryptoCompare error: {data.get('Message', 'unknown')}")

        candles = data["Data"]["Data"]
        if not candles:
            break

        all_rows.extend(candles)

        earliest_ts = candles[0]["time"]
        if earliest_ts <= since_ts or len(candles) < _CC_PAGE_SIZE:
            break

        to_ts = earliest_ts - 1
        time.sleep(0.1)  # gentle

    if not all_rows:
        raise ValueError(f"No data returned from CryptoCompare for {symbol}")

    df = pd.DataFrame(all_rows)
    df["datetime"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("datetime")
    df = df.rename(columns={
        "open": "open", "high": "high", "low": "low",
        "close": "close", "volumefrom": "volume"
    })
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    df.sort_index(inplace=True)

    # Trim to requested window
    df = df[df.index >= pd.Timestamp(since_dt)]
    df = df[df.index <= pd.Timestamp(until_dt)]

    # Drop zero-price candles (missing data)
    df = df[df["close"] > 0]

    logger.info(f"  {len(df)} candles from CryptoCompare for {symbol}")
    return df


# ─── ccxt helpers (kept for live price use by ExchangeClient) ─────────────────

def _build_exchange() -> ccxt.Exchange:
    """Coinbase public client — only used for live price queries."""
    return ccxt.coinbase({
        "rateLimit": 150,
        "enableRateLimit": True,
    })


def _symbol_to_filename(symbol: str) -> str:
    """BTC/USDT → BTC_USDT.csv"""
    return symbol.replace("/", "_") + ".csv"


def _parse_ohlcv(raw: list) -> pd.DataFrame:
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.set_index("datetime").drop(columns=["timestamp"])
    df = df.astype(float)
    df.sort_index(inplace=True)
    return df


def fetch_ohlcv_ccxt(
    symbol: str,
    timeframe: str = "1h",
    since_dt: Optional[datetime] = None,
    until_dt: Optional[datetime] = None,
    exchange: Optional[ccxt.Exchange] = None,
) -> pd.DataFrame:
    """
    Fetch OHLCV from ccxt with pagination (handles 300-candle limit).

    Args:
        symbol:     ccxt symbol e.g. "BTC/USDT"
        timeframe:  "1h", "4h", etc.
        since_dt:   Start datetime (UTC). Defaults to 2 years ago.
        until_dt:   End datetime (UTC). Defaults to now.
        exchange:   Reuse an existing exchange instance.

    Returns:
        DataFrame with columns [open, high, low, close, volume], UTC datetime index.
    """
    if exchange is None:
        exchange = _build_exchange()

    if since_dt is None:
        since_dt = datetime.now(timezone.utc) - timedelta(days=730)
    if until_dt is None:
        until_dt = datetime.now(timezone.utc)

    fetch_symbol = symbol  # Coinbase uses BTC/USD directly

    since_ms = int(since_dt.timestamp() * 1000)
    until_ms = int(until_dt.timestamp() * 1000)

    all_candles = []
    current_ms = since_ms
    PAGE_SIZE = 300
    retries = 0
    MAX_RETRIES = 5

    logger.info(f"Fetching {symbol} {timeframe} from {since_dt.date()} to {until_dt.date()}")

    while current_ms < until_ms:
        try:
            candles = exchange.fetch_ohlcv(
                fetch_symbol, timeframe, since=current_ms, limit=PAGE_SIZE
            )
        except (ccxt.RateLimitExceeded, ccxt.NetworkError) as e:
            retries += 1
            if retries > MAX_RETRIES:
                raise RuntimeError(f"ccxt fetch failed after {MAX_RETRIES} retries: {e}") from e
            wait = 2 ** retries
            logger.warning(f"Rate limit / network error: {e} - waiting {wait}s (retry {retries})")
            time.sleep(wait)
            continue
        except ccxt.BadSymbol:
            raise ValueError(f"Symbol '{fetch_symbol}' not available on exchange")

        retries = 0  # reset on success

        if not candles:
            break

        all_candles.extend(candles)

        last_ts = candles[-1][0]
        if last_ts >= until_ms or len(candles) < PAGE_SIZE:
            break

        # Advance cursor past last candle
        current_ms = last_ts + 1
        time.sleep(0.1)   # gentle rate limiting

    if not all_candles:
        raise ValueError(f"No OHLCV data returned for {symbol}")

    df = _parse_ohlcv(all_candles)
    # Trim to requested window
    df = df[df.index <= pd.Timestamp(until_dt)]
    logger.info(f"  → {len(df)} candles fetched for {symbol}")
    return df


def fetch_ohlcv_yfinance(
    symbol: str,
    since_dt: Optional[datetime] = None,
    until_dt: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Fallback: fetch OHLCV using yfinance.
    Converts ccxt symbol format (BTC/USDT) to Yahoo format (BTC-USD).
    """
    yf = _get_yf()

    # Map symbol to Yahoo format (BTC/USD → BTC-USD, BTC/USDT → BTC-USD)
    base, quote = symbol.split("/")
    yf_quote = "USD"   # Yahoo always uses USD
    yf_symbol = f"{base}-{yf_quote}"

    if since_dt is None:
        since_dt = datetime.now(timezone.utc) - timedelta(days=730)
    if until_dt is None:
        until_dt = datetime.now(timezone.utc)

    logger.info(f"yfinance fallback: fetching {yf_symbol}")
    ticker = yf.Ticker(yf_symbol)
    df = ticker.history(
        start=since_dt.strftime("%Y-%m-%d"),
        end=until_dt.strftime("%Y-%m-%d"),
        interval="1h",
        auto_adjust=True,
    )

    if df.empty:
        raise ValueError(f"yfinance returned no data for {yf_symbol}")

    df.index = df.index.tz_convert("UTC")
    df = df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                             "Close": "close", "Volume": "volume"})
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    df.sort_index(inplace=True)
    logger.info(f"  → {len(df)} candles via yfinance for {symbol}")
    return df


def fetch_ohlcv(
    symbol: str,
    since_dt: Optional[datetime] = None,
    until_dt: Optional[datetime] = None,
    timeframe: str = "1h",
    exchange=None,
) -> pd.DataFrame:
    """
    Fetch OHLCV: CryptoCompare primary → yfinance fallback.
    CryptoCompare has no geo-restrictions and provides data back to coin launch.
    """
    try:
        return fetch_ohlcv_cryptocompare(symbol, since_dt, until_dt)
    except Exception as e:
        logger.warning(f"CryptoCompare failed for {symbol}: {e}. Trying yfinance fallback...")
        return fetch_ohlcv_yfinance(symbol, since_dt, until_dt)


def check_gaps(df: pd.DataFrame, max_gap_hours: int = 3) -> list:
    """Return list of gap periods where consecutive candles are > max_gap_hours apart."""
    if len(df) < 2:
        return []
    diffs = df.index.to_series().diff().dropna()
    threshold = pd.Timedelta(hours=max_gap_hours)
    gaps = diffs[diffs > threshold]
    return [(str(ts), str(dur)) for ts, dur in gaps.items()]


def save_ohlcv(df: pd.DataFrame, symbol: str, output_dir: Path = None):
    """Save DataFrame to CSV in data/historical/."""
    output_dir = output_dir or config.HISTORICAL_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / _symbol_to_filename(symbol)
    df.to_csv(path)
    return path


def load_ohlcv(symbol: str, data_dir: Path = None) -> Optional[pd.DataFrame]:
    """Load OHLCV CSV for a symbol, or None if file doesn't exist."""
    data_dir = data_dir or config.HISTORICAL_DIR
    path = data_dir / _symbol_to_filename(symbol)
    if not path.exists():
        return None
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index, utc=True)
    return df


def update_ohlcv(symbol: str, exchange=None) -> pd.DataFrame:
    """
    Append new candles to an existing CSV, or create it if missing.
    Returns the full up-to-date DataFrame.
    """
    existing = load_ohlcv(symbol)

    if existing is not None and len(existing) > 0:
        last_dt = existing.index[-1].to_pydatetime()
        # Start slightly before last candle to avoid gaps
        since_dt = last_dt - timedelta(hours=2)
        logger.info(f"Updating {symbol}: last candle at {last_dt}, fetching from {since_dt.date()}")
        new_df = fetch_ohlcv(symbol, since_dt=since_dt, exchange=exchange)
        # Merge and deduplicate
        combined = pd.concat([existing, new_df])
        combined = combined[~combined.index.duplicated(keep="last")]
        combined.sort_index(inplace=True)
        df = combined
    else:
        since_dt = datetime.strptime(config.TRAIN_START_DATE, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        df = fetch_ohlcv(symbol, since_dt=since_dt, exchange=exchange)

    gaps = check_gaps(df)
    if gaps:
        logger.warning(f"{symbol}: {len(gaps)} data gaps found (max 3h threshold)")
        for ts, dur in gaps[:5]:
            logger.warning(f"  Gap at {ts}: {dur}")

    save_ohlcv(df, symbol)
    return df
