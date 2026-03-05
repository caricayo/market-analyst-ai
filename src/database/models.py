"""
src/database/models.py — SQLAlchemy ORM models for the trading database.

Tables:
  - trades          : Every opened/closed trade with full lifecycle data
  - daily_stats     : End-of-day summary snapshots
  - model_versions  : All trained models with AUC + training window
  - heartbeats      : Scheduler health timestamps
  - kill_switch_log : Kill switch events for audit trail
"""

import os
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, Float, String, Boolean, DateTime, Text, create_engine
)
from sqlalchemy.orm import declarative_base, sessionmaker
import config

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ─── Trades ───────────────────────────────────────────────────────────────────

class Trade(Base):
    __tablename__ = "trades"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    symbol          = Column(String(20), nullable=False, index=True)
    side            = Column(String(4),  nullable=False)   # "buy" | "sell"

    # Execution
    entry_price     = Column(Float, nullable=False)
    exit_price      = Column(Float, nullable=True)         # null until closed
    quantity        = Column(Float, nullable=False)        # base asset units
    position_value  = Column(Float, nullable=False)        # in USDT

    # Risk levels set at entry
    stop_loss_price  = Column(Float, nullable=False)
    take_profit_price = Column(Float, nullable=False)
    atr_at_entry     = Column(Float, nullable=True)

    # ML signal
    model_confidence = Column(Float, nullable=True)        # 0.0–1.0
    predicted_return = Column(Float, nullable=True)

    # Outcome
    pnl_usdt        = Column(Float, nullable=True)         # null until closed
    pnl_pct         = Column(Float, nullable=True)
    exit_reason     = Column(String(30), nullable=True)    # "stop_loss" | "take_profit" | "eod_exit" | "manual"
    prediction_correct = Column(Boolean, nullable=True)

    # Fees
    entry_fee_usdt  = Column(Float, nullable=True)
    exit_fee_usdt   = Column(Float, nullable=True)

    # Timestamps
    opened_at       = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    closed_at       = Column(DateTime(timezone=True), nullable=True)

    # Mode
    paper           = Column(Boolean, nullable=False, default=True)
    exchange_order_id = Column(String(100), nullable=True)

    # Walk-forward simulation tracking
    simulation_run_id = Column(String(50), nullable=True, index=True)

    def __repr__(self):
        return f"<Trade {self.symbol} {self.side} @ {self.entry_price} paper={self.paper}>"


# ─── Daily Stats ──────────────────────────────────────────────────────────────

class DailyStat(Base):
    __tablename__ = "daily_stats"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    date                  = Column(String(10), nullable=False, unique=True, index=True)  # YYYY-MM-DD UTC

    portfolio_value_start = Column(Float, nullable=False)
    portfolio_value_end   = Column(Float, nullable=True)
    daily_pnl_usdt        = Column(Float, nullable=True)
    daily_pnl_pct         = Column(Float, nullable=True)

    trades_opened         = Column(Integer, default=0)
    trades_closed         = Column(Integer, default=0)
    trades_won            = Column(Integer, default=0)
    trades_lost           = Column(Integer, default=0)

    kill_switch_triggered = Column(Boolean, default=False)
    soft_limit_triggered  = Column(Boolean, default=False)
    gatekeeper_result     = Column(Boolean, nullable=True)    # True=trade, False=skip
    gatekeeper_reason     = Column(Text, nullable=True)

    paper                 = Column(Boolean, nullable=False, default=True)
    created_at            = Column(DateTime(timezone=True), default=utcnow)

    def __repr__(self):
        return f"<DailyStat {self.date} P&L={self.daily_pnl_pct}%>"


# ─── Model Versions ───────────────────────────────────────────────────────────

class ModelVersion(Base):
    __tablename__ = "model_versions"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    version_tag     = Column(String(50), nullable=False, unique=True)   # e.g. "xgb_v3_20240315"
    file_path       = Column(String(255), nullable=False)

    train_start     = Column(String(10), nullable=False)   # YYYY-MM-DD
    train_end       = Column(String(10), nullable=False)
    auc_score       = Column(Float, nullable=False)
    wf_auc_mean     = Column(Float, nullable=True)         # XGB walk-forward mean AUC across folds
    lgb_wf_auc      = Column(Float, nullable=True)         # LGB walk-forward mean AUC across folds

    features_used   = Column(Text, nullable=True)          # JSON list
    xgb_params      = Column(Text, nullable=True)          # JSON dict
    notes           = Column(Text, nullable=True)

    is_current      = Column(Boolean, default=False, nullable=False)
    accepted        = Column(Boolean, default=True, nullable=False)   # False = rejected by AUC gate
    rejection_reason = Column(String(200), nullable=True)

    trained_at      = Column(DateTime(timezone=True), default=utcnow)

    def __repr__(self):
        return f"<ModelVersion {self.version_tag} AUC={self.auc_score:.4f} current={self.is_current}>"


