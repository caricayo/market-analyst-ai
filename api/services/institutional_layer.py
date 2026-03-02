"""
arfor - Institutional Intelligence Layer

Adds one strategic memo-enrichment pass over an existing deep dive while
enforcing a strict "no new numeric claims" safety guard.
"""

from __future__ import annotations

import logging
import re
from typing import Awaitable, Callable

from deep_dive_prompts import institutional_layer_prompt

log = logging.getLogger(__name__)

ModelCall = Callable[[str, str], Awaitable[str]]

_NUMERIC_TOKEN_RE = re.compile(
    r"""(?ix)
    (?:\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|bp|bps))?)      # 12, 12.5, $12.5, 12%, 3x
    |
    (?:\d[\d,]*(?:\.\d+)?\s?(?:million|billion|trillion|mn|bn|mm))  # 12 billion
    """
)


def _normalize_token(token: str) -> str:
    return re.sub(r"\s+", " ", token.strip().lower())


def extract_numeric_tokens(text: str) -> set[str]:
    """Extract coarse numeric tokens for no-new-number safety checks."""
    return {_normalize_token(match.group(0)) for match in _NUMERIC_TOKEN_RE.finditer(text)}


def find_new_numeric_tokens(input_text: str, output_text: str) -> set[str]:
    """Return numeric tokens present in output but not in input."""
    return extract_numeric_tokens(output_text) - extract_numeric_tokens(input_text)


def _institutional_layer_meta(
    *,
    applied: bool,
    retry_used: bool,
    blocked_new_numbers: bool,
    new_number_count: int,
) -> dict[str, bool | int]:
    return {
        "applied": applied,
        "retry_used": retry_used,
        "blocked_new_numbers": blocked_new_numbers,
        "new_number_count": new_number_count,
    }


def _repair_prompt(
    company: str,
    input_memo: str,
    candidate_memo: str,
    new_tokens: set[str],
) -> tuple[str, str]:
    system_prompt = (
        "You are a precision editor. Remove any new numeric claims not present in the input memo. "
        "Do not add facts. Preserve uncertainty and sourcing language. Return markdown only."
    )
    user_prompt = f"""Company: {company}
Repair the candidate memo so it contains NO numeric token that is not already present verbatim in INPUT MEMO.

New numeric tokens detected:
{sorted(new_tokens)}

INPUT MEMO:
{input_memo}

CANDIDATE MEMO:
{candidate_memo}

Return markdown only.
"""
    return system_prompt, user_prompt


async def apply_institutional_layer(
    *,
    company: str,
    deep_dive_markdown: str,
    model_call: ModelCall,
) -> tuple[str, dict[str, bool | int]]:
    """
    Apply one institutional-intelligence enrichment pass with numeric safeguards.

    Behavior:
      1) generate enriched memo
      2) if new numeric tokens appear, retry once with repair prompt
      3) if still violating, fallback to original input memo
    """
    if not deep_dive_markdown.strip():
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False, retry_used=False, blocked_new_numbers=False, new_number_count=0
        )

    try:
        system_prompt, user_prompt = institutional_layer_prompt(company, deep_dive_markdown)
        candidate = (await model_call(system_prompt, user_prompt)).strip()
    except Exception as exc:
        log.warning("Institutional layer call failed: %s", exc)
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False, retry_used=False, blocked_new_numbers=False, new_number_count=0
        )

    if not candidate:
        log.warning("Institutional layer returned empty output. Falling back to original deep dive.")
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False, retry_used=False, blocked_new_numbers=False, new_number_count=0
        )

    new_tokens = find_new_numeric_tokens(deep_dive_markdown, candidate)
    if not new_tokens:
        return candidate, _institutional_layer_meta(
            applied=True, retry_used=False, blocked_new_numbers=False, new_number_count=0
        )

    log.warning(
        "Institutional layer introduced %d new numeric tokens. Retrying repair pass.",
        len(new_tokens),
    )

    try:
        repair_system, repair_user = _repair_prompt(company, deep_dive_markdown, candidate, new_tokens)
        repaired = (await model_call(repair_system, repair_user)).strip()
    except Exception as exc:
        log.warning("Institutional layer repair call failed: %s", exc)
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False,
            retry_used=True,
            blocked_new_numbers=True,
            new_number_count=len(new_tokens),
        )

    if not repaired:
        log.warning("Institutional layer repair returned empty output. Falling back.")
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False,
            retry_used=True,
            blocked_new_numbers=True,
            new_number_count=len(new_tokens),
        )

    post_repair_tokens = find_new_numeric_tokens(deep_dive_markdown, repaired)
    if post_repair_tokens:
        log.warning(
            "Institutional layer blocked: %d new numeric tokens remain after repair.",
            len(post_repair_tokens),
        )
        return deep_dive_markdown, _institutional_layer_meta(
            applied=False,
            retry_used=True,
            blocked_new_numbers=True,
            new_number_count=len(post_repair_tokens),
        )

    return repaired, _institutional_layer_meta(
        applied=True,
        retry_used=True,
        blocked_new_numbers=False,
        new_number_count=0,
    )
