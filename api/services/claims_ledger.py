"""
arfor - Claims Ledger Parsing and Validation

Parses strict fact-first Stage 2 output:
  - PART A markdown narrative
  - PART B JSON claims ledger

Normalizes and validates claims so downstream storage is stable even when model
formatting is imperfect.
"""

from __future__ import annotations

import json
import re
from typing import Any


_REQUIRED_KEYS = {
    "claim_type",
    "metric",
    "value",
    "unit",
    "timeframe",
    "statement",
    "confidence",
    "source_type",
    "source_citation",
    "notes",
}

_CLAIM_TYPE_VALUES = {"numeric", "qualitative"}
_CONFIDENCE_VALUES = {"low", "medium", "high"}
_SOURCE_TYPE_VALUES = {"SEC/IR", "reputable_market_data", "estimate", "unknown"}

_DEFINITION_RISK_TERMS = {
    "gross margin": "Definition risk: gross margin can be reported differently across issuers.",
    "contribution margin": "Definition risk: contribution margin is non-GAAP and can vary by company.",
    "leverage": "Definition risk: leverage may differ between recourse and non-recourse scopes.",
    "net debt/ebitda": "Definition risk: net debt/EBITDA comparability depends on debt scope and EBITDA definition.",
    "ebitda": "Definition risk: adjusted EBITDA add-backs may reduce comparability.",
}


def _extract_first_json_array(text: str) -> str | None:
    """Extract the first syntactically balanced JSON array substring."""
    start = text.find("[")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False
    end = None

    for idx in range(start, len(text)):
        ch = text[idx]

        if in_string:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue
        if ch == "[":
            depth += 1
            continue
        if ch == "]":
            depth -= 1
            if depth == 0:
                end = idx + 1
                break
            continue

    if end is None:
        return None
    return text[start:end]


def _clean_part_a(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"(?is)^part a\)\s*narrative deep dive\s*\(markdown\)\s*", "", cleaned).strip()
    cleaned = re.sub(r"(?is)^part a\)\s*narrative deep dive\s*", "", cleaned).strip()
    return cleaned


def parse_fact_first_output(output_text: str) -> tuple[str, str | None, list[str]]:
    """
    Parse model output into (part_a_markdown, raw_claims_json, parse_errors).
    """
    text = output_text.replace("\r\n", "\n")
    errors: list[str] = []

    part_b_match = re.search(r"(?im)^part b\)\s*claims ledger", text)
    if part_b_match:
        part_a_block = text[:part_b_match.start()].strip()
        part_b_block = text[part_b_match.start():]
    else:
        part_a_block = text.strip()
        part_b_block = text
        errors.append("PART B marker not found; attempted raw JSON extraction from full output.")

    part_a = _clean_part_a(part_a_block)
    raw_json = _extract_first_json_array(part_b_block)
    if raw_json is None:
        errors.append("Could not extract JSON array for claims ledger.")

    if not part_a:
        errors.append("PART A narrative was empty after parsing.")

    return part_a, raw_json, errors


def _normalize_source_fields(
    claim: dict[str, Any],
    normalization_notes: list[str],
    idx: int,
) -> None:
    source_type = claim.get("source_type")
    source_citation = claim.get("source_citation")

    if source_type not in _SOURCE_TYPE_VALUES:
        claim["source_type"] = "unknown"
        normalization_notes.append(f"Claim {idx}: source_type normalized to unknown.")
    if not isinstance(source_citation, str) or not source_citation.strip():
        claim["source_citation"] = "unverified"
        normalization_notes.append(f"Claim {idx}: source_citation normalized to unverified.")


def _append_note(claim: dict[str, Any], note: str) -> None:
    existing = claim.get("notes")
    if isinstance(existing, str) and existing.strip():
        claim["notes"] = f"{existing.strip()} | {note}"
    else:
        claim["notes"] = note


