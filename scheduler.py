"""
scheduler.py — APScheduler job definitions for the full daily trading cycle.

Jobs:
  08:00 UTC  morning_routine    — Gatekeeper + score + open trades
  09:00–21:55 UTC  monitor      — 5-min check of stops/targets (every 5 min)
  22:00 UTC  eod_exit           — Force-close all positions
  22:10 UTC  eod_verify         — Check nothing remains open
  Weekly Sun 01:00 UTC  retrain — Weekly model retraining

Usage: python main.py (starts scheduler + dashboard)
       Or import start_scheduler() from your own script.
"""

from datetime import datetime, timezone
from loguru import logger
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import config

# These are module-level singletons, initialized once
_client = None
_portfolio = None
_scheduler = None
_starting_value = None


def _get_state():
    global _client, _portfolio, _starting_value
    return _client, _portfolio, _starting_value


def _job_morning():
    from src.execution.morning_routine import run_morning_routine
    client, portfolio, sv = _get_state()
    global _starting_value
    try:
        _starting_value = portfolio.portfolio_value()
        run_morning_routine(client, portfolio, _starting_value)
    except Exception as e:
        logger.error(f"Morning routine crashed: {e}")
        from src.alerts.discord_alerts import send_raw
        send_raw(f"🚨 Morning routine ERROR: {e}")


def _job_monitor():
    from src.execution.intraday_monitor import run_monitor_cycle
    client, portfolio, sv = _get_state()
    if sv is None:
        return   # Haven't had a morning yet
    try:
        run_monitor_cycle(client, portfolio, sv)
    except Exception as e:
        logger.error(f"Monitor cycle crashed: {e}")


def _job_eod_exit():
    from src.execution.eod_exit import run_eod_exit
    client, portfolio, sv = _get_state()
    try:
        run_eod_exit(client, portfolio, sv or portfolio.portfolio_value())
    except Exception as e:
        logger.error(f"EOD exit crashed: {e}")
        from src.alerts.discord_alerts import send_raw
        send_raw(f"🚨 EOD exit ERROR: {e} — Check positions manually!")


def _job_eod_verify():
    from src.execution.eod_exit import run_eod_verification
    client, portfolio, _ = _get_state()
    try:
        run_eod_verification(portfolio, client)
    except Exception as e:
        logger.error(f"EOD verification crashed: {e}")


def _job_retrain():
    from src.ml.retrainer import run_weekly_retrain
    try:
        run_weekly_retrain()
    except Exception as e:
        logger.error(f"Weekly retrain crashed: {e}")
        from src.alerts.discord_alerts import send_raw
        send_raw(f"⚠️ Weekly retrain ERROR: {e}")


def start_scheduler(client, portfolio):
    """
    Initialize and start the APScheduler with all trading jobs.

    Args:
        client:    ExchangeClient instance.
        portfolio: PaperPortfolio (or LivePortfolio) instance.
    """
    global _client, _portfolio, _scheduler

    _client    = client
    _portfolio = portfolio

    # In test mode seed _starting_value immediately so the monitor isn't locked
    global _starting_value
    if config.TEST_MODE:
        _starting_value = portfolio.portfolio_value()

    scheduler = BackgroundScheduler(timezone="UTC")

    if config.TEST_MODE:
        # ── TEST MODE: morning routine every 10 min, fires immediately ────
        scheduler.add_job(
            _job_morning,
            IntervalTrigger(minutes=10),
            id="morning_routine",
            name="Morning Routine — TEST (every 10 min)",
            next_run_time=datetime.now(timezone.utc),
            max_instances=1,
            coalesce=True,
        )
        # Monitor still runs every 5 min, no time restriction
        scheduler.add_job(
            _job_monitor,
            IntervalTrigger(minutes=5),
            id="intraday_monitor",
            name="Intraday Monitor — TEST (every 5 min)",
            max_instances=1,
            coalesce=True,
        )
        logger.info("*** TEST MODE — morning routine fires every 10 min ***")
        logger.info("  Every 10 min — Morning Routine (no day restrictions)")
        logger.info("  Every 5 min  — Intraday Monitor")
    else:
        # ── Morning routine: 08:00 UTC ─────────────────────────────────────
        scheduler.add_job(
            _job_morning,
            CronTrigger(hour=8, minute=0),
            id="morning_routine",
            name="Morning Routine (gatekeeper + buys)",
            max_instances=1,
            coalesce=True,
        )
        # ── Intraday monitor: every 5 min, 09:00–21:55 UTC ────────────────
        scheduler.add_job(
            _job_monitor,
            CronTrigger(hour="9-21", minute="*/5"),
            id="intraday_monitor",
            name="Intraday Monitor (stops/targets)",
            max_instances=1,
            coalesce=True,
        )
        logger.info("  08:00 UTC — Morning Routine")
        logger.info("  09:00–21:55 UTC every 5 min — Intraday Monitor")

    # ── EOD exit: 22:00 UTC (always) ──────────────────────────────────────
    scheduler.add_job(
        _job_eod_exit,
        CronTrigger(hour=22, minute=0),
        id="eod_exit",
        name="EOD Forced Exit",
        max_instances=1,
        coalesce=True,
    )

    # ── EOD verification: 22:10 UTC (always) ──────────────────────────────
    scheduler.add_job(
        _job_eod_verify,
        CronTrigger(hour=22, minute=10),
        id="eod_verify",
        name="EOD Verification",
        max_instances=1,
        coalesce=True,
    )

    # ── Weekly retrain: Sunday 01:00 UTC (always) ─────────────────────────
    scheduler.add_job(
        _job_retrain,
        CronTrigger(day_of_week="sun", hour=1, minute=0),
        id="weekly_retrain",
        name="Weekly Model Retrain",
        max_instances=1,
        coalesce=True,
    )

    scheduler.start()
    _scheduler = scheduler

    logger.info("Scheduler started")
    logger.info("  22:00 UTC — EOD Exit")
    logger.info("  22:10 UTC — EOD Verification")
    logger.info("  Sunday 01:00 UTC — Weekly Retrain")

    return scheduler


def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
