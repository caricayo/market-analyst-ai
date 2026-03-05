"""
src/alerts/discord_alerts.py — Discord webhook alert helpers.

All alerts use HTTP POST. No bot setup required.
"""

import requests
from datetime import datetime, timezone
from loguru import logger

import config


def _post(payload: dict) -> bool:
    if not config.DISCORD_ENABLED:
        logger.debug("Discord not configured — alert skipped")
        return False
    try:
        resp = requests.post(config.DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        logger.error(f"Discord webhook failed: {e}")
        return False


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def alert_trade_opened(symbol: str, entry_price: float, quantity: float,
                       position_value: float, stop: float, target: float,
                       confidence: float, paper: bool = True):
    mode = "📄 PAPER" if paper else "💰 LIVE"
    _post({"content": (
        f"🟢 **Trade Opened** {mode}\n"
        f"**{symbol}** | Entry: ${entry_price:,.4f}\n"
        f"Qty: {quantity:.6f} | Value: ${position_value:.2f}\n"
        f"Stop: ${stop:,.4f} | Target: ${target:,.4f}\n"
        f"Confidence: {confidence:.1%} | {_ts()}"
    )})


def alert_trade_closed(symbol: str, exit_price: float, pnl_usdt: float,
                       pnl_pct: float, exit_reason: str, paper: bool = True):
    mode = "📄 PAPER" if paper else "💰 LIVE"
    emoji = "✅" if pnl_usdt > 0 else "❌"
    _post({"content": (
        f"{emoji} **Trade Closed** {mode}\n"
        f"**{symbol}** | Exit: ${exit_price:,.4f}\n"
        f"P&L: ${pnl_usdt:+.2f} ({pnl_pct:+.2%}) | Reason: {exit_reason}\n"
        f"{_ts()}"
    )})


def alert_gatekeeper(trade_today: bool, reason: str, regime: str):
    emoji = "🟢" if trade_today else "🔴"
    action = "TRADING TODAY" if trade_today else "SKIPPING TODAY"
    _post({"content": (
        f"{emoji} **Morning Gatekeeper** — {action}\n"
        f"Regime: {regime}\n"
        f"{reason}\n"
        f"{_ts()}"
    )})


def alert_order_timeout(symbol: str, order_id: str):
    _post({"content": (
        f"⏰ **Order Timeout** — {symbol}\n"
        f"Limit order {order_id} not filled in {config.ORDER_FILL_TIMEOUT_SECONDS // 60} min\n"
        f"Order cancelled — skipping coin.\n"
        f"{_ts()}"
    )})


def alert_eod_positions_closed(closed: list[dict]):
    if not closed:
        return
    lines = [f"🔔 **EOD Exit** — {len(closed)} position(s) closed"]
    for t in closed:
        emoji = "✅" if t["pnl_usdt"] > 0 else "❌"
        lines.append(f"{emoji} {t['symbol']}: ${t['pnl_usdt']:+.2f} ({t['pnl_pct']:+.2%})")
    lines.append(_ts())
    _post({"content": "\n".join(lines)})


def alert_eod_stuck_positions(symbols: list[str]):
    """URGENT: sent if positions are still open at 22:15 UTC."""
    _post({"content": (
        f"🚨 **URGENT: Stuck Positions at 22:15 UTC**\n"
        f"These positions failed to close at EOD: {', '.join(symbols)}\n"
        f"**Manual intervention required.**\n"
        f"{_ts()}"
    )})


def alert_retrain_result(version_tag: str, wf_auc: float, old_auc: float,
                         accepted: bool, sim_win_rate: float = None):
    emoji = "✅" if accepted else "⚠️"
    status = "ACCEPTED" if accepted else "REJECTED"
    lines = [
        f"{emoji} **Weekly Retrain — {status}**",
        f"New model: {version_tag}",
        f"Walk-forward AUC: {wf_auc:.4f} (prev: {old_auc:.4f})",
    ]
    if sim_win_rate is not None:
        lines.append(f"30-day sim win rate: {sim_win_rate:.1%}")
    lines.append(_ts())
    _post({"content": "\n".join(lines)})


def alert_low_win_rate(rolling_win_rate: float, days: int):
    _post({"content": (
        f"⚠️ **Low Rolling Win Rate**\n"
        f"{days}-day win rate: {rolling_win_rate:.1%} (threshold: {config.LIVE_WIN_RATE_MIN:.0%})\n"
        f"Position sizes auto-reduced to 25%.\n"
        f"{_ts()}"
    )})


def alert_heartbeat_stale(job_name: str, minutes_ago: float):
    _post({"content": (
        f"🔴 **Stale Heartbeat Warning**\n"
        f"Job `{job_name}` last heartbeat was {minutes_ago:.0f} min ago.\n"
        f"System may be down — check immediately.\n"
        f"{_ts()}"
    )})


def send_raw(message: str):
    """Send an arbitrary message."""
    _post({"content": message})
