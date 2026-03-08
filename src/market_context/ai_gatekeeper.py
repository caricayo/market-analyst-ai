"""
src/market_context/ai_gatekeeper.py — AI morning gatekeeper.

Collects market context, checks hard auto-blocks, then asks GPT-4o-mini
whether conditions are safe to trade today.

FAIL-SAFE: If AI returns malformed JSON or the API call fails for ANY reason,
the default is trade_today=False. Never assume a failed call means green light.
"""

import os
import json
from datetime import datetime, timezone
from loguru import logger

import config
from src.market_context.fear_greed import fetch_fear_greed
from src.market_context.btc_dominance import fetch_global_data, is_market_cap_crashing
from src.market_context.news_scraper import fetch_headlines, check_block_keywords


# ─── Context collection ───────────────────────────────────────────────────────

def collect_market_context() -> dict:
    """
    Fetch all market context. Individual failures return placeholder values
    rather than crashing the whole gatekeeper.

    Returns:
        dict with all market context fields.
    """
    context = {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "fear_greed": None,
        "fear_greed_label": "Unknown",
        "btc_dominance_pct": None,
        "market_cap_change_24h_pct": None,
        "headlines": [],
        "data_errors": [],
    }

    # Fear & Greed
    try:
        fg = fetch_fear_greed()
        context["fear_greed"] = fg["value"]
        context["fear_greed_label"] = fg["label"]
    except Exception as e:
        context["data_errors"].append(f"Fear/Greed: {e}")
        logger.warning(f"Fear/Greed unavailable: {e}")

    # BTC dominance + market cap
    try:
        global_data = fetch_global_data()
        context["btc_dominance_pct"]      = global_data["btc_dominance_pct"]
        context["market_cap_change_24h_pct"] = global_data["market_cap_change_24h_pct"]
    except Exception as e:
        context["data_errors"].append(f"CoinGecko: {e}")
        logger.warning(f"CoinGecko data unavailable: {e}")

    # News headlines
    try:
        context["headlines"] = fetch_headlines()
    except Exception as e:
        context["data_errors"].append(f"RSS: {e}")
        logger.warning(f"RSS headlines unavailable: {e}")

    return context


# ─── Hard auto-block checks ───────────────────────────────────────────────────

def _check_hard_blocks(ctx: dict) -> tuple[bool, list[str]]:
    """
    Check conditions that automatically block trading without calling AI.

    Returns:
        (should_block, list of reasons)
    """
    reasons = []

    # Fear/Greed is informational only (not a hard auto-block).

    # Market cap crash
    if ctx["market_cap_change_24h_pct"] is not None:
        blocked, reason = is_market_cap_crashing(ctx["market_cap_change_24h_pct"])
        if blocked:
            reasons.append(reason)

    # News block keywords
    blocked, matching = check_block_keywords(ctx["headlines"])
    if blocked:
        reasons.append(f"Block keywords found in news: {'; '.join(matching[:3])}")

    return bool(reasons), reasons


# ─── AI decision ─────────────────────────────────────────────────────────────

_DECISION_SCHEMA = {
    "trade_today":    "boolean — true if safe to trade, false to skip",
    "confidence":     "float 0.0-1.0 — how confident you are in this decision",
    "primary_reason": "string — 1-2 sentence summary of the key factor driving your decision",
    "risk_factors":   "list of strings — top 3 risk factors to watch today",
    "regime":         "string — one of: bull_trend, bear_trend, sideways, high_volatility, extreme_fear, extreme_greed",
}

