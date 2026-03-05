"""
scripts/test_connections.py — Verify all external API connections and local setup.

Run: python scripts/test_connections.py

Prints a color-coded status line for each component. All must show GREEN before
proceeding to Phase 2.
"""

import sys
import os
from pathlib import Path

# Allow running from the scripts/ directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from loguru import logger
logger.remove()
logger.add(sys.stderr, level="INFO", format="<level>{message}</level>")


# ─── Helpers ──────────────────────────────────────────────────────────────────

PASS = "\033[92m  [PASS]\033[0m"
FAIL = "\033[91m  [FAIL]\033[0m"
SKIP = "\033[93m  [SKIP]\033[0m"

results = []

def check(name: str, fn):
    try:
        msg = fn()
        print(f"{PASS} {name}: {msg}")
        results.append((name, True))
    except Exception as e:
        print(f"{FAIL} {name}: {e}")
        results.append((name, False))


# ─── 1. Environment file ──────────────────────────────────────────────────────

def test_env():
    required = ["COINBASE_API_KEY", "COINBASE_API_SECRET", "OPENAI_API_KEY",
                "DISCORD_WEBHOOK_URL"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise EnvironmentError(f"Missing .env keys: {', '.join(missing)}")
    return "All required keys present"

check(".env file", test_env)


# ─── 2. SQLite database ───────────────────────────────────────────────────────

def test_sqlite():
    from src.database.models import init_db
    engine = init_db()
    with engine.connect() as conn:
        result = conn.execute(
            __import__("sqlalchemy").text("SELECT name FROM sqlite_master WHERE type='table'")
        ).fetchall()
    tables = [r[0] for r in result]
    expected = {"trades", "daily_stats", "model_versions", "heartbeats",
                "kill_switch_log", "simulation_results"}
    missing = expected - set(tables)
    if missing:
        raise ValueError(f"Missing tables: {missing}")
    return f"DB OK — tables: {', '.join(sorted(tables))}"

check("SQLite database", test_sqlite)


# ─── 3. Coinbase Advanced API ─────────────────────────────────────────────────

def test_coinbase():
    import ccxt
    # Public client for ticker check (CDP private key is only needed for order placement)
    exchange = ccxt.coinbase({"rateLimit": 150, "enableRateLimit": True})
    exchange.load_markets()
    ticker = exchange.fetch_ticker("BTC/USD")
    price = ticker["last"]
    if not price:
        raise ValueError("Got empty ticker response")
    # Also verify credentials are present and key is in CDP format
    key = os.getenv("COINBASE_API_KEY", "")
    if "apiKeys" not in key:
        raise ValueError(f"COINBASE_API_KEY doesn't look like a CDP key (expected 'apiKeys' in path)")
    secret = os.getenv("COINBASE_API_SECRET", "")
    if "EC PRIVATE KEY" not in secret:
        raise ValueError("COINBASE_API_SECRET doesn't look like an EC private key")
    return f"BTC/USD last price: ${price:,.2f} | CDP key format: OK"

check("Coinbase Advanced API", test_coinbase)


# ─── 4. CoinGecko (no key) ────────────────────────────────────────────────────

def test_coingecko():
    import requests
    import config
    resp = requests.get(
        f"{config.COINGECKO_BASE_URL}/simple/price",
        params={"ids": "bitcoin", "vs_currencies": "usd"},
        timeout=10,
    )
    resp.raise_for_status()
    btc_price = resp.json()["bitcoin"]["usd"]
    return f"BTC price: ${btc_price:,.0f}"

check("CoinGecko API", test_coingecko)


# ─── 5. Fear & Greed Index ────────────────────────────────────────────────────

def test_fear_greed():
    import requests
    resp = requests.get("https://api.alternative.me/fng/", timeout=10)
    resp.raise_for_status()
    data = resp.json()["data"][0]
    return f"Index: {data['value']} ({data['value_classification']})"

check("Fear & Greed Index", test_fear_greed)


# ─── 6. OpenAI API ────────────────────────────────────────────────────────────

def test_openai():
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Reply with just the word PONG"}],
        max_tokens=5,
    )
    reply = response.choices[0].message.content.strip()
    return f"Response: {reply}"

check("OpenAI API (gpt-4o-mini)", test_openai)


# ─── 7. Discord webhook ───────────────────────────────────────────────────────

def test_discord():
    import requests
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        raise ValueError("DISCORD_WEBHOOK_URL not set")
    payload = {"content": "🟢 **Crypto Bot**: Connection test successful — system is online."}
    resp = requests.post(webhook_url, json=payload, timeout=10)
    if resp.status_code not in (200, 204):
        raise ValueError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    return "Message sent to Discord"

check("Discord webhook", test_discord)


# ─── 8. Email (optional) ──────────────────────────────────────────────────────

def test_email():
    import smtplib
    sender = os.getenv("EMAIL_SENDER", "")
    password = os.getenv("EMAIL_PASSWORD", "")
    recipient = os.getenv("EMAIL_RECIPIENT", "")
    host = os.getenv("EMAIL_SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("EMAIL_SMTP_PORT", "587"))

    if not all([sender, password, recipient]):
        print(f"{SKIP} Email (kill-switch fallback): Not configured — set EMAIL_SENDER/PASSWORD/RECIPIENT in .env")
        return None

    with smtplib.SMTP(host, port, timeout=10) as smtp:
        smtp.starttls()
        smtp.login(sender, password)
        smtp.sendmail(sender, recipient,
            f"Subject: Crypto Bot Test\n\nConnection test successful.")
    return f"Test email sent to {recipient}"

name = "Email (kill-switch fallback)"
try:
    result = test_email()
    if result is not None:
        print(f"{PASS} {name}: {result}")
        results.append((name, True))
except Exception as e:
    print(f"{FAIL} {name}: {e}")
    results.append((name, False))


# ─── 9. RSS news feeds ────────────────────────────────────────────────────────

def test_rss():
    import feedparser
    import config
    headlines = []
    for url in config.NEWS_FEEDS:
        feed = feedparser.parse(url)
        if feed.entries:
            headlines.append(feed.entries[0].title[:60])
    if not headlines:
        raise ValueError("No headlines fetched from any feed")
    return f"{len(config.NEWS_FEEDS)} feeds OK — latest: \"{headlines[0]}...\""

check("RSS news feeds", test_rss)


# ─── 10. Config sanity check ──────────────────────────────────────────────────

def test_config():
    import config
    assert config.PAPER_TRADING == True, "PAPER_TRADING must be True for safety"
    assert 0 < config.MAX_POSITION_PCT <= 0.20, "MAX_POSITION_PCT out of safe range"
    assert config.MAX_DAILY_LOSS_PCT <= 0.10, "MAX_DAILY_LOSS_PCT suspiciously high"
    mode = "PAPER" if config.PAPER_TRADING else "LIVE"
    return f"Mode: {mode} | Watchlist: {', '.join(config.WATCHLIST)}"

check("config.py sanity", test_config)


# ─── Summary ──────────────────────────────────────────────────────────────────

total = len(results)
passed = sum(1 for _, ok in results if ok)
failed = total - passed

print()
print("=" * 60)
if failed == 0:
    print(f"\033[92m  ALL {total} CHECKS PASSED — Ready to proceed to Phase 2\033[0m")
else:
    print(f"\033[91m  {failed}/{total} CHECKS FAILED — Fix above issues before proceeding\033[0m")
print("=" * 60)
sys.exit(0 if failed == 0 else 1)
