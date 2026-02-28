"""
arfour — Event Bus

Manages analysis sessions with asyncio.Queue-based event streaming.
Enforces one-at-a-time concurrency.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


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
        self.queue: asyncio.Queue[PipelineEvent] = asyncio.Queue()
        self.event_history: list[PipelineEvent] = []
        self.start_time = time.time()
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
        self.is_complete = True
        self.result = data
        elapsed = time.time() - self.start_time
        self.emit(PipelineEvent(
            event_type="analysis_complete",
            elapsed=elapsed,
            data=data,
        ))

    def emit_error(self, error_msg: str) -> None:
        self.is_complete = True
        self.error = error_msg
        elapsed = time.time() - self.start_time
        self.emit(PipelineEvent(
            event_type="analysis_error",
            detail=error_msg,
            elapsed=elapsed,
        ))


# Global session — one at a time
_current_session: AnalysisSession | None = None


def create_session(ticker: str) -> AnalysisSession:
    global _current_session
    if _current_session and not _current_session.is_complete:
        raise RuntimeError("An analysis is already in progress")
    session_id = uuid.uuid4().hex[:12]
    _current_session = AnalysisSession(session_id, ticker)
    return _current_session


def get_current_session() -> AnalysisSession | None:
    return _current_session


def clear_session() -> None:
    global _current_session
    _current_session = None