def _build_prompt(ctx: dict) -> str:
    headlines_text = "\n".join(f"- {h}" for h in ctx["headlines"][:config.NEWS_MAX_HEADLINES])
    fg = ctx["fear_greed"]
    fg_label = ctx["fear_greed_label"]
    dom = ctx["btc_dominance_pct"]
    mc_chg = ctx["market_cap_change_24h_pct"]
    errors = ctx["data_errors"]

    return f"""Today's Date: {ctx['date']}

MARKET CONTEXT:
- Fear & Greed Index: {fg} ({fg_label}) [0=extreme fear, 100=extreme greed]
- BTC Dominance: {dom}%
- 24h Market Cap Change: {f"{mc_chg:.1%}" if mc_chg is not None else "N/A"}
- Data fetch errors: {errors if errors else 'none'}

TOP HEADLINES:
{headlines_text if headlines_text else 'No headlines available'}

TASK:
Based on this market context, should an automated intraday crypto trading system
trade today? The system trades 5 coins with ATR-based stops and 2:1 R:R targets.

Return ONLY a valid JSON object matching this exact schema:
{json.dumps(_DECISION_SCHEMA, indent=2)}

Remember: default to false when uncertain. A missed day is better than a bad day."""


def _call_ai(prompt: str) -> dict:
    """
    Call OpenAI API. Returns parsed JSON dict.

    FAIL-SAFE: Any exception → returns default trade_today=False.
    """
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=config.AI_MODEL,
            messages=[
                {"role": "system", "content": config.AI_GATEKEEPER_SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            max_tokens=400,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"AI returned malformed JSON: {e} — defaulting to trade_today=False")
        return _default_response(f"AI JSON parse error: {e}")
    except Exception as e:
        logger.error(f"AI API call failed: {e} — defaulting to trade_today=False")
        return _default_response(f"AI API error: {e}")


def _default_response(reason: str) -> dict:
    """Fail-safe default: do not trade."""
    return {
        "trade_today": False,
        "confidence": 0.0,
        "primary_reason": f"FAIL-SAFE: {reason}",
        "risk_factors": ["API failure — cannot assess market conditions"],
        "regime": "unknown",
    }


def _validate_response(resp: dict) -> dict:
    """Ensure all required keys exist with correct types."""
    if not isinstance(resp.get("trade_today"), bool):
        logger.warning(f"AI response missing/invalid trade_today — defaulting to False")
        resp["trade_today"] = False
    if "confidence" not in resp:
        resp["confidence"] = 0.5
    if "primary_reason" not in resp:
        resp["primary_reason"] = "No reason provided"
    if "risk_factors" not in resp or not isinstance(resp["risk_factors"], list):
        resp["risk_factors"] = []
    if "regime" not in resp:
        resp["regime"] = "unknown"
    return resp


# ─── Main entrypoint ──────────────────────────────────────────────────────────

def run_gatekeeper() -> dict:
    """
    Full morning gatekeeper pipeline:
    1. Collect market context
    2. Hard auto-block checks (no AI needed)
    3. AI decision

    Returns:
        dict with keys: trade_today, confidence, primary_reason, risk_factors, regime,
                        context (raw market data), hard_blocked (bool), hard_block_reasons
    """
    logger.info("Running morning gatekeeper...")

    ctx = collect_market_context()

    # Hard auto-block checks first (faster, no API cost)
    hard_blocked, hard_reasons = _check_hard_blocks(ctx)
    if hard_blocked:
        logger.warning(f"HARD BLOCK triggered — skipping AI call")
        for r in hard_reasons:
            logger.warning(f"  → {r}")
        return {
            "trade_today": False,
            "confidence": 1.0,
            "primary_reason": f"Auto-blocked: {hard_reasons[0]}",
            "risk_factors": hard_reasons,
            "regime": "blocked",
            "context": ctx,
            "hard_blocked": True,
            "hard_block_reasons": hard_reasons,
        }

    # AI decision
    prompt = _build_prompt(ctx)
    ai_resp = _call_ai(prompt)
    ai_resp = _validate_response(ai_resp)

    result = {
        **ai_resp,
        "context": ctx,
        "hard_blocked": False,
        "hard_block_reasons": [],
    }

    decision = "TRADE" if result["trade_today"] else "SKIP"
    logger.info(
        f"Gatekeeper decision: {decision} | confidence={result['confidence']:.0%} | "
        f"regime={result['regime']}"
    )
    logger.info(f"  Reason: {result['primary_reason']}")

    return result
