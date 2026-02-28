"""
arfour — Ticker Data Service

Loads ~8000+ US-listed securities from NASDAQ public data files at startup.
Provides fast in-memory search for the frontend autocomplete.
"""

import logging
import re
import urllib.request
from typing import Optional

log = logging.getLogger(__name__)

# Module-level data stores (populated by load_ticker_data)
_ticker_list: list[dict[str, str]] = []  # sorted list of {ticker, name}
_ticker_map: dict[str, str] = {}  # ticker -> name lookup

# NASDAQ public data file URLs (pipe-delimited, updated daily, no API key)
_NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
_OTHER_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"

# Suffixes to strip from security names for cleaner display
_NAME_SUFFIXES = [
    " - Common Stock",
    " - Class A Common Stock",
    " - Class B Common Stock",
    " - Class C Common Stock",
    " - Class A Ordinary Shares",
    " - Class B Ordinary Shares",
    " - Ordinary Shares",
    " - American Depositary Shares",
    " - American Depositary Shares each representing",
    " Common Stock",
    " Ordinary Shares",
]

# Symbols with these chars are warrants, units, etc. — skip them
_SKIP_SYMBOL_RE = re.compile(r"[+$/ ]")


def _clean_name(raw_name: str) -> str:
    """Strip common suffixes from security names for cleaner display."""
    name = raw_name.strip()
    for suffix in _NAME_SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    # Also strip trailing commas and "Inc" artifacts
    name = name.rstrip(",").strip()
    return name


def _fetch_nasdaq_listed() -> dict[str, str]:
    """Fetch NASDAQ-listed securities. Returns {ticker: name}."""
    result: dict[str, str] = {}
    try:
        with urllib.request.urlopen(_NASDAQ_URL, timeout=10) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        lines = text.strip().split("\n")
        # First line is header, last line is footer (starts with "File Creation Time")
        for line in lines[1:]:
            if line.startswith("File Creation Time"):
                break
            parts = line.split("|")
            if len(parts) < 2:
                continue
            symbol = parts[0].strip()
            name = parts[1].strip()
            # Skip test issues
            if len(parts) > 6 and parts[6].strip() == "Y":
                continue
            if not symbol or _SKIP_SYMBOL_RE.search(symbol):
                continue
            result[symbol] = _clean_name(name)
        log.info("Fetched %d NASDAQ-listed tickers", len(result))
    except Exception as e:
        log.warning("Failed to fetch NASDAQ-listed tickers: %s", e)
    return result


def _fetch_other_listed() -> dict[str, str]:
    """Fetch NYSE/AMEX/other-listed securities. Returns {ticker: name}."""
    result: dict[str, str] = {}
    try:
        with urllib.request.urlopen(_OTHER_URL, timeout=10) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        lines = text.strip().split("\n")
        # First line is header, last line is footer
        for line in lines[1:]:
            if line.startswith("File Creation Time"):
                break
            parts = line.split("|")
            if len(parts) < 2:
                continue
            # otherlisted.txt: columns are ACT Symbol | Security Name | Exchange | ...
            symbol = parts[0].strip()
            name = parts[1].strip()
            # Skip test issues (column index 5 in otherlisted.txt)
            if len(parts) > 5 and parts[5].strip() == "Y":
                continue
            if not symbol or _SKIP_SYMBOL_RE.search(symbol):
                continue
            result[symbol] = _clean_name(name)
        log.info("Fetched %d other-listed tickers", len(result))
    except Exception as e:
        log.warning("Failed to fetch other-listed tickers: %s", e)
    return result


def load_ticker_data() -> None:
    """
    Load ticker data from NASDAQ files, merging with hardcoded fallback.
    Called once at server startup.
    """
    global _ticker_list, _ticker_map

    # Import hardcoded tickers as fallback
    from intake import TICKER_LOOKUP

    # Fetch from NASDAQ
    nasdaq = _fetch_nasdaq_listed()
    other = _fetch_other_listed()

    # Build merged map: NASDAQ data first, then other, then hardcoded overrides
    merged: dict[str, str] = {}
    merged.update(nasdaq)
    merged.update(other)
    # Hardcoded entries take precedence (curated names are cleaner)
    merged.update(TICKER_LOOKUP)

    if not merged:
        # Both fetches failed and somehow TICKER_LOOKUP is empty — shouldn't happen
        log.error("No ticker data available at all")
        return

    _ticker_map = merged
    _ticker_list = sorted(
        [{"ticker": t, "name": n} for t, n in merged.items()],
        key=lambda x: x["ticker"],
    )

    fetched_count = len(nasdaq) + len(other)
    log.info(
        "Ticker data loaded: %d entries (%d fetched + %d hardcoded fallback)",
        len(_ticker_list),
        fetched_count,
        len(TICKER_LOOKUP),
    )


def search_tickers(query: str, limit: int = 8) -> list[dict[str, str]]:
    """
    Search tickers by query string. Scoring priority:
    1. Exact ticker match
    2. Ticker starts with query
    3. Name contains query (case-insensitive)

    Returns list of {ticker, name} dicts, up to `limit` results.
    """
    if not query or not _ticker_list:
        return []

    q_upper = query.upper().strip()
    q_lower = query.lower().strip()

    exact: list[dict[str, str]] = []
    prefix: list[dict[str, str]] = []
    name_match: list[dict[str, str]] = []

    for entry in _ticker_list:
        ticker = entry["ticker"]
        name = entry["name"]

        if ticker == q_upper:
            exact.append(entry)
        elif ticker.startswith(q_upper):
            prefix.append(entry)
        elif q_lower in name.lower():
            name_match.append(entry)

    # Combine in priority order, deduplicate
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for bucket in (exact, prefix, name_match):
        for entry in bucket:
            if entry["ticker"] not in seen:
                seen.add(entry["ticker"])
                results.append(entry)
                if len(results) >= limit:
                    return results

    return results


def get_ticker_name(ticker: str) -> Optional[str]:
    """Look up a single ticker's company name. Returns None if not found."""
    return _ticker_map.get(ticker.upper())
