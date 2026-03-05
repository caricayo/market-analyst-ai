"""
src/market_context/btc_dominance.py — Fetch BTC dominance and global market data from CoinGecko.

Implements rate limit handler with exponential backoff.
"""

import time
import requests
from loguru import logger
import config


def _coingecko_get(endpoint: str, params: dict = None) -> dict:
    """GET from CoinGecko with retry + exponential backoff."""
    url = f"{config.COINGECKO_BASE_URL}{endpoint}"
    headers = {}
    if hasattr(config, "COINGECKO_API_KEY") and config.COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = config.COINGECKO_API_KEY

    for attempt in range(config.COINGECKO_RETRY_MAX):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
            if resp.status_code == 429:
                wait = config.COINGECKO_RETRY_BACKOFF_BASE ** (attempt + 1)
                logger.warning(f"CoinGecko rate limit (attempt {attempt+1}) — waiting {wait:.0f}s")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError as e:
            if attempt < config.COINGECKO_RETRY_MAX - 1:
                wait = config.COINGECKO_RETRY_BACKOFF_BASE ** attempt
                logger.warning(f"CoinGecko HTTP error: {e} — retry in {wait:.0f}s")
                time.sleep(wait)
            else:
                raise

    raise RuntimeError(f"CoinGecko request failed after {config.COINGECKO_RETRY_MAX} attempts")


def fetch_global_data() -> dict:
    """
    Returns:
        dict with keys:
          btc_dominance_pct (float)
          total_market_cap_usd (float)
          market_cap_change_24h_pct (float)
    """
    data = _coingecko_get("/global")["data"]
    return {
        "btc_dominance_pct":       round(data["market_cap_percentage"]["btc"], 2),
        "total_market_cap_usd":    data["total_market_cap"]["usd"],
        "market_cap_change_24h_pct": round(data["market_cap_change_percentage_24h_usd"] / 100, 4),
    }


def is_market_cap_crashing(change_24h_pct: float) -> tuple[bool, str]:
    """Returns (should_block, reason) if market cap dropped more than threshold."""
    if change_24h_pct <= config.MARKET_CAP_DROP_BLOCK_PCT:
        return True, (
            f"Market cap down {change_24h_pct:.1%} in 24h "
            f"(threshold: {config.MARKET_CAP_DROP_BLOCK_PCT:.0%})"
        )
    return False, ""