# ─── Heartbeats ───────────────────────────────────────────────────────────────

class Heartbeat(Base):
    __tablename__ = "heartbeats"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    job_name    = Column(String(50), nullable=False, index=True)
    timestamp   = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    status      = Column(String(20), default="ok")   # "ok" | "error"
    message     = Column(Text, nullable=True)

    def __repr__(self):
        return f"<Heartbeat {self.job_name} @ {self.timestamp}>"


# ─── Kill Switch Log ──────────────────────────────────────────────────────────

class KillSwitchEvent(Base):
    __tablename__ = "kill_switch_log"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    level           = Column(String(10), nullable=False)   # "soft" | "daily" | "weekly"
    trigger_pct     = Column(Float, nullable=False)        # actual loss % that triggered it
    portfolio_value = Column(Float, nullable=False)
    message         = Column(Text, nullable=True)
    discord_sent    = Column(Boolean, default=False)
    email_sent      = Column(Boolean, default=False)
    resolved_at     = Column(DateTime(timezone=True), nullable=True)  # when manually cleared
    triggered_at    = Column(DateTime(timezone=True), default=utcnow)

    def __repr__(self):
        return f"<KillSwitchEvent {self.level} @ {self.trigger_pct:.2%}>"


# ─── Simulation Results ───────────────────────────────────────────────────────

class SimulationResult(Base):
    __tablename__ = "simulation_results"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    run_id          = Column(String(50), nullable=False, index=True)
    run_date        = Column(String(10), nullable=False)     # when simulation was run

    sim_start       = Column(String(10), nullable=False)     # simulation start date
    sim_end         = Column(String(10), nullable=False)     # simulation end date

    # Per-trade detail stored in trades table via simulation_run_id
    # These are summary stats
    total_trades    = Column(Integer, default=0)
    win_rate        = Column(Float, nullable=True)
    total_return_pct = Column(Float, nullable=True)
    max_drawdown_pct = Column(Float, nullable=True)
    sharpe_ratio    = Column(Float, nullable=True)
    avg_win_pct     = Column(Float, nullable=True)
    avg_loss_pct    = Column(Float, nullable=True)
    profit_factor   = Column(Float, nullable=True)

    model_version   = Column(String(50), nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), default=utcnow)

    def __repr__(self):
        return f"<SimulationResult {self.run_id} wr={self.win_rate:.1%} ret={self.total_return_pct:.2%}>"


# ─── Engine / Session Factory ─────────────────────────────────────────────────

def get_engine(db_path=None):
    database_url = os.getenv("DATABASE_URL", "")
    if database_url:
        if database_url.startswith("postgres://"):          # Railway prefix fix
            database_url = database_url.replace("postgres://", "postgresql://", 1)
        return create_engine(
            database_url, echo=False,
            pool_pre_ping=True,   # reconnects after Supabase idle timeout (~5 min)
            pool_size=5, max_overflow=10,
        )
    path = db_path or config.DB_PATH                        # local SQLite fallback
    return create_engine(f"sqlite:///{path}", echo=False)


def get_session_factory(engine=None):
    if engine is None:
        engine = get_engine()
    return sessionmaker(bind=engine)


def init_db(db_path=None):
    """Create all tables if they don't exist, and run additive migrations."""
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
    _migrate(engine)
    return engine


def _migrate(engine):
    """Apply additive schema migrations (safe to run on every startup)."""
    migrations = [
        # dual-model upgrade: add LGB AUC column to model_versions
        "ALTER TABLE model_versions ADD COLUMN lgb_wf_auc FLOAT",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(_text(stmt))
                conn.commit()
            except Exception:
                # Column already exists or table doesn't exist yet — both fine
                pass


try:
    from sqlalchemy import text as _text
except ImportError:
    from sqlalchemy.sql import text as _text
