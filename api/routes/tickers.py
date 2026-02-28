"""
arfour — Ticker Lookup Route

Serves the full ticker lookup table for frontend autocomplete.
"""

import sys
from pathlib import Path
from fastapi import APIRouter

# Ensure project root is in path
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from intake import TICKER_LOOKUP

router = APIRouter()


@router.get("/api/tickers")
async def get_tickers():
    """Return the full ticker lookup table for autocomplete."""
    tickers = [
        {"ticker": ticker, "name": name}
        for ticker, name in TICKER_LOOKUP.items()
    ]
    return {"tickers": tickers, "count": len(tickers)}
