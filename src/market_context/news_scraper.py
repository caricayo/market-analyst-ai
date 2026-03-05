"""
src/market_context/news_scraper.py — RSS news feed aggregator.

Fetches headlines from CoinDesk + CryptoPanic and checks for block keywords.
"""

import feedparser
from loguru import logger
import config


def fetch_headlines(max_headlines: int = None) -> list[str]:
    """
    Fetch top headlines from all configured RSS feeds.

    Returns:
        List of headline strings (titles only).
    """
    max_h = max_headlines or config.NEWS_MAX_HEADLINES
    headlines = []

    for url in config.NEWS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:max_h]:
                title = entry.get("title", "").strip()
                if title:
                    headlines.append(title)
        except Exception as e:
            logger.warning(f"RSS fetch failed for {url}: {e}")

    # Deduplicate and trim
    seen = set()
    unique = []
    for h in headlines:
        key = h.lower()[:60]
        if key not in seen:
            seen.add(key)
            unique.append(h)

    return unique[:max_h]


def check_block_keywords(headlines: list[str]) -> tuple[bool, list[str]]:
    """
    Check if any headline contains a block keyword.

    Returns:
        (should_block, list of matching headlines)
    """
    matches = []
    for headline in headlines:
        hl_lower = headline.lower()
        for kw in config.NEWS_BLOCK_KEYWORDS:
            if kw.lower() in hl_lower:
                matches.append(f"[{kw}] {headline}")
                break

    return bool(matches), matches
