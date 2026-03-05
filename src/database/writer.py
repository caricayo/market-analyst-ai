"""
src/database/writer.py — Helper functions for writing to the database.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
from loguru import logger

from .models import get_session_factory, init_db, Trade, DailyStat, ModelVersion, Heartbeat, KillSwitchEvent, SimulationResult


_engine = None
_Session = None


def _ensure_init():
    global _engine, _Session
    if _Session is None:
        _engine = init_db()
        _Session = get_session_factory(_engine)


@contextmanager
def session_scope():
    _ensure_init()
    session = _Session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def save_trade(trade_data: dict) -> int:
    """Insert a new trade record. Returns the new trade id."""
    with session_scope() as s:
        trade = Trade(**trade_data)
        s.add(trade)
        s.flush()
        return trade.id


def update_trade(trade_id: int, updates: dict):
    """Update fields on an existing trade."""
    with session_scope() as s:
        s.query(Trade).filter(Trade.id == trade_id).update(updates)


def save_daily_stat(stat_data: dict):
    """Upsert a DailyStat row (replace if date already exists)."""
    with session_scope() as s:
        existing = s.query(DailyStat).filter(
            DailyStat.date == stat_data["date"]
        ).first()
        if existing:
            for k, v in stat_data.items():
                setattr(existing, k, v)
        else:
            s.add(DailyStat(**stat_data))


def save_model_version(version_data: dict):
    """Insert a model version record; unsets is_current on all others if accepted."""
    with session_scope() as s:
        if version_data.get("is_current"):
            s.query(ModelVersion).update({"is_current": False})
        mv = ModelVersion(**version_data)
        s.add(mv)


def record_heartbeat(job_name: str, status: str = "ok", message: str = None):
    with session_scope() as s:
        s.add(Heartbeat(job_name=job_name, status=status, message=message))


def record_kill_switch(level: str, trigger_pct: float, portfolio_value: float,
                       message: str = None, discord_sent=False, email_sent=False):
    with session_scope() as s:
        s.add(KillSwitchEvent(
            level=level,
            trigger_pct=trigger_pct,
            portfolio_value=portfolio_value,
            message=message,
            discord_sent=discord_sent,
            email_sent=email_sent,
        ))


def save_simulation_result(result_data: dict):
    with session_scope() as s:
        s.add(SimulationResult(**result_data))