def validate_claims_ledger(raw_json: str | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Validate and normalize claims ledger JSON.

    Returns:
      (claims, meta)
      meta keys: valid, parse_errors, normalization_notes, claim_count
    """
    parse_errors: list[str] = []
    normalization_notes: list[str] = []
    normalized_claims: list[dict[str, Any]] = []

    if raw_json is None:
        parse_errors.append("Claims JSON is missing.")
        return [], {
            "valid": False,
            "parse_errors": parse_errors,
            "normalization_notes": normalization_notes,
            "claim_count": 0,
        }

    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        parse_errors.append(f"Claims JSON parse error: {exc}")
        return [], {
            "valid": False,
            "parse_errors": parse_errors,
            "normalization_notes": normalization_notes,
            "claim_count": 0,
        }

    if not isinstance(payload, list):
        parse_errors.append("Claims payload is not a JSON array.")
        return [], {
            "valid": False,
            "parse_errors": parse_errors,
            "normalization_notes": normalization_notes,
            "claim_count": 0,
        }

    for idx, raw_claim in enumerate(payload):
        if not isinstance(raw_claim, dict):
            normalization_notes.append(f"Claim {idx}: dropped non-object entry.")
            continue

        claim: dict[str, Any] = {key: raw_claim.get(key) for key in _REQUIRED_KEYS}
        missing_keys = sorted(_REQUIRED_KEYS - set(raw_claim.keys()))
        if missing_keys:
            normalization_notes.append(f"Claim {idx}: missing keys filled with null/defaults: {', '.join(missing_keys)}.")

        claim_type = claim.get("claim_type")
        if claim_type not in _CLAIM_TYPE_VALUES:
            claim["claim_type"] = "qualitative"
            normalization_notes.append(f"Claim {idx}: claim_type normalized to qualitative.")

        if not isinstance(claim.get("metric"), str) or not claim["metric"].strip():
            claim["metric"] = "unknown_metric"
            normalization_notes.append(f"Claim {idx}: metric normalized to unknown_metric.")

        value = claim.get("value")
        if value is not None and not isinstance(value, (int, float)):
            claim["value"] = None
            normalization_notes.append(f"Claim {idx}: non-numeric value normalized to null.")

        if not isinstance(claim.get("unit"), str) or not str(claim["unit"]).strip():
            claim["unit"] = None
        if not isinstance(claim.get("timeframe"), str) or not str(claim["timeframe"]).strip():
            claim["timeframe"] = None

        if not isinstance(claim.get("statement"), str) or not claim["statement"].strip():
            claim["statement"] = "Unverified / needs source."
            normalization_notes.append(f"Claim {idx}: statement placeholder added.")

        if claim.get("confidence") not in _CONFIDENCE_VALUES:
            claim["confidence"] = "low"
            normalization_notes.append(f"Claim {idx}: confidence normalized to low.")

        _normalize_source_fields(claim, normalization_notes, idx)

        if not isinstance(claim.get("notes"), str):
            claim["notes"] = ""

        if claim["claim_type"] == "numeric":
            missing_numeric_fields = []
            if claim["timeframe"] is None:
                missing_numeric_fields.append("timeframe")
            if claim["unit"] is None:
                missing_numeric_fields.append("unit")
            if claim["source_type"] == "unknown":
                missing_numeric_fields.append("source_type")
            if str(claim.get("source_citation", "")).strip().lower() == "unverified":
                missing_numeric_fields.append("source_citation")

            if missing_numeric_fields:
                _append_note(
                    claim,
                    "Numeric claim missing required sourcing envelope: "
                    + ", ".join(missing_numeric_fields)
                    + ". Labeled Unverified / needs source.",
                )

            metric_l = str(claim.get("metric", "")).lower()
            statement_l = str(claim.get("statement", "")).lower()
            if "net debt" in metric_l or "net debt" in statement_l:
                if claim["source_type"] == "unknown" or str(claim["source_citation"]).lower() == "unverified":
                    claim["value"] = None
                    claim["unit"] = None
                    claim["timeframe"] = None
                    claim["statement"] = "Net debt not computed due to sourcing limits."
                    _append_note(claim, "Net debt claim neutralized due to incomplete sourcing.")

        lower_metric = str(claim.get("metric", "")).lower()
        for term, note in _DEFINITION_RISK_TERMS.items():
            if term in lower_metric:
                _append_note(claim, note)
                break

        normalized_claims.append(claim)

    meta = {
        "valid": len(parse_errors) == 0,
        "parse_errors": parse_errors,
        "normalization_notes": normalization_notes,
        "claim_count": len(normalized_claims),
    }
    return normalized_claims, meta


def parse_and_validate_fact_first_output(
    output_text: str,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Convenience wrapper for parsing PART A/PART B and validating claims.
    """
    part_a, raw_json, parse_errors = parse_fact_first_output(output_text)
    claims, meta = validate_claims_ledger(raw_json)
    merged_meta = {
        **meta,
        "parse_errors": [*parse_errors, *meta.get("parse_errors", [])],
        "raw_json_extracted": raw_json is not None,
    }
    merged_meta["valid"] = len(merged_meta["parse_errors"]) == 0
    return part_a, claims, merged_meta
