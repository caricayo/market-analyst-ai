"""
arfour — Credit System

Manages user credits: check balance, deduct on analysis, query usage.
Uses postgrest-py for direct Supabase REST API access.
"""

from api.services.supabase import get_supabase_admin


async def check_credits(user_id: str) -> tuple[bool, int]:
    """Check if user has credits remaining. Returns (has_credits, credits_remaining)."""
    sb = get_supabase_admin()
    result = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
    credits = result.data["credits_remaining"]
    return credits > 0, credits


async def deduct_credit(user_id: str, analysis_id: str) -> int:
    """Deduct one credit and log to ledger. Returns new balance."""
    sb = get_supabase_admin()

    # Get current balance
    profile = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
    new_balance = profile.data["credits_remaining"] - 1

    # Decrement credits_remaining
    sb.from_("profiles").update({"credits_remaining": new_balance}).eq("id", user_id).execute()

    # Insert ledger entry
    sb.from_("credit_ledger").insert({
        "user_id": user_id,
        "delta": -1,
        "reason": "analysis",
        "analysis_id": analysis_id,
    }).execute()

    return new_balance


async def get_usage(user_id: str) -> dict:
    """Get user's credit info and usage stats."""
    sb = get_supabase_admin()

    profile = sb.from_("profiles").select(
        "credits_remaining, tier, credits_reset_at, created_at"
    ).eq("id", user_id).single().execute()

    # Count total analyses
    analysis_count = sb.from_("analyses").select(
        "id", count="exact"
    ).eq("user_id", user_id).execute()

    return {
        "credits_remaining": profile.data["credits_remaining"],
        "tier": profile.data["tier"],
        "credits_reset_at": profile.data["credits_reset_at"],
        "member_since": profile.data["created_at"],
        "total_analyses": analysis_count.count or 0,
    }


async def ensure_profile(user_id: str) -> None:
    """Create profile row if it doesn't exist (called on first authenticated request)."""
    sb = get_supabase_admin()
    existing = sb.from_("profiles").select("id").eq("id", user_id).execute()
    if not existing.data:
        sb.from_("profiles").insert({
            "id": user_id,
            "tier": "free",
            "credits_remaining": 3,
        }).execute()
