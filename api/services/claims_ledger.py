"""
arfor - Stage 2 Claims Ledger Parsing and Validation

Provides strict parsing/validation for the Stage-2 diligence contract:
  - PART A markdown memo
  - PART B claims ledger JSON array
"""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable


REQUIRED_KEYS = {
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

CLAIM_TYPE_VALUES = {"numeric", "qualitative"}
CONFIDENCE_VALUES = {"low", "medium", "high"}
SOURCE_TYPE_VALUES = {"SEC/IR", "reputable_market_data", "estimate", "unknown"}

DEAL_KEYWORDS = (
    "acquire",
    "acquisition",
    "to be acquired",
    "definitive agreement",
    "offer price",
    "merger",
)

PART_B_MARKER_RE = re.compile(r"(?im)^\s*part\s*b\b")
NUMERIC_TOKEN_RE = re.compile(
    r"(?ix)"
    r"(?:\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|bp|bps))?)"
    r"|"
    r"(?:\d[\d,]*(?:\.\d+)?\s?(?:million|billion|trillion|mn|bn|mm))"
)

MANDATORY_PART_A_SECTIONS = [
    "Business Model & Revenue Architecture",
    "Competitive Position & Power Structure",
    "Financial Quality Snapshot",
    "Capital Structure & Liquidity",
    "Leadership, Governance & Incentives",
    "SBC & Dilution Analysis",
    "Structural vs Cyclical Risk Separation",
    "Strategic Optionality & Upside Drivers",
    "Market Belief vs Mispricing Hypothesis",
    "Investment Framing Summary",
]

MANAGEMENT_CLAIM_TERMS = (
    "ceo",
    "cfo",
    "board",
    "director",
    "governance",
    "executive",
    "incentive",
    "compensation",
    "chair",
)


def detect_deal_signal(research_brief: str) -> bool:
    """Heuristic acquisition detection from research brief text."""
    text_l = (research_brief or "").lower()
    return any(keyword in text_l for keyword in DEAL_KEYWORDS)


def _extract_first_json_array(text: str) -> str | None:
    start = text.find("[")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False
    end_idx: int | None = None
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break

    if end_idx is None:
        return None
    return text[start:end_idx]


def _strip_part_a_heading(text: str) -> str:
    text = text.strip()
    text = re.sub(r"(?is)^\s*part\s*a\b[^\n]*\n?", "", text).strip()
    return text


def parse_stage2_output(text: str) -> tuple[str, str | None]:
    """
    Parse Stage-2 output into:
      (part_a_markdown, ledger_json_text)

    If PART B marker is missing:
      - returns full text as PART A
      - returns None as ledger_json_text
    """
    body = (text or "").replace("\r\n", "\n")
    marker = PART_B_MARKER_RE.search(body)
    if not marker:
        return _strip_part_a_heading(body), None

    part_a = _strip_part_a_heading(body[: marker.start()])
    part_b_block = body[marker.end() :]
    return part_a, _extract_first_json_array(part_b_block)


def _append_note(claim: dict[str, Any], note: str) -> None:
    existing = claim.get("notes")
    if isinstance(existing, str) and existing.strip():
        claim["notes"] = f"{existing.strip()} | {note}"
    else:
        claim["notes"] = note


def _normalize_claim(raw_claim: dict[str, Any], idx: int, normalization_notes: list[str]) -> dict[str, Any]:
    claim: dict[str, Any] = {key: raw_claim.get(key) for key in REQUIRED_KEYS}

    missing = sorted(REQUIRED_KEYS - set(raw_claim.keys()))
    if missing:
        normalization_notes.append(
            f"Claim {idx}: missing keys filled with defaults: {', '.join(missing)}."
        )

    if claim.get("claim_type") not in CLAIM_TYPE_VALUES:
        claim["claim_type"] = "qualitative"
        normalization_notes.append(f"Claim {idx}: claim_type normalized to qualitative.")

    if not isinstance(claim.get("metric"), str) or not claim["metric"].strip():
        claim["metric"] = "unknown_metric"
        normalization_notes.append(f"Claim {idx}: metric normalized to unknown_metric.")

    if not isinstance(claim.get("statement"), str) or not claim["statement"].strip():
        claim["statement"] = "Unverified  requires primary filing review."
        normalization_notes.append(f"Claim {idx}: statement defaulted to unverified.")

    if claim.get("confidence") not in CONFIDENCE_VALUES:
        claim["confidence"] = "low"
        normalization_notes.append(f"Claim {idx}: confidence normalized to low.")

    if claim.get("source_type") not in SOURCE_TYPE_VALUES:
        claim["source_type"] = "unknown"
        normalization_notes.append(f"Claim {idx}: source_type normalized to unknown.")

    citation = claim.get("source_citation")
    if not isinstance(citation, str) or not citation.strip():
        claim["source_citation"] = "unverified"
        normalization_notes.append(f"Claim {idx}: source_citation normalized to unverified.")

    # Standardize optional fields
    if not isinstance(claim.get("unit"), str) or not str(claim["unit"]).strip():
        claim["unit"] = None
    if not isinstance(claim.get("timeframe"), str) or not str(claim["timeframe"]).strip():
        claim["timeframe"] = None

    if not isinstance(claim.get("notes"), str):
        claim["notes"] = ""

    value = claim.get("value")
    if value is not None and not isinstance(value, (int, float)):
        claim["value"] = None
        normalization_notes.append(f"Claim {idx}: non-numeric value set to null.")

    if claim["claim_type"] == "numeric":
        missing_numeric_fields = []
        if claim["timeframe"] is None:
            missing_numeric_fields.append("timeframe")
        if claim["unit"] is None:
            missing_numeric_fields.append("unit")
        if claim["source_type"] in {None, "unknown"}:
            missing_numeric_fields.append("source_type")
        if str(claim["source_citation"]).strip().lower() == "unverified":
            missing_numeric_fields.append("source_citation")

        if missing_numeric_fields:
            claim["source_type"] = "unknown"
            claim["source_citation"] = "unverified"
            claim["confidence"] = "low"
            _append_note(
                claim,
                "Numeric claim missing sourcing envelope: "
                + ", ".join(missing_numeric_fields)
                + ". Normalized as unverified.",
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

    return claim


def _line_has_unverified_envelope(line: str) -> bool:
    line_l = line.lower()
    if "unverified" in line_l and "requires primary filing review" in line_l:
        return True
    return (
        "timeframe" in line_l
        and "unit" in line_l
        and "source_type" in line_l
        and "source_citation" in line_l
    )


def _validate_part_a_numeric_coverage(part_a_md: str, ledger: list[dict[str, Any]], parse_errors: list[str]) -> None:
    ledger_statement_blob = " ".join(
        str(claim.get("statement", "")) for claim in ledger if isinstance(claim, dict)
    ).lower()
    ledger_value_blob = " ".join(
        str(claim.get("value"))
        for claim in ledger
        if isinstance(claim, dict) and claim.get("value") is not None
    ).lower()

    for line_no, raw_line in enumerate(part_a_md.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        tokens = [m.group(0).lower() for m in NUMERIC_TOKEN_RE.finditer(line)]
        if not tokens:
            continue
        if _line_has_unverified_envelope(line):
            continue

        missing = []
        for token in tokens:
            if token in ledger_statement_blob or token in ledger_value_blob:
                continue
            missing.append(token)
        if missing:
            parse_errors.append(
                f"PART A line {line_no}: numeric tokens not covered by claims ledger or unverified envelope: {missing}"
            )


def _validate_required_sections(part_a_md: str, parse_errors: list[str]) -> None:
    text_l = part_a_md.lower()
    for section in MANDATORY_PART_A_SECTIONS:
        if f"## {section}".lower() not in text_l:
            parse_errors.append(f"PART A missing mandatory section: {section}")


def _validate_management_claim_coverage(part_a_md: str, ledger: list[dict[str, Any]], parse_errors: list[str]) -> None:
    text_l = part_a_md.lower()
    if "## leadership, governance & incentives" not in text_l:
        return

    ledger_blob = " ".join(
        " ".join(
            str(claim.get(k, ""))
            for k in ("metric", "statement", "notes")
        )
        for claim in ledger
        if isinstance(claim, dict)
    ).lower()

    if not any(term in ledger_blob for term in MANAGEMENT_CLAIM_TERMS):
        parse_errors.append(
            "Leadership, Governance & Incentives present in PART A but corresponding governance claims were not found in PART B."
        )


def load_and_validate_ledger(ledger_json_text: str | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Parse and validate claims ledger JSON array.
    """
    parse_errors: list[str] = []
    normalization_notes: list[str] = []
    normalized_claims: list[dict[str, Any]] = []

    if ledger_json_text is None:
        parse_errors.append("Missing PART B claims ledger JSON.")
        return [], {
            "valid": False,
            "parse_errors": parse_errors,
            "normalization_notes": normalization_notes,
            "claim_count": 0,
        }

    try:
        payload = json.loads(ledger_json_text)
    except json.JSONDecodeError as exc:
        parse_errors.append(f"Claims ledger JSON parse error: {exc}")
        return [], {
            "valid": False,
            "parse_errors": parse_errors,
            "normalization_notes": normalization_notes,
            "claim_count": 0,
        }

    if not isinstance(payload, list):
        parse_errors.append("Claims ledger payload must be a JSON array.")
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
        normalized_claims.append(_normalize_claim(raw_claim, idx, normalization_notes))

    return normalized_claims, {
        "valid": len(parse_errors) == 0,
        "parse_errors": parse_errors,
        "normalization_notes": normalization_notes,
        "claim_count": len(normalized_claims),
    }


def parse_and_validate_stage2_output(
    output_text: str,
    *,
    deal_detected: bool = False,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Convenience wrapper:
      - parse Stage-2 output
      - validate claims ledger
      - enforce numeric coverage hard-rule on PART A
    """
    part_a, ledger_json_text = parse_stage2_output(output_text)
    claims_ledger, meta = load_and_validate_ledger(ledger_json_text)

    parse_errors = list(meta.get("parse_errors", []))
    if not part_a.strip():
        parse_errors.append("PART A markdown is empty.")
    if ledger_json_text is None:
        parse_errors.append("PART B marker missing or JSON array not found.")

    _validate_required_sections(part_a, parse_errors)
    _validate_part_a_numeric_coverage(part_a, claims_ledger, parse_errors)
    _validate_management_claim_coverage(part_a, claims_ledger, parse_errors)

    merged_meta = {
        "valid": len(parse_errors) == 0,
        "parse_errors": parse_errors,
        "normalization_notes": meta.get("normalization_notes", []),
        "claim_count": meta.get("claim_count", len(claims_ledger)),
        "repair_used": False,
        "deal_detected": bool(deal_detected),
    }
    return part_a, claims_ledger, merged_meta


async def validate_stage2_with_repair(
    output_text: str,
    *,
    deal_detected: bool,
    repair_ledger_json_fn: Callable[[dict[str, Any]], Awaitable[str]] | None = None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Parse/validate Stage-2 output and optionally run one ledger-only repair.
    """
    part_a, claims_ledger, claims_meta = parse_and_validate_stage2_output(
        output_text,
        deal_detected=deal_detected,
    )
    if claims_meta.get("valid", False):
        claims_meta["repair_used"] = False
        return part_a, claims_ledger, claims_meta

    if repair_ledger_json_fn is None:
        claims_meta["repair_used"] = False
        return part_a, claims_ledger, claims_meta

    repaired_json_text = (await repair_ledger_json_fn(claims_meta)).strip()
    _, extracted_repair_json = parse_stage2_output(
        f"PART A\n{part_a}\n\nPART B  CLAIMS LEDGER\n{repaired_json_text}"
    )
    repaired_claims, repaired_meta = load_and_validate_ledger(extracted_repair_json)
    repaired_text = (
        f"PART A\n{part_a}\n\nPART B  CLAIMS LEDGER\n{json.dumps(repaired_claims)}"
        if repaired_meta.get("valid")
        else f"PART A\n{part_a}\n\nPART B  CLAIMS LEDGER\n{repaired_json_text}"
    )
    _, repaired_claims, merged_meta = parse_and_validate_stage2_output(
        repaired_text,
        deal_detected=deal_detected,
    )
    merged_meta["repair_used"] = True

    if not merged_meta.get("valid", False):
        return part_a, [], {
            **merged_meta,
            "valid": False,
            "parse_errors": [
                *merged_meta.get("parse_errors", []),
                "Claims ledger invalid after one repair pass; ledger dropped.",
            ],
            "deal_detected": deal_detected,
        }

    return part_a, repaired_claims, merged_meta


# Backward-compatible alias for existing imports.
def parse_and_validate_fact_first_output(
    output_text: str,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    return parse_and_validate_stage2_output(output_text, deal_detected=False)
