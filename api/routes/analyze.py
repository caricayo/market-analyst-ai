"""
arfour — Analysis Routes

POST /api/analyze — start a new analysis
GET /api/analyze/{id}/stream — SSE event stream
POST /api/analyze/{id}/cancel — cancel running analysis
GET /api/analyze/status — check if analysis is in progress
"""

import asyncio
import json
import time
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.services.event_bus import (
    create_session,
    get_current_session,
    clear_session,
    PipelineEvent,
)
from api.services.pipeline_runner import execute_pipeline

router = APIRouter()


class AnalyzeRequest(BaseModel):
    ticker: str


@router.post("/api/analyze")
async def start_analysis(request: AnalyzeRequest):
    """Start a new analysis pipeline."""
    ticker = request.ticker.strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker is required")

    # Check for existing session
    current = get_current_session()
    if current and not current.is_complete:
        raise HTTPException(
            status_code=409,
            detail="An analysis is already in progress",
        )

    try:
        session = create_session(ticker)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Launch pipeline as background task
    session.task = asyncio.create_task(execute_pipeline(session))

    return {"analysis_id": session.id, "ticker": ticker}


def _event_to_sse(event: PipelineEvent) -> str:
    """Format a PipelineEvent as an SSE message."""
    data = {
        "event_type": event.event_type,
        "stage": event.stage,
        "status": event.status,
        "detail": event.detail,
        "elapsed": round(event.elapsed, 1),
        "timestamp": event.timestamp,
    }
    if event.data is not None:
        data["data"] = event.data
    return f"data: {json.dumps(data)}\n\n"


@router.get("/api/analyze/{analysis_id}/stream")
async def stream_analysis(analysis_id: str):
    """SSE endpoint for streaming analysis events."""
    session = get_current_session()
    if not session or session.id != analysis_id:
        raise HTTPException(status_code=404, detail="Analysis not found")

    async def event_generator():
        # Replay past events
        for event in session.event_history:
            yield _event_to_sse(event)

        # Stream new events
        last_keepalive = time.time()
        while not session.is_complete:
            try:
                event = await asyncio.wait_for(session.queue.get(), timeout=30.0)
                yield _event_to_sse(event)
            except asyncio.TimeoutError:
                # Send keepalive
                yield f"data: {json.dumps({'event_type': 'keepalive'})}\n\n"
                last_keepalive = time.time()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/analyze/{analysis_id}/cancel")
async def cancel_analysis(analysis_id: str):
    """Cancel a running analysis."""
    session = get_current_session()
    if not session or session.id != analysis_id:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if session.is_complete:
        return {"status": "already_complete"}

    session.is_cancelled = True
    if session.task:
        session.task.cancel()
    session.is_complete = True
    clear_session()

    return {"status": "cancelled"}


@router.get("/api/analyze/status")
async def get_analysis_status():
    """Check if an analysis is currently in progress."""
    session = get_current_session()
    if not session:
        return {"active": False}

    return {
        "active": not session.is_complete,
        "analysis_id": session.id,
        "ticker": session.ticker,
        "is_complete": session.is_complete,
        "is_cancelled": session.is_cancelled,
        "elapsed": round(time.time() - session.start_time, 1) if not session.is_complete else None,
    }
