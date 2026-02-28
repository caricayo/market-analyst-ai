"""
arfour — User Routes

GET /api/user/profile — credits, tier, member since
GET /api/user/analyses — paginated analysis history
GET /api/user/analyses/{id} — full saved analysis result
"""

from fastapi import APIRouter, Request, HTTPException, Query

from api.services.supabase import get_supabase_admin
from api.services.credits import get_usage

router = APIRouter()


@router.get("/api/user/profile")
async def get_profile(request: Request):
    """Get current user's profile and credit info."""
    user_id = request.state.user_id
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
    sb = get_supabase_admin()

    offset = (page - 1) * limit

    result = sb.from_("analyses").select(
        "id, ticker, status, cost_usd, created_at"
    ).eq("user_id", user_id).order(
        "created_at", desc=True
    ).range(offset, offset + limit - 1).execute()

    # Get total count
    count_result = sb.from_("analyses").select(
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

    result = sb.from_("analyses").select("*").eq(
        "id", analysis_id
    ).eq("user_id", user_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return result.data
