"""
src/database/reader.py — Read-only queries for the dashboard and risk system.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import desc, func

from .models import get_session_factory, init_db, Trade, DailyStat, ModelVersion, Heartbeat, KillSwitchEvent, SimulationResult


_engine = None
_Session = None


def _ensure_init():
    global _engine, _Session
    if _Session is None:
        _engine = init_db()
        _Session = get_session_factory(_engine)


def _session():
    _ensure_init()
    return _Session()


def get_open_trades(paper: Optional[bool] = None):
    s = _session()
    try:
        q = s.query(Trade).filter(Trade.closed_at == None)
        if paper is not None:
            q = q.filter(Trade.paper == paper)
        return q.all()
    finally:
        s.close()


def get_trades(limit=100, paper: Optional[bool] = None, symbol: str = None,
               since_date: str = None, simulation_run_id: str = None):
    s = _session()
    try:
        q = s.query(Trade)
        if paper is not None:
            q = q.filter(Trade.paper == paper)
        if symbol:
            q = q.filter(Trade.symbol == symbol)
        if since_date:
            q = q.filter(Trade.opened_at >= since_date)
        if simulation_run_id:
            q = q.filter(Trade.simulation_run_id == simulation_run_id)
        return q.order_by(desc(Trade.opened_at)).limit(limit).all()
    finally:
        s.close()


def get_daily_stats(days=30, paper: Optional[bool] = None):
    s = _session()
    try:
        q = s.query(DailyStat).order_by(desc(DailyStat.date)).limit(days)
        if paper is not None:
            q = q.filter(DailyStat.paper == paper)
        return q.all()
    finally:
        s.close()


def get_current_model():
    s = _session()
    try:
        return s.query(ModelVersion).filter(ModelVersion.is_current == True).first()
    finally:
        s.close()


def get_model_versions(limit=20):
    s = _session()
    try:
        return s.query(ModelVersion).order_by(desc(ModelVersion.trained_at)).limit(limit).all()
    finally:
        s.close()


def get_last_heartbeat(job_name: str):
    s = _session()
    try:
        return s.query(Heartbeat).filter(
            Heartbeat.job_name == job_name
        ).order_by(desc(Heartbeat.timestamp)).first()
    finally:
        s.close()


def get_rolling_win_rate(days: int = 14, paper: Optional[bool] = None) -> Optional[float]:
    """Returns win rate over last N days, or None if no closed trades."""
    s = _session()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        q = s.query(Trade).filter(
            Trade.closed_at != None,
            Trade.closed_at >= cutoff,
            Trade.pnl_usdt != None,
        )
        if paper is not None:
            q = q.filter(Trade.paper == paper)
        trades = q.all()
        if not trades:
            return None
        wins = sum(1 for t in trades if t.pnl_usdt > 0)
        return wins / len(trades)
    finally:
        s.close()


def get_daily_pnl_pct(date_str: str = None) -> Optional[float]:
    """Returns today's P&L % from daily_stats, or None."""
    s = _session()
    try:
        if date_str is None:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        stat = s.query(DailyStat).filter(DailyStat.date == date_str).first()
        return stat.daily_pnl_pct if stat else None
    finally:
        s.close()


def get_weekly_drawdown_pct() -> Optional[float]:
    """Returns max rolling 7-day drawdown as a negative fraction, or None."""
    s = _session()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        stats = s.query(DailyStat).filter(
            DailyStat.created_at >= cutoff,
            DailyStat.daily_pnl_pct != None,
        ).order_by(DailyStat.date).all()
        if not stats:
            return None
        cumulative = 0.0
        for stat in stats:
            cumulative += stat.daily_pnl_pct
        return cumulative
    finally:
        s.close()


def get_simulation_results(run_id: str = None, limit=10):
    s = _session()
    try:
        q = s.query(SimulationResult)
        if run_id:
            q = q.filter(SimulationResult.run_id == run_id)
        return q.order_by(desc(SimulationResult.created_at)).limit(limit).all()
    finally:
        s.close()


def get_kill_switch_events(limit=20):
    s = _session()
    try:
        return s.query(KillSwitchEvent).order_by(
            desc(KillSwitchEvent.triggered_at)
        ).limit(limit).all()
    finally:
        s.close()


def is_daily_kill_switch_active() -> bool:
    """True if a daily (non-resolved) kill switch was triggered today."""
    s = _session()
    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        event = s.query(KillSwitchEvent).filter(
            KillSwitchEvent.level == "daily",
            KillSwitchEvent.resolved_at == None,
            func.strftime("%Y-%m-%d", KillSwitchEvent.triggered_at) == today,
        ).first()
        return event is not None
    finally:
        s.close()
