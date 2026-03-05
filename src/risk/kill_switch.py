"""
src/risk/kill_switch.py — Daily and weekly circuit breakers.

Levels:
  SOFT  (2%):   Discord alert + 50% size reduction. Trading continues.
  DAILY (5%):   Halt all new trades until next UTC day.
  WEEKLY (15%): Halt all trades, require manual restart (delete halt file).

Email alerts are sent alongside Discord for SOFT/DAILY/WEEKLY events.
This file is the primary safety backstop — it must be correct.
"""

import os
from pathlib import Path
from datetime import datetime, timezone
from loguru import logger

import config
from src.database.writer import record_kill_switch
from src.database.reader import get_daily_pnl_pct, get_weekly_drawdown_pct, is_daily_kill_switch_active


# State files for persistence (survive restarts)
HALT_FILE = config.DATA_DIR / ".trading_halted"
SOFT_LIMIT_FILE = config.DATA_DIR / ".soft_limit_active"


# ─── State accessors ──────────────────────────────────────────────────────────

def is_trading_halted() -> bool:
    """Returns True if the daily or weekly kill switch has been triggered."""
    return HALT_FILE.exists() or is_daily_kill_switch_active()


def is_soft_limit_active() -> bool:
    """Returns True if the 2% soft limit is currently active (today)."""
    if not SOFT_LIMIT_FILE.exists():
        return False
    # Check if soft limit file is from today
    mtime = os.path.getmtime(SOFT_LIMIT_FILE)
    file_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
    today = datetime.now(timezone.utc).date()
    return file_dt.date() == today


def clear_daily_halt():
    """Called at start of new trading day to clear daily halt."""
    if HALT_FILE.exists():
        content = HALT_FILE.read_text()
        if "weekly" not in content.lower():
            HALT_FILE.unlink()
            logger.info("Daily trading halt cleared — new day")
    if SOFT_LIMIT_FILE.exists():
        SOFT_LIMIT_FILE.unlink()
        logger.info("Soft limit cleared — new day")


def manual_clear_halt():
    """Manual restart after weekly circuit breaker. Delete the halt file."""
    if HALT_FILE.exists():
        HALT_FILE.unlink()
        logger.warning("Weekly halt MANUALLY CLEARED by operator")
    if SOFT_LIMIT_FILE.exists():
        SOFT_LIMIT_FILE.unlink()


# ─── Alert senders ────────────────────────────────────────────────────────────

