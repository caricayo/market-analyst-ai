"""
arfor — Analysis Routes

POST /api/analyze — start a new analysis
GET /api/analyze/{id}/stream — SSE event stream
POST /api/analyze/{id}/cancel — cancel running analysis
GET /api/analyze/status — returns inactive (kept for backward compat)
"""

import asyncio
import json
import logging
import re
import time

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
from api.services.credits import deduct_credit, refund_credit, ensure_profile
from api.services.supabase import get_supabase_admin

log = logging.getLogger(__name__)

router = APIRouter()

# Valid ticker: 1-10 uppercase letters/digits, optional dot (e.g. BRK.B)
_TICKER_RE = re.compile(r"^[A-Z0-9]{1,10}(\.[A-Z])?$")

# Demo rate limiting: 1 demo per IP per 24 hours
_demo_usage: dict[str, float] = {}
_DEMO_WINDOW = 86400  # 24 hours


class AnalyzeRequest(BaseModel):
    ticker: str


@router.post("/api/analyze/demo")
async def start_demo_analysis(body: AnalyzeRequest, request: Request):
    """Start a demo analysis — no auth, limited to 1 per IP per 24h."""
    # Get client IP
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not client_ip:
        client_ip = request.client.host if request.client else "unknown"

    # Prune stale entries periodically
    now = time.time()
    stale = [ip for ip, ts in _demo_usage.items() if now - ts > _DEMO_WINDOW]
    for ip in stale:
        del _demo_usage[ip]

    # Check rate limit
    last_demo = _demo_usage.get(client_ip)
    if last_demo and now - last_demo < _DEMO_WINDOW:
        return JSONResponse(
            status_code=429,
            content={
                "detail": "Demo limit reached. Sign up for free to get 3 analyses per week.",
                "demo_limited": True,
            },
        )

    ticker = body.ticker.strip().upper()
    if not ticker or not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker symbol")

    # Mark demo as used for this IP
    _demo_usage[client_ip] = now

    session = create_session(ticker)
    session.user_id = None
    session.analysis_db_id = None

    # Launch pipeline as background task (no DB save, no credits)
    session.task = asyncio.create_task(execute_pipeline(session))

    return {
        "analysis_id": session.id,
        "ticker": ticker,
        "demo": True,
    }


@router.post("/api/analyze")
async def start_analysis(body: AnalyzeRequest, request: Request):
    """Start a new analysis pipeline. Requires auth and available credits."""
    user_id = request.state.user_id

    # Ensure profile exists (first-time users)
    await ensure_profile(user_id)

    ticker = body.ticker.strip().upper()
    if not ticker or not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker symbol")

    sb = get_supabase_admin()

    # Deduct credit FIRST — prevents orphaned records on insufficient balance
    new_balance = await deduct_credit(user_id, None)
    if new_balance < 0:
        return JSONResponse(
            status_code=402,
            content={
                "error": "no_credits",
                "detail": "No analysis credits remaining",
                "credits_remaining": 0,
            },
        )

    # Create analysis record AFTER credit was deducted
    try:
        analysis_row = await sb.from_("analyses").insert({
            "user_id": user_id,
            "ticker": ticker,
            "status": "running",
            "cost_usd": 0.29,
        }).execute()
        analysis_db_id = analysis_row.data[0]["id"]
    except Exception as e:
        log.error("Failed to create analysis record: %s — refunding credit", e)
        await refund_credit(user_id)
        raise HTTPException(status_code=500, detail="Failed to start analysis")

    # Backfill analysis_id on the ledger entry created during deduction
    try:
        await sb.from_("credit_ledger").update({
            "analysis_id": analysis_db_id,
        }).eq("user_id", user_id).eq("reason", "analysis").is_("analysis_id", "null").execute()
    except Exception as e:
        log.warning("Failed to backfill ledger analysis_id: %s", e)

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
