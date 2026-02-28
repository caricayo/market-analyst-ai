"""
arfour — Credit System

Manages user credits: check balance, deduct on analysis, query usage.
Uses optimistic locking for race-safe credit deduction.
Weekly reset: free users auto-refill to 3 credits every 7 days (lazy check).
"""

import logging
from datetime import datetime, timedelta, timezone

from api.services.supabase import get_supabase_admin

log = logging.getLogger(__name__)

FREE_WEEKLY_CREDITS = 3
RESET_INTERVAL_DAYS = 7


async def maybe_reset_weekly_credits(user_id: str) -> None:
    """Lazy weekly reset: if credits_reset_at is null or 7+ days old,
    set credits_remaining = max(current, FREE_WEEKLY_CREDITS) and update timestamp.
    """
    sb = get_supabase_admin()
    try:
        profile = sb.from_("profiles").select(
            "credits_remaining, credits_reset_at"
        ).eq("id", user_id).single().execute()
    except Exception as e:
        log.error("Failed to read profile for weekly reset (%s): %s", user_id, e)
        return

    if not profile.data:
        return

    reset_at = profile.data.get("credits_reset_at")
    now = datetime.now(timezone.utc)

    needs_reset = False
    if reset_at is None:
        needs_reset = True
    else:
        # Parse ISO timestamp from Supabase
        if isinstance(reset_at, str):
            reset_at = datetime.fromisoformat(reset_at.replace("Z", "+00:00"))
        if now - reset_at >= timedelta(days=RESET_INTERVAL_DAYS):
            needs_reset = True

    if not needs_reset:
        return

    current = profile.data["credits_remaining"]
    new_balance = max(current, FREE_WEEKLY_CREDITS)
    delta = new_balance - current

    try:
        sb.from_("profiles").update({
            "credits_remaining": new_balance,
            "credits_reset_at": now.isoformat(),
        }).eq("id", user_id).execute()

        if delta > 0:
            sb.from_("credit_ledger").insert({
                "user_id": user_id,
                "delta": delta,
                "reason": "weekly_reset",
            }).execute()

        log.info("Weekly reset for %s: %d -> %d (delta %d)", user_id, current, new_balance, delta)
    except Exception as e:
        log.error("Failed to apply weekly reset for %s: %s", user_id, e)


async def check_credits(user_id: str) -> tuple[bool, int]:
    """Check if user has credits remaining. Returns (has_credits, credits_remaining)."""
    await maybe_reset_weekly_credits(user_id)

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
    await maybe_reset_weekly_credits(user_id)

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
            "next_reset": None,
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

    # Compute next reset time
    reset_at = profile.data.get("credits_reset_at")
    next_reset = None
    if reset_at:
        if isinstance(reset_at, str):
            reset_at_dt = datetime.fromisoformat(reset_at.replace("Z", "+00:00"))
        else:
            reset_at_dt = reset_at
        next_reset = (reset_at_dt + timedelta(days=RESET_INTERVAL_DAYS)).isoformat()

    return {
        "credits_remaining": profile.data["credits_remaining"],
        "tier": profile.data["tier"],
        "credits_reset_at": profile.data["credits_reset_at"],
        "next_reset": next_reset,
        "member_since": profile.data["created_at"],
        "total_analyses": total,
    }


async def ensure_profile(user_id: str) -> None:
    """Create profile row if it doesn't exist (called on first authenticated request)."""
    sb = get_supabase_admin()
    try:
        existing = sb.from_("profiles").select("id").eq("id", user_id).execute()
        if not existing.data:
            now = datetime.now(timezone.utc).isoformat()
            sb.from_("profiles").insert({
                "id": user_id,
                "tier": "free",
                "credits_remaining": FREE_WEEKLY_CREDITS,
                "credits_reset_at": now,
            }).execute()
    except Exception as e:
        log.error("Failed to ensure profile for %s: %s", user_id, e)


async def add_purchased_credits(user_id: str, amount: int, stripe_session_id: str) -> bool:
    """Add purchased credits. Idempotent via unique stripe_session_id in ledger.
    Uses optimistic locking for race-safe balance update.
    Returns True if credits were added, False if already processed or error.
    """
    sb = get_supabase_admin()
    try:
        # Insert ledger entry — unique index on stripe_session_id prevents duplicates
        sb.from_("credit_ledger").insert({
            "user_id": user_id,
            "delta": amount,
            "reason": "purchase",
            "stripe_session_id": stripe_session_id,
        }).execute()
    except Exception as e:
        # Unique constraint violation means already processed — that's fine
        error_str = str(e)
        if "duplicate" in error_str.lower() or "unique" in error_str.lower() or "23505" in error_str:
            log.info("Duplicate purchase webhook for session %s — skipping", stripe_session_id)
            return False
        log.error("Failed to insert purchase ledger for %s: %s", user_id, e)
        return False

    # Update balance with optimistic locking (retry up to 3 times)
    for attempt in range(3):
        try:
            profile = sb.from_("profiles").select("credits_remaining").eq("id", user_id).single().execute()
            if not profile.data:
                log.error("No profile found for %s after purchase ledger insert", user_id)
                return False

            current = profile.data["credits_remaining"]
            new_balance = current + amount

            # Optimistic lock: only update if balance hasn't changed
            result = sb.from_("profiles").update(
                {"credits_remaining": new_balance}
            ).eq("id", user_id).eq("credits_remaining", current).execute()

            if result.data:
                log.info("Added %d purchased credits for %s (new balance: %d)", amount, user_id, new_balance)
                return True

            # Lock miss — concurrent deduction changed the balance. Retry.
            log.info("Purchase credit optimistic lock miss for %s (attempt %d)", user_id, attempt + 1)
        except Exception as e:
            log.error("Failed to update balance after purchase for %s: %s", user_id, e)
            return False

    log.error("Purchase credit update failed after 3 attempts for %s", user_id)
    return False
