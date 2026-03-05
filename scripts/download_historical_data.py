"""
scripts/download_historical_data.py — Download 2+ years of hourly OHLCV data for all watchlist coins.

Run: python scripts/download_historical_data.py

Output: CSVs in data/historical/ with 10,000+ rows each.
Displays a summary table on completion.
"""

import sys
import io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Windows cp1252 fix: force UTF-8 output
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from loguru import logger
import pandas as pd
import ccxt

import config
from src.ml.data_fetcher import update_ohlcv, check_gaps

logger.remove()
logger.add(sys.stderr, level="INFO", format="<green>{time:HH:mm:ss}</green> | {message}")


def main():
    print()
    print("=" * 60)
    print("  Downloading Historical OHLCV Data")
    print(f"  Coins:     {', '.join(config.WATCHLIST)}")
    print(f"  From:      {config.TRAIN_START_DATE}")
    print(f"  To:        today")
    print(f"  Timeframe: 1h")
    print("=" * 60)
    print()

    # CryptoCompare: free, no key, no geo-block, data back to coin launch
    results = []
    for symbol in config.WATCHLIST:
        print(f">> {symbol}")
        try:
            df = update_ohlcv(symbol)
            row_count = len(df)
            date_range = f"{df.index[0].date()} to {df.index[-1].date()}"
            gaps = check_gaps(df)
            gap_str = f"{len(gaps)} gaps" if gaps else "clean"
            status = "OK" if row_count >= 10_000 else "LOW"
            results.append({
                "symbol": symbol,
                "rows": row_count,
                "range": date_range,
                "gaps": gap_str,
                "status": status,
            })
            color = "\033[92m" if status == "OK" else "\033[93m"
            print(f"   {color}[{status}]\033[0m  {row_count:,} rows  |  {date_range}  |  {gap_str}")
        except Exception as e:
            logger.error(f"  FAILED for {symbol}: {e}")
            results.append({
                "symbol": symbol,
                "rows": 0,
                "range": "-",
                "gaps": "-",
                "status": "FAIL",
            })
            print(f"   \033[91m[FAIL]\033[0m  {e}")
        print()

    # Summary
    print("=" * 60)
    print("  Download Summary")
    print("=" * 60)
    ok = [r for r in results if r["status"] == "OK"]
    fail = [r for r in results if r["status"] == "FAIL"]
    low = [r for r in results if r["status"] == "LOW"]

    if fail:
        print(f"\033[91m  {len(fail)} FAILED: {', '.join(r['symbol'] for r in fail)}\033[0m")
    if low:
        print(f"\033[93m  {len(low)} LOW ROW COUNT: {', '.join(r['symbol'] for r in low)}\033[0m")

    print(f"\033[92m  {len(ok)}/{len(results)} coins downloaded successfully\033[0m")
    print()
    print(f"  Training cutoff:          {config.TRAIN_END_DATE}")
    print(f"  Simulation start:         {config.SIMULATION_START_DATE}")
    print()
    print("  REMINDER: Never use data beyond TRAIN_END_DATE during model training.")
    print("  Phase 3 train_model.py enforces this automatically.")
    print("=" * 60)

    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())
