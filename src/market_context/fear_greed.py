"""
src/market_context/fear_greed.py — Fetch Crypto Fear & Greed Index from alternative.me.

No API key required. Free tier.
"""

import time
import requests
from loguru import logger

_ENDPOINT = "https://api.alternative.me/fng/"
_RETRY_MAX = 3
_BACKOFF_BASE = 2.0


def fetch_fear_greed() -> dict:
    """
    Returns:
        dict with keys: value (int), label (str), timestamp (str)
        e.g. {"value": 45, "label": "Fear", "timestamp": "2024-01-15"}

    Raises:
        RuntimeError on all retries exhausted.
    """
    for attempt in range(_RETRY_MAX):
        try:
            resp = requests.get(_ENDPOINT, params={"limit": 1}, timeout=10)
            resp.raise_for_status()
            data = resp.json()["data"][0]
            return {
                "value": int(data["value"]),
                "label": data["value_classification"],
                "timestamp": data["timestamp"],
            }
        except Exception as e:
            wait = _BACKOFF_BASE ** attempt
            logger.warning(f"Fear/Greed fetch failed (attempt {attempt+1}): {e} — retry in {wait:.0f}s")
            time.sleep(wait)

    raise RuntimeError(f"Failed to fetch Fear/Greed after {_RETRY_MAX} attempts")


def is_market_extreme(fear_greed_value: int) -> tuple[bool, str]:
    """
    Returns (should_block, reason).
    Blocks if extreme fear (< FEAR_GREED_MIN) or extreme greed (> FEAR_GREED_MAX).
    """
    import config
    if fear_greed_value < config.FEAR_GREED_MIN:
        return True, f"Extreme fear ({fear_greed_value}) — below min threshold {config.FEAR_GREED_MIN}"
    if fear_greed_value > config.FEAR_GREED_MAX:
        return True, f"Extreme greed ({fear_greed_value}) — above max threshold {config.FEAR_GREED_MAX}"
    return False, ""
