"""
arfour — Analysis Routes

POST /api/analyze — start a new analysis
GET /api/analyze/{id}/stream — SSE event stream
POST /api/analyze/{id}/cancel — cancel running analysis
GET /api/analyze/status — returns inactive (kept for backward compat)
"""

import asyncio
import json
import logging
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from api.services.event_bus import (
    create_session,
    get_session,
    remove_session,
    PipelineEvent,
)
from api.services.pipeline_runner import execute_pipeline
from api.services.credits import deduct_credit, ensure_profile
from api.services.supabase import get_supabase_admin

log = logging.getLogger(__name__)

router = APIRouter()

# Valid ticker: 1-10 uppercase letters/digits, optional dot (e.g. BRK.B)
_TICKER_RE = re.compile(r"^[A-Z0-9]{1,10}(\.[A-Z])?$")


class AnalyzeRequest(BaseModel):
    ticker: str


@router.post("/api/analyze")
async def start_analysis(body: AnalyzeRequest, request: Request):
    """Start a new analysis pipeline. Requires auth and available credits."""
    user_id = request.state.user_id

    # Ensure profile exists (first-time users)
    await ensure_profile(user_id)

    ticker = body.ticker.strip().upper()
    if not ticker or not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker symbol")

    # Create analysis record FIRST (before deducting credit)
    sb = get_supabase_admin()
    try:
        analysis_row = sb.from_("analyses").insert({
            "user_id": user_id,
            "ticker": ticker,
            "status": "running",
            "cost_usd": 0.29,
        }).execute()
        analysis_db_id = analysis_row.data[0]["id"]
    except Exception as e:
        log.error("Failed to create analysis record: %s", e)
        raise HTTPException(status_code=500, detail="Failed to start analysis")

    # Deduct credit atomically BEFORE starting the pipeline
    new_balance = await deduct_credit(user_id, analysis_db_id)
    if new_balance < 0:
        # No credits — clean up the analysis record
        try:
            sb.from_("analyses").delete().eq("id", analysis_db_id).execute()
        except Exception:
            pass
        return JSONResponse(
            status_code=402,
            content={
                "error": "no_credits",
                "detail": "No analysis credits remaining",
                "credits_remaining": 0,
            },
        )

    session = create_session(ticker)
    session.user_id = user_id
    session.analysis_db_id = analysis_db_id

    # Launch pipeline as background task
    session.task = asyncio.create_task(execute_pipeline(session))

    return {
        "analysis_id": session.id,
        "ticker": ticker,
        "credits_remaining": new_balance,
    }


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
    session = get_session(analysis_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis not found")

    async def event_generator():
        # Replay past events
        for event in session.event_history:
            yield _event_to_sse(event)

        # Stream new events
        while not session.is_complete:
            try:
                event = await asyncio.wait_for(session.queue.get(), timeout=30.0)
                yield _event_to_sse(event)
            except asyncio.TimeoutError:
                # Send keepalive
                yield f"data: {json.dumps({'event_type': 'keepalive'})}\n\n"

        # Drain any remaining events (e.g. terminal event enqueued just before is_complete)
        while not session.queue.empty():
            event = session.queue.get_nowait()
            yield _event_to_sse(event)

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
    session = get_session(analysis_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if session.is_complete:
        return {"status": "already_complete"}

    session.is_cancelled = True
    if session.task:
        session.task.cancel()
    session.is_complete = True
    remove_session(analysis_id)

    return {"status": "cancelled"}


@router.get("/api/analyze/status")
async def get_analysis_status():
    """Backward-compat stub. Always returns inactive."""
    return {"active": False}
