"""
arfor — Stripe Service

One-time credit pack purchases via Stripe Checkout (no subscriptions).
"""

import logging
import os

import stripe

log = logging.getLogger(__name__)

# ── Credit Pack definitions ──────────────────────────────────────────────────

CREDIT_PACKS = {
    "pack_10": {
        "id": "pack_10",
        "credits": 10,
        "price_cents": 500,
        "price_display": "$5",
        "per_credit": "$0.50",
        "label": "10 credits",
    },
    "pack_30": {
        "id": "pack_30",
        "credits": 30,
        "price_cents": 1200,
        "price_display": "$12",
        "per_credit": "$0.40",
        "label": "30 credits",
    },
    "pack_100": {
        "id": "pack_100",
        "credits": 100,
        "price_cents": 3000,
        "price_display": "$30",
        "per_credit": "$0.30",
        "label": "100 credits",
    },
}


def _get_stripe():
    """Initialize Stripe with the secret key."""
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY not configured")
    stripe.api_key = key
    return stripe


def create_checkout_session(
    pack_id: str,
    user_id: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create a Stripe Checkout Session for a credit pack.
    Returns the checkout URL.
    """
    pack = CREDIT_PACKS.get(pack_id)
    if not pack:
        raise ValueError(f"Unknown pack: {pack_id}")

    s = _get_stripe()

    session = s.checkout.Session.create(
        mode="payment",
        customer_creation="always",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": pack["price_cents"],
                "product_data": {
                    "name": f"arfor — {pack['label']}",
                    "description": f"{pack['credits']} analysis credits ({pack['per_credit']}/ea)",
                },
            },
            "quantity": 1,
        }],
        metadata={
            "user_id": user_id,
            "pack_id": pack_id,
            "credits": str(pack["credits"]),
        },
        success_url=success_url,
        cancel_url=cancel_url,
    )

    return session.url


def verify_webhook(payload: bytes, sig_header: str) -> dict:
    """Verify Stripe webhook signature and return the event.

    Raises:
        ValueError: if the payload cannot be parsed
        stripe.error.SignatureVerificationError: if the signature is invalid
    """
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET not configured")

    _get_stripe()
    event = stripe.Webhook.construct_event(payload, sig_header, secret)
    return event
