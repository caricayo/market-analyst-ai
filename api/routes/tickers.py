"""
arfour — Ticker Lookup Routes

Serves ticker search and full lookup table for frontend autocomplete.
"""

import sys
from pathlib import Path
from fastapi import APIRouter, Query

# Ensure project root is in path
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from api.services.ticker_data import search_tickers, _ticker_list
from intake import TICKER_LOOKUP

router = APIRouter()


@router.get("/api/tickers/search")
async def search(q: str = Query("", min_length=1), limit: int = Query(8, ge=1, le=50)):
    """Search tickers by symbol or company name. Returns top matches."""
    results = search_tickers(q, limit=limit)
    return {"results": results, "count": len(results)}


@router.get("/api/tickers")
async def get_tickers():
    """Return the full ticker list for backwards compatibility."""
    # Return loaded data if available, else fall back to hardcoded
    if _ticker_list:
        return {"tickers": _ticker_list, "count": len(_ticker_list)}
    tickers = [
        {"ticker": ticker, "name": name}
        for ticker, name in TICKER_LOOKUP.items()
    ]
    return {"tickers": tickers, "count": len(tickers)}