def _send_discord(message: str):
    try:
        import requests
        if not config.DISCORD_ENABLED:
            return
        resp = requests.post(config.DISCORD_WEBHOOK_URL, json={"content": message}, timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        logger.error(f"Discord alert failed: {e}")
        return False


def _send_email(subject: str, body: str) -> bool:
    """Send email kill-switch alert. Returns True on success."""
    if not config.EMAIL_ENABLED:
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = config.EMAIL_SENDER
        msg["To"] = config.EMAIL_RECIPIENT
        with smtplib.SMTP(config.EMAIL_SMTP_HOST, config.EMAIL_SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(config.EMAIL_SENDER, config.EMAIL_PASSWORD)
            smtp.sendmail(config.EMAIL_SENDER, config.EMAIL_RECIPIENT, msg.as_string())
        logger.info(f"Kill-switch email sent to {config.EMAIL_RECIPIENT}")
        return True
    except Exception as e:
        logger.error(f"Email kill-switch alert failed: {e}")
        return False


# ─── Kill switch evaluator ────────────────────────────────────────────────────

def evaluate_kill_switch(
    portfolio_value: float,
    starting_value: float,
    weekly_drawdown_pct: float = None,
) -> dict:
    """
    Check current P&L against all kill switch levels.
    Sends alerts and updates halt files if thresholds are breached.

    Args:
        portfolio_value:    Current portfolio value.
        starting_value:     Portfolio value at start of today.
        weekly_drawdown_pct: Optional; if None, reads from DB.

    Returns:
        dict: {
            "level": None | "soft" | "daily" | "weekly",
            "halt_trading": bool,
            "reduce_size": bool,
            "daily_pnl_pct": float,
        }
    """
    if starting_value is None or starting_value <= 0:
        return {"level": None, "halt_trading": False, "reduce_size": False, "daily_pnl_pct": 0}

    daily_pnl_pct = (portfolio_value - starting_value) / starting_value
    result = {
        "level": None,
        "halt_trading": False,
        "reduce_size": False,
        "daily_pnl_pct": daily_pnl_pct,
    }

    # Weekly check
    if weekly_drawdown_pct is None:
        weekly_drawdown_pct = get_weekly_drawdown_pct() or 0.0

    if weekly_drawdown_pct <= -config.WEEKLY_CIRCUIT_BREAKER_PCT:
        result["level"] = "weekly"
        result["halt_trading"] = True
        _trigger_weekly(daily_pnl_pct, weekly_drawdown_pct, portfolio_value)
        return result

    # Daily 5% kill switch
    if daily_pnl_pct <= -config.MAX_DAILY_LOSS_PCT:
        result["level"] = "daily"
        result["halt_trading"] = True
        _trigger_daily(daily_pnl_pct, portfolio_value)
        return result

    # Soft 2% limit
    if daily_pnl_pct <= -config.DAILY_SOFT_LIMIT_PCT and not is_soft_limit_active():
        result["level"] = "soft"
        result["reduce_size"] = True
        _trigger_soft(daily_pnl_pct, portfolio_value)

    return result


def _trigger_soft(daily_pnl_pct: float, portfolio_value: float):
    """2% soft limit: alert + size reduction."""
    msg = (
        f"⚠️ **SOFT LIMIT TRIGGERED**\n"
        f"Daily P&L: {daily_pnl_pct:.2%}\n"
        f"Portfolio: ${portfolio_value:,.2f}\n"
        f"Action: Position sizes reduced by 50% for remainder of day.\n"
        f"Trading continues."
    )
    logger.warning(f"SOFT LIMIT: {daily_pnl_pct:.2%} daily loss — reducing sizes by 50%")
    discord_ok = _send_discord(msg)
    email_ok   = _send_email(
        subject=f"[CRYPTO BOT] Soft Limit: {daily_pnl_pct:.2%} daily loss",
        body=msg,
    )
    SOFT_LIMIT_FILE.write_text(f"triggered at {datetime.now(timezone.utc).isoformat()}")
    record_kill_switch("soft", daily_pnl_pct, portfolio_value,
                       msg, discord_sent=discord_ok, email_sent=email_ok)


def _trigger_daily(daily_pnl_pct: float, portfolio_value: float):
    """5% daily kill switch: halt trading for the day."""
    msg = (
        f"🛑 **DAILY KILL SWITCH TRIGGERED**\n"
        f"Daily P&L: {daily_pnl_pct:.2%}\n"
        f"Portfolio: ${portfolio_value:,.2f}\n"
        f"Action: All new trades HALTED until midnight UTC.\n"
        f"Open positions will be closed at EOD (22:00 UTC)."
    )
    logger.error(f"DAILY KILL SWITCH: {daily_pnl_pct:.2%} daily loss — halting trading")
    discord_ok = _send_discord(msg)
    email_ok   = _send_email(
        subject=f"[CRYPTO BOT] KILL SWITCH: {daily_pnl_pct:.2%} daily loss — HALTED",
        body=msg,
    )
    HALT_FILE.write_text(f"daily halt triggered at {datetime.now(timezone.utc).isoformat()}")
    record_kill_switch("daily", daily_pnl_pct, portfolio_value,
                       msg, discord_sent=discord_ok, email_sent=email_ok)


def _trigger_weekly(daily_pnl_pct: float, weekly_drawdown_pct: float, portfolio_value: float):
    """15% weekly circuit breaker: halt until manual restart."""
    msg = (
        f"🔴 **WEEKLY CIRCUIT BREAKER TRIGGERED**\n"
        f"Weekly drawdown: {weekly_drawdown_pct:.2%} (threshold: {config.WEEKLY_CIRCUIT_BREAKER_PCT:.0%})\n"
        f"Daily P&L: {daily_pnl_pct:.2%}\n"
        f"Portfolio: ${portfolio_value:,.2f}\n"
        f"Action: Trading PAUSED — requires MANUAL restart.\n"
        f"To restart: delete `data/.trading_halted` file, then review strategy."
    )
    logger.critical(f"WEEKLY CIRCUIT BREAKER: {weekly_drawdown_pct:.2%} weekly drawdown — manual restart required")
    discord_ok = _send_discord(msg)
    email_ok   = _send_email(
        subject=f"[CRYPTO BOT] CIRCUIT BREAKER: {weekly_drawdown_pct:.2%} weekly drawdown — MANUAL RESTART REQUIRED",
        body=msg,
    )
    HALT_FILE.write_text(
        f"weekly halt triggered at {datetime.now(timezone.utc).isoformat()}\n"
        f"weekly drawdown: {weekly_drawdown_pct:.2%}\n"
        f"Delete this file to manually restart trading."
    )
    record_kill_switch("weekly", weekly_drawdown_pct, portfolio_value,
                       msg, discord_sent=discord_ok, email_sent=email_ok)
