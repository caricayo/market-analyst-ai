"""
config.py — Central configuration for the crypto trading system.

CRITICAL: Review these values before every session.
PAPER_TRADING=True must be explicitly confirmed before going live.
All numeric values are starting placeholders; tune after Phase 5b walk-forward simulation.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ─── Paths ───────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
HISTORICAL_DIR = DATA_DIR / "historical"
MODELS_DIR = DATA_DIR / "models"
DB_PATH = DATA_DIR / "trading.db"
LOGS_DIR = BASE_DIR / "logs"

for _d in [HISTORICAL_DIR, MODELS_DIR, LOGS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ─── Trading Mode ─────────────────────────────────────────────────────────────
# CRITICAL: This flag controls whether real money is at risk.
# Defaults to True from .env; must be explicitly set to "false" to go live.

_paper_env = os.getenv("PAPER_TRADING", "true").lower()
PAPER_TRADING: bool = _paper_env != "false"

# TEST_MODE: run morning routine every 10 min and skip blocked-day checks.
# Set TEST_MODE=true in Railway env vars to verify the system end-to-end.
# Remove (or set to false) to restore normal production schedule.
TEST_MODE: bool = os.getenv("TEST_MODE", "false").lower() == "true"

# BYPASS_GATEKEEPER: force trade_today=True regardless of AI/market conditions.
# Use in TEST_MODE only to verify the trading + position logic works end-to-end.
# Never set this in production.
BYPASS_GATEKEEPER: bool = os.getenv("BYPASS_GATEKEEPER", "false").lower() == "true"

# ─── Watchlist ────────────────────────────────────────────────────────────────
# Symbols in ccxt format (BASE/QUOTE). All must have >$10M daily volume.

WATCHLIST = [
    "BTC/USD",
    "ETH/USD",
    "SOL/USD",
    "XRP/USD",
    # BNB removed: not available on Coinbase — sim-only artifact, excluded from dual-model upgrade
    "AVAX/USD",
    "LINK/USD",
    "ADA/USD",
    "DOGE/USD",
    "LTC/USD",
    "MATIC/USD",
    # DOT removed: 33.3% win rate in simulation — weakest performer
]

# Days of week where the morning routine is skipped entirely (no trades opened).
# Thursday, Sunday: 20% win rates. Monday: 0% win rate in latest simulation.
BLOCKED_TRADING_DAYS = ["Monday", "Thursday", "Saturday", "Sunday"]

# Per-coin minimum confidence overrides.
# Coins not listed here fall back to MIN_MODEL_CONFIDENCE (now 0.60).
# LINK: 28.6% win rate in latest simulation — raised to 0.70 to require strong conviction.
COIN_MIN_CONFIDENCE = {
    "LTC/USD":   0.65,
    "ADA/USD":   0.65,
    "MATIC/USD": 0.65,  # elevated: 40% win rate in simulation
    "DOGE/USD":  0.62,  # elevated: 46.7% win rate in simulation
    "SOL/USD":   0.62,  # elevated: higher volatility, tighter filter
    "AVAX/USD":  0.62,  # elevated: higher volatility, tighter filter
    "LINK/USD":  0.70,  # elevated: 28.6% win rate in latest simulation
}

# Minimum 24h trading volume in USD to consider a coin tradeable
MIN_LIQUIDITY_USD = 10_000_000

# ─── Risk Parameters ──────────────────────────────────────────────────────────
# NOTE: These are starting placeholders. Tune after reviewing Phase 5b simulation results.

# Maximum fraction of portfolio in a single position
MAX_POSITION_PCT = 0.07          # 7% per coin — Optuna-optimised (300 trials, 2024-07-01→2026-03)

# Maximum number of simultaneously open positions
MAX_SIMULTANEOUS_TRADES = int(os.getenv("MAX_SIMULTANEOUS_TRADES", "10"))

# Maximum total portfolio exposure (rest stays in USDT)
MAX_PORTFOLIO_EXPOSURE = float(os.getenv("MAX_PORTFOLIO_EXPOSURE", "0.95"))

# ATR multipliers for stop-loss and take-profit
STOP_LOSS_ATR_MULT = 1.5         # Entry − (1.5 × ATR14)
TAKE_PROFIT_ATR_MULT = 3.0       # Entry + (3.0 × ATR14) → 2:1 R:R

# Minimum ML model confidence to consider a signal actionable
# Optuna-optimised: raised to 0.60 — more selective, fewer but better-quality signals
MIN_MODEL_CONFIDENCE = 0.60      # 60% predicted probability — DO NOT lower below 0.60

# ─── Kill Switch Levels ───────────────────────────────────────────────────────

# 2% daily loss → Discord alert + reduce position sizes by 50%
DAILY_SOFT_LIMIT_PCT = 0.02

# 5% daily loss → halt ALL new trades until next day
MAX_DAILY_LOSS_PCT = 0.05

# 15% rolling weekly drawdown → pause system, require manual restart
WEEKLY_CIRCUIT_BREAKER_PCT = 0.15

# ─── Exchange / Fees ──────────────────────────────────────────────────────────

EXCHANGE_ID = "coinbase"         # ccxt exchange id
COINBASE_FEE_PCT = 0.006         # 0.6% taker fee (simulated in paper mode)
SIMULATED_SLIPPAGE_PCT = 0.001   # 0.1% slippage simulation

# Cancel unfilled limit orders after this many seconds (10 minutes)
ORDER_FILL_TIMEOUT_SECONDS = 600

# ─── Scheduling (UTC) ─────────────────────────────────────────────────────────

# Morning routine: gatekeeper + score + open trades
MORNING_ROUTINE_UTC = "08:00"

# Intraday monitor: check stops/targets every N minutes
MONITOR_INTERVAL_MINUTES = 5
MONITOR_START_UTC = "09:00"
MONITOR_END_UTC   = "21:55"

# EOD forced exit: close all open positions
EOD_EXIT_UTC = "22:00"

# EOD verification: check everything is closed
EOD_VERIFY_UTC = "22:10"

# ─── ML Model ─────────────────────────────────────────────────────────────────

# Prediction horizon: does coin go up >0.5% in the next N hours?
PREDICTION_HORIZON_HOURS = 8
PREDICTION_THRESHOLD_PCT  = 0.005  # 0.5%

# Training data window
TRAIN_START_DATE = "2021-01-01"
TRAIN_END_DATE   = "2024-06-30"   # Strict cutoff — DO NOT use data beyond this for training

# Walk-forward simulation starts here (must be after TRAIN_END_DATE)
SIMULATION_START_DATE = "2024-07-01"

# XGBoost hyperparameters (starting defaults; tune after walk-forward)
XGB_PARAMS = {
    "n_estimators": 300,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "use_label_encoder": False,
    "eval_metric": "logloss",
    "random_state": 42,
    "n_jobs": -1,
}

# LightGBM hyperparameters (mirrors XGB config; trained alongside XGB)
LGB_PARAMS = {
    "n_estimators":      300,
    "max_depth":         4,
    "learning_rate":     0.05,
    "subsample":         0.8,
    "colsample_bytree":  0.8,
    "min_child_samples": 20,
    "random_state":      42,
    "n_jobs":            -1,
    "verbose":           -1,
}

# Walk-forward cross-validation folds
WF_N_SPLITS = 5

# Current best model paths (updated by retrainer)
CURRENT_MODEL_PATH     = MODELS_DIR / "xgb_model_current.pkl"
CURRENT_LGB_MODEL_PATH = MODELS_DIR / "lgb_model_current.pkl"

# ─── Live Accuracy Monitoring ─────────────────────────────────────────────────

# Rolling window for live win-rate tracking
LIVE_WIN_RATE_WINDOW_DAYS = 14

# If rolling win rate drops below this → alert + auto-reduce sizes to 25%
LIVE_WIN_RATE_MIN = 0.45

# ─── CoinGecko ────────────────────────────────────────────────────────────────

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
COINGECKO_RATE_LIMIT_PER_MIN = 10   # Conservative free-tier limit
COINGECKO_RETRY_MAX = 4
COINGECKO_RETRY_BACKOFF_BASE = 2.0  # seconds (doubles each retry)

# Auto-block trading if Fear/Greed index is outside this range
FEAR_GREED_MIN = 20
FEAR_GREED_MAX = 90

# Auto-block if 24h market cap change exceeds this drop
MARKET_CAP_DROP_BLOCK_PCT = -0.05   # -5%

# ─── News / RSS ───────────────────────────────────────────────────────────────

NEWS_FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cryptopanic.com/news/rss/",
]
NEWS_MAX_HEADLINES = 15

# Keywords that trigger auto-block (case-insensitive)
NEWS_BLOCK_KEYWORDS = [
    "hack", "exploit", "breach", "hacked", "compromised",
    "exchange down", "halted", "suspended", "sec charges",
    "arrest", "fraud", "ponzi",
]

# ─── AI Gatekeeper ────────────────────────────────────────────────────────────

# Model to use for the morning gatekeeper
AI_MODEL = "gpt-4o-mini"

AI_GATEKEEPER_SYSTEM_PROMPT = """You are a risk-aware crypto trading advisor.
You receive a morning market context report and decide whether conditions are safe to trade today.
You MUST return valid JSON only. No markdown, no extra text — just the JSON object.
Default to caution: when in doubt, set trade_today to false."""

# ─── Discord ──────────────────────────────────────────────────────────────────

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
DISCORD_ENABLED = bool(DISCORD_WEBHOOK_URL)

# ─── Email (kill-switch fallback) ─────────────────────────────────────────────

EMAIL_SENDER    = os.getenv("EMAIL_SENDER", "")
EMAIL_PASSWORD  = os.getenv("EMAIL_PASSWORD", "")
EMAIL_RECIPIENT = os.getenv("EMAIL_RECIPIENT", "")
EMAIL_SMTP_HOST = os.getenv("EMAIL_SMTP_HOST", "smtp.gmail.com")
EMAIL_SMTP_PORT = int(os.getenv("EMAIL_SMTP_PORT", "587"))
EMAIL_ENABLED   = bool(EMAIL_SENDER and EMAIL_PASSWORD and EMAIL_RECIPIENT)

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE   = LOGS_DIR / "trading.log"
LOG_ROTATION = "10 MB"
LOG_RETENTION = "30 days"
