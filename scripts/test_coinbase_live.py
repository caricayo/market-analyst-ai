"""
scripts/test_coinbase_live.py — Test Coinbase Advanced Trade authentication
and order placement WITHOUT risking real money.

Tests:
  1. Authenticated balance fetch   — proves CDP keys are valid
  2. Current BTC price             — proves market data works
  3. Place + cancel a $10 limit buy at $1 (impossible price, cancels immediately)
                                   — proves order placement path works end-to-end

Run from project root:
    python scripts/test_coinbase_live.py

WARNING: This script makes REAL API calls to Coinbase using your live credentials.
Step 3 briefly places a real order (at an impossible price) then cancels it.
No money will be spent — the order can never fill at $1.
"""

import sys
import os
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv()

PASS = "\033[92m  [PASS]\033[0m"
FAIL = "\033[91m  [FAIL]\033[0m"
WARN = "\033[93m  [WARN]\033[0m"

print()
print("=" * 60)
print("  Coinbase Live Auth Test")
print("=" * 60)
print()


# ─── Build a live ccxt client (ignores PAPER_TRADING flag) ────────────────────

import ccxt

raw_secret = os.getenv("COINBASE_API_SECRET", "")
api_key    = os.getenv("COINBASE_API_KEY", "")
api_secret = raw_secret.replace("\\n", "\n")

if not api_key or not api_secret:
    print(f"{FAIL} Missing COINBASE_API_KEY or COINBASE_API_SECRET in .env")
    sys.exit(1)

exchange = ccxt.coinbase({
    "apiKey":  api_key,
    "secret":  api_secret,
    "rateLimit": 150,
    "enableRateLimit": True,
})


# ─── Test 1: Current BTC price (public, no auth) ─────────────────────────────

print("1. Public market data (no auth):")
try:
    ticker = exchange.fetch_ticker("BTC/USD")
    price  = ticker["last"]
    print(f"{PASS} BTC/USD last price: ${price:,.2f}")
except Exception as e:
    print(f"{FAIL} fetch_ticker failed: {e}")
    sys.exit(1)

print()


# ─── Test 2: Authenticated balance fetch ─────────────────────────────────────

print("2. Authenticated balance fetch (read-only):")
try:
    balance = exchange.fetch_balance()
    usd = balance.get("USD", {}).get("free", 0) or balance.get("USDT", {}).get("free", 0)
    total_assets = [k for k, v in balance.get("free", {}).items() if v and v > 0]
    print(f"{PASS} Auth OK — USD available: ${usd:,.2f} | Non-zero assets: {total_assets or 'none'}")
except Exception as e:
    print(f"{FAIL} fetch_balance failed: {e}")
    print(f"       This means your CDP keys are invalid or have wrong permissions.")
    print(f"       Key used: {api_key[:40]}...")
    sys.exit(1)

print()


# ─── Test 3: Place + cancel tiny limit order (order path test) ───────────────

print("3. Order placement test (place limit buy at $1 → immediately cancel):")
print(f"   BTC current price: ${price:,.2f} | Order price: $1.00 (will never fill)")

confirm = input("   Proceed? (yes/no): ").strip().lower()
if confirm != "yes":
    print(f"{WARN} Skipped order placement test")
    print()
    print("=" * 60)
    print("  Auth test PASSED. Order placement test skipped.")
    print("=" * 60)
    sys.exit(0)

order_id = None
try:
    # $10 at $1 = 10 BTC units (way below market — can never fill)
    quantity = 10.0 / 1.0
    order = exchange.create_limit_buy_order("BTC/USD", quantity, 1.0)
    order_id = order["id"]
    print(f"{PASS} Order placed: id={order_id} | qty={quantity} BTC @ $1.00")
except Exception as e:
    print(f"{FAIL} create_limit_buy_order failed: {e}")
    print(f"       Your keys may not have 'trade' permission, or the API format is wrong.")
    sys.exit(1)

# Immediately cancel
time.sleep(1)
try:
    exchange.cancel_order(order_id, "BTC/USD")
    print(f"{PASS} Order cancelled successfully: id={order_id}")
except Exception as e:
    print(f"{FAIL} cancel_order failed: {e}")
    print(f"  ⚠ Order {order_id} may still be open — cancel it manually in Coinbase!")
    sys.exit(1)

print()
print("=" * 60)
print("\033[92m  ALL TESTS PASSED — Coinbase live trading path verified\033[0m")
print("=" * 60)
print()
