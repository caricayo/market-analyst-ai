"""
arfor — Checkout Routes

Stripe credit pack purchase endpoints.
"""

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from api.services.stripe_service import CREDIT_PACKS, create_checkout_session, verify_webhook
from api.services.credits import add_purchased_credits
from api.services.supabase import get_supabase_admin

_FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/checkout", tags=["checkout"])


@router.get("/packs")
async def get_packs(request: Request):
    """Return available credit packs with pricing."""
    packs = [
        {
            "id": p["id"],
            "credits": p["credits"],
            "price_cents": p["price_cents"],
            "price_display": p["price_display"],
            "per_credit": p["per_credit"],
            "label": p["label"],
        }
        for p in CREDIT_PACKS.values()
    ]
    return {"packs": packs}


@router.post("/session")
async def create_session(request: Request):
    """Create a Stripe Checkout Session. Returns {checkout_url}."""
    user_id = request.state.user_id
    body = await request.json()
    pack_id = body.get("pack_id")

    if pack_id not in CREDIT_PACKS:
        return JSONResponse(status_code=400, content={"detail": f"Unknown pack: {pack_id}"})

    success_url = f"{_FRONTEND_URL}?checkout=success"
    cancel_url = f"{_FRONTEND_URL}?checkout=cancelled"

    try:
        checkout_url = create_checkout_session(
            pack_id=pack_id,
            user_id=user_id,
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return {"checkout_url": checkout_url}
    except Exception as e:
        log.error("Failed to create checkout session: %s", e)
        return JSONResponse(status_code=500, content={"detail": "Failed to create checkout session"})


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhook handler. PUBLIC — verified by signature.

    IMPORTANT: Uses raw request body for signature verification.
    After signature is verified, always return 200 to prevent Stripe retries
    for events that will never succeed (e.g. missing metadata).
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # Signature verification — return 400 only for invalid signatures
    try:
        event = verify_webhook(payload, sig_header)
    except ValueError as e:
        log.warning("Stripe webhook payload parse error: %s", e)
        return JSONResponse(status_code=400, content={"detail": "Invalid payload"})
    except Exception as e:
        log.warning("Stripe webhook signature verification failed: %s", e)
        return JSONResponse(status_code=400, content={"detail": "Invalid signature"})

    # After verification succeeds, always return 200 to Stripe.
    # Log errors internally but don't cause retries for unrecoverable issues.

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        payment_status = session.get("payment_status")

        # Only fulfill if payment is confirmed.
        # For card payments this is always "paid" at session completion.
        # For async methods (bank transfer), it would be "unpaid" — skip.
        if payment_status != "paid":
            log.info(
                "Webhook: session %s has payment_status=%s, skipping fulfillment (waiting for async payment)",
                session.get("id"), payment_status,
            )
            return {"received": True}

        metadata = session.get("metadata", {})
        user_id = metadata.get("user_id")
        credits_str = metadata.get("credits", "0")
        stripe_session_id = session.get("id")

        if not user_id or not credits_str.isdigit() or int(credits_str) <= 0:
            log.error(
                "Webhook: invalid metadata in session %s: user_id=%s credits=%s",
                stripe_session_id, user_id, credits_str,
            )
            # Return 200 — retrying won't fix bad metadata
            return {"received": True}

        credits = int(credits_str)

        # Add credits (idempotent via unique stripe_session_id)
        try:
            added = await add_purchased_credits(user_id, credits, stripe_session_id)
            if added:
                log.info("Webhook: added %d credits for user %s (session %s)", credits, user_id, stripe_session_id)
        except Exception as e:
            log.error("Webhook: failed to add credits for %s: %s", user_id, e)

        # Save stripe_customer_id (customer_creation="always" ensures this is set)
        stripe_customer_id = session.get("customer")
        if stripe_customer_id:
            try:
                sb = get_supabase_admin()
                await sb.from_("profiles").update(
                    {"stripe_customer_id": stripe_customer_id}
                ).eq("id", user_id).execute()
            except Exception as e:
                log.warning("Failed to save stripe_customer_id for %s: %s", user_id, e)

    # Always return 200 after successful signature verification
    return {"received": True}
