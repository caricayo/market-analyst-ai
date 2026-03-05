"""
main.py — Entry point for the crypto trading system.

Starts the APScheduler (background trading jobs) and launches the Streamlit
dashboard in a subprocess.

Usage:
  python main.py             — Start scheduler only (no dashboard)
  python main.py --dashboard — Start scheduler + open dashboard

For dashboard only (without trading):
  streamlit run dashboard/app.py
"""

import sys
import time
import signal
import argparse
import subprocess
from pathlib import Path
from loguru import logger

# ─── Logging setup ────────────────────────────────────────────────────────────

import config
from loguru import logger

logger.remove()
logger.add(
    sys.stderr,
    level=config.LOG_LEVEL,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    colorize=True,
)
logger.add(
    config.LOG_FILE,
    level="DEBUG",
    rotation=config.LOG_ROTATION,
    retention=config.LOG_RETENTION,
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{line} | {message}",
)


def main():
    parser = argparse.ArgumentParser(description="Crypto Trading System")
    parser.add_argument("--dashboard", action="store_true",
                        help="Also launch the Streamlit dashboard")
    parser.add_argument("--balance", type=float, default=10_000.0,
                        help="Starting paper balance in USDT (default: 10000)")
    args = parser.parse_args()

    # ── Mode banner ────────────────────────────────────────────────────────
    from src.exchange.client import print_mode_banner
    print_mode_banner()

    # ── Verify DB ─────────────────────────────────────────────────────────
    from src.database.models import init_db
    init_db()
    logger.info("Database initialized")

    # ── Initialize exchange client ─────────────────────────────────────────
    from src.exchange.client import ExchangeClient
    client = ExchangeClient()

    # ── Initialize portfolio ───────────────────────────────────────────────
    from src.exchange.portfolio import PaperPortfolio
    portfolio = PaperPortfolio(starting_usdt=args.balance)
    logger.info(f"Portfolio initialized: ${args.balance:,.2f} USDT")

    # ── Start scheduler ────────────────────────────────────────────────────
    from scheduler import start_scheduler
    scheduler = start_scheduler(client, portfolio)
    logger.info("Trading scheduler started — system is running")

    # ── Optionally launch dashboard ────────────────────────────────────────
    dashboard_proc = None
    if args.dashboard:
        logger.info("Launching Streamlit dashboard at http://localhost:8501")
        dashboard_proc = subprocess.Popen([
            sys.executable, "-m", "streamlit", "run",
            str(Path(__file__).parent / "dashboard" / "app.py"),
            "--server.port", "8501",
            "--server.headless", "true",
        ])

    # ── Graceful shutdown ──────────────────────────────────────────────────
    def shutdown(sig, frame):
        logger.info("Shutdown signal received...")
        from scheduler import stop_scheduler
        stop_scheduler()
        if dashboard_proc:
            dashboard_proc.terminate()
        logger.info("System shutdown complete")
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    logger.info("System running. Press Ctrl+C to stop.")
    logger.info(f"Mode: {'PAPER TRADING' if config.PAPER_TRADING else 'LIVE TRADING'}")

    # Keep alive
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
