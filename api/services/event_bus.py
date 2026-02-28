"""
arfour — Event Bus

Manages analysis sessions with asyncio.Queue-based event streaming.
Supports concurrent sessions keyed by session ID.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

# Auto-cleanup: remove completed sessions older than this (seconds)
_SESSION_TTL = 600  # 10 minutes


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
    session_id = uuid.uuid4().hex[:12]
    session = AnalysisSession(session_id, ticker)
    _sessions[session_id] = session
    return session


def get_session(session_id: str) -> AnalysisSession | None:
    return _sessions.get(session_id)


def remove_session(session_id: str) -> None:
    _sessions.pop(session_id, None)
