"""
arfour — User Routes

GET  /api/user/profile      — credits, tier, member since
GET  /api/user/analyses      — paginated analysis history
GET  /api/user/analyses/{id} — full saved analysis result
DELETE /api/user/account     — delete account and all data (GDPR)
"""

import logging

from fastapi import APIRouter, Request, HTTPException, Query

from api.services.supabase import get_supabase_admin
from api.services.credits import get_usage, ensure_profile

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/user/profile")
async def get_profile(request: Request):
    """Get current user's profile and credit info."""
    user_id = request.state.user_id
    await ensure_profile(user_id)
    usage = await get_usage(user_id)
    return usage


@router.get("/api/user/analyses")
async def list_analyses(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """Get paginated list of user's past analyses."""
    user_id = request.state.user_id
    await ensure_profile(user_id)
    sb = get_supabase_admin()

    offset = (page - 1) * limit

    result = await sb.from_("analyses").select(
        "id, ticker, status, cost_usd, created_at"
    ).eq("user_id", user_id).order(
        "created_at", desc=True
    ).range(offset, offset + limit - 1).execute()

    # Get total count
    count_result = await sb.from_("analyses").select(
        "id", count="exact"
    ).eq("user_id", user_id).execute()

    return {
        "analyses": result.data,
        "total": count_result.count or 0,
        "page": page,
        "limit": limit,
    }


@router.get("/api/user/analyses/{analysis_id}")
async def get_analysis(request: Request, analysis_id: str):
    """Get full saved analysis result."""
    user_id = request.state.user_id
    sb = get_supabase_admin()

    result = await sb.from_("analyses").select("*").eq(
        "id", analysis_id
    ).eq("user_id", user_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return result.data


@router.delete("/api/user/account")
async def delete_account(request: Request):
    """Delete user account and all associated data (GDPR right-to-deletion).
    Cascading deletes handle analyses and credit_ledger via foreign keys.
    """
    user_id = request.state.user_id
    sb = get_supabase_admin()

    try:
        # Delete profile — cascades to analyses and credit_ledger
        await sb.from_("profiles").delete().eq("id", user_id).execute()
        log.info("Deleted account and all data for user %s", user_id)
    except Exception as e:
        log.error("Failed to delete account for %s: %s", user_id, e)
        raise HTTPException(status_code=500, detail="Failed to delete account")

    return {"status": "deleted"}
