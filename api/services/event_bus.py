"""
arfour — Event Bus

Manages analysis sessions with asyncio.Queue-based event streaming.
Supports concurrent sessions keyed by session ID.
"""

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# Auto-cleanup: remove completed sessions older than this (seconds)
_SESSION_TTL = 600  # 10 minutes
_MAX_EVENT_HISTORY = 500  # Cap per-session event history to prevent memory leak


@dataclass
class PipelineEvent:
    event_type: str  # stage_update, analysis_complete, analysis_error, keepalive
    stage: str | None = None
    status: str | None = None  # pending, running, complete, error
    detail: str = ""
    elapsed: float = 0.0
    timestamp: float = field(default_factory=time.time)
    data: dict[str, Any] | None = None


class AnalysisSession:
    def __init__(self, session_id: str, ticker: str):
        self.id = session_id
        self.ticker = ticker
        self.user_id: str | None = None
        self.analysis_db_id: str | None = None
        self.queue: asyncio.Queue[PipelineEvent] = asyncio.Queue()
        self.event_history: list[PipelineEvent] = []
        self.start_time = time.time()
        self.completed_at: float | None = None
        self.is_complete = False
        self.is_cancelled = False
        self.result: dict[str, Any] | None = None
        self.error: str | None = None
        self.task: asyncio.Task | None = None

    def emit(self, event: PipelineEvent) -> None:
        """Push event to queue and append to history for replay."""
        self.event_history.append(event)
        # Cap history to prevent unbounded memory growth
        if len(self.event_history) > _MAX_EVENT_HISTORY:
            self.event_history = self.event_history[-(_MAX_EVENT_HISTORY - 100):]
        self.queue.put_nowait(event)

    def emit_stage(self, stage: str, status: str, detail: str = "") -> None:
        elapsed = time.time() - self.start_time
        self.emit(PipelineEvent(
            event_type="stage_update",
            stage=stage,
            status=status,
            detail=detail,
            elapsed=elapsed,
        ))

    def emit_complete(self, data: dict[str, Any]) -> None:
        self.result = data
        elapsed = time.time() - self.start_time
        self.emit(PipelineEvent(
            event_type="analysis_complete",
            elapsed=elapsed,
            data=data,
        ))
        # Set is_complete AFTER enqueueing so SSE consumers see the event
        self.is_complete = True
        self.completed_at = time.time()

    def emit_error(self, error_msg: str) -> None:
        self.error = error_msg
        elapsed = time.time() - self.start_time
        self.emit(PipelineEvent(
            event_type="analysis_error",
            detail=error_msg,
            elapsed=elapsed,
        ))
        # Set is_complete AFTER enqueueing so SSE consumers see the event
        self.is_complete = True
        self.completed_at = time.time()


# Session store — keyed by session ID
_sessions: dict[str, AnalysisSession] = {}


def _cleanup_stale_sessions() -> None:
    """Remove completed sessions older than _SESSION_TTL."""
    now = time.time()
    stale = [
        sid for sid, s in _sessions.items()
        if s.is_complete and s.completed_at and (now - s.completed_at) > _SESSION_TTL
    ]
    for sid in stale:
        del _sessions[sid]


def create_session(ticker: str) -> AnalysisSession:
    _cleanup_stale_sessions()
    session_id = secrets.token_hex(16)
    session = AnalysisSession(session_id, ticker)
    _sessions[session_id] = session
    return session


def get_session(session_id: str) -> AnalysisSession | None:
    return _sessions.get(session_id)


def remove_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


# --- Periodic cleanup ---

_cleanup_task: asyncio.Task | None = None


async def _periodic_cleanup() -> None:
    """Background task that cleans up stale sessions every 60 seconds."""
    while True:
        await asyncio.sleep(60)
        try:
            _cleanup_stale_sessions()
        except Exception as e:
            log.warning("Session cleanup error: %s", e)


def start_cleanup_loop() -> None:
    """Start the periodic cleanup task. Called from server lifespan."""
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_periodic_cleanup())
