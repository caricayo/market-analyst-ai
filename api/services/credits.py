"""
arfour — Credit System

Manages user credits: check balance, deduct on analysis, query usage.
Uses optimistic locking for race-safe credit deduction.
"""

import logging

from api.services.supabase import get_supabase_admin

log = logging.getLogger(__name__)


async def check_credits(user_id: str) -> tuple[bool, int]:
    """Check if user has credits remaining. Returns (has_credits, credits_remaining)."""
    sb = get_supabase_admin()
    try:
        result = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
    except Exception as e:
        log.error("Failed to check credits for %s: %s", user_id, e)
        return False, 0
    if not result.data:
        return False, 0
    credits = result.data["credits_remaining"]
    return credits > 0, credits


async def deduct_credit(user_id: str, analysis_id: str) -> int:
    """Atomically deduct one credit using optimistic locking. Returns new balance or -1 on failure."""
    sb = get_supabase_admin()

    for attempt in range(2):
        try:
            profile = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
        except Exception as e:
            log.error("Failed to read credits for %s: %s", user_id, e)
            return -1

        if not profile.data or profile.data["credits_remaining"] <= 0:
            return -1

        current = profile.data["credits_remaining"]
        new_balance = current - 1

        # Optimistic lock: only update if balance hasn't changed since we read it
        try:
            result = sb.from_("profiles").update(
                {"credits_remaining": new_balance}
            ).eq("id", user_id).eq("credits_remaining", current).execute()
        except Exception as e:
            log.error("Failed to deduct credit for %s: %s", user_id, e)
            return -1

        if result.data:
            # Success — log to ledger
            try:
                sb.from_("credit_ledger").insert({
                    "user_id": user_id,
                    "delta": -1,
                    "reason": "analysis",
                    "analysis_id": analysis_id,
                }).execute()
            except Exception as e:
                log.warning("Failed to write ledger entry for %s: %s", user_id, e)

            return new_balance

        # Optimistic lock failed — another request changed the balance. Retry.
        log.info("Credit deduction optimistic lock miss for %s (attempt %d)", user_id, attempt + 1)

    return -1


async def refund_credit(user_id: str, analysis_id: str) -> int:
    """Refund one credit (e.g. on pipeline error). Returns new balance or -1."""
    sb = get_supabase_admin()
    try:
        profile = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
        if not profile.data:
            return -1
        new_balance = profile.data["credits_remaining"] + 1
        sb.from_("profiles").update({"credits_remaining": new_balance}).eq("id", user_id).execute()

        sb.from_("credit_ledger").insert({
            "user_id": user_id,
            "delta": 1,
            "reason": "refund_error",
            "analysis_id": analysis_id,
        }).execute()

        log.info("Refunded credit for user %s, analysis %s", user_id, analysis_id)
        return new_balance
    except Exception as e:
        log.error("Failed to refund credit for %s: %s", user_id, e)
        return -1


async def get_usage(user_id: str) -> dict:
    """Get user's credit info and usage stats."""
    sb = get_supabase_admin()

    try:
        profile = sb.from_("profiles").select(
            "credits_remaining, tier, credits_reset_at, created_at"
        ).eq("id", user_id).single().execute()
    except Exception as e:
        log.error("Failed to get usage for %s: %s", user_id, e)
        profile = type("R", (), {"data": None})()

    if not profile.data:
        return {
            "credits_remaining": 0,
            "tier": "free",
            "credits_reset_at": None,
            "member_since": None,
            "total_analyses": 0,
        }

    # Count total analyses
    try:
        analysis_count = sb.from_("analyses").select(
            "id", count="exact"
        ).eq("user_id", user_id).execute()
        total = analysis_count.count or 0
    except Exception as e:
        log.error("Failed to count analyses for %s: %s", user_id, e)
        total = 0

    return {
        "credits_remaining": profile.data["credits_remaining"],
        "tier": profile.data["tier"],
        "credits_reset_at": profile.data["credits_reset_at"],
        "member_since": profile.data["created_at"],
        "total_analyses": total,
    }


async def ensure_profile(user_id: str) -> None:
    """Create profile row if it doesn't exist (called on first authenticated request)."""
    sb = get_supabase_admin()
    try:
        existing = sb.from_("profiles").select("id").eq("id", user_id).execute()
        if not existing.data:
            sb.from_("profiles").insert({
                "id": user_id,
                "tier": "free",
                "credits_remaining": 3,
            }).execute()
    except Exception as e:
        log.error("Failed to ensure profile for %s: %s", user_id, e)
