"""
arfor - Stage 2 Claims Ledger Parsing and Validation
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable

from api.services.source_policy import (
    classify_claim_source,
    extract_source_domain,
    is_weak_aggregator_domain,
    normalize_source_url,
)

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

OPTIONAL_KEYS = {
    "claim_id",
    "source_url",
    "source_title",
    "source_domain",
    "source_trust_tier",
    "verified_for_counter",
    "as_of_date",
    "is_forward_looking",
    "event_date",
    "definition",
    "excluded_from_text",
    "truth_discipline_valid",
    "truth_discipline_errors",
    "weak_source_used",
    "market_data_kind",
}

CLAIM_TYPE_VALUES = {"numeric", "qualitative"}
CONFIDENCE_VALUES = {"low", "medium", "high"}
SOURCE_TYPE_VALUES = {"SEC/IR", "reputable_market_data", "estimate", "unknown"}
SOURCE_TRUST_TIER_VALUES = {"tier1", "tier2", "tier3", "unknown"}
MARKET_DATA_KIND_VALUES = {"snapshot", "quote"}
CLAIM_ID_RE = re.compile(r"^C\d+$", re.IGNORECASE)

DEAL_KEYWORDS = (
    "acquire",
    "acquisition",
    "to be acquired",
    "definitive agreement",
    "offer price",
    "merger",
)

PART_B_MARKER_RE = re.compile(r"(?im)^\s*part\s*b\b")
CLAIM_MARKER_RE = re.compile(r"\[(C\d+)\]")
NUMERIC_TOKEN_RE = re.compile(
    r"(?ix)"
    r"(?:\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[bmk]|million|billion|trillion|mn|bn|mm|%|x|bp|bps))?)"
    r"|"
    r"(?:\d[\d,]*(?:\.\d+)?(?:\s?(?:[bmk]|million|billion|trillion|mn|bn|mm|%|x|bp|bps)))"
    r"|"
    r"(?:\$\s?\d[\d,]*(?:\.\d+)?\s*[-–]\s*\$?\s?\d[\d,]*(?:\.\d+)?)"
)
SNAPSHOT_HEADING_RE = re.compile(r"(?im)^#{1,6}\s*(Current Price|Market Cap|52[- ]Week Range)\b")
SNAPSHOT_LABEL_RE = re.compile(r"(?i)\b(Current Price:|Market Cap:|52[- ]week range:)\b")
MID_RANGE_RE = re.compile(r"(?i)\b(?:mid|low|high)-\$\d[\d,]*s\b")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MARKET_DATA_FALLBACK = "Data not retrieved in this run."

MARKET_SNAPSHOT_TERMS = (
    "current price",
    "market cap",
    "52-week range",
    "52 week range",
)
MARKET_RUNTIME_REQUIRED_TERMS = (
    "current price",
    "market cap",
    "52-week range",
    "52 week range",
    "dividend yield",
    "short interest",
    "options skew",
    "earnings date",
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

AI_VENDOR_TERMS = (
    "openai",
    "chatgpt",
    "copilot",
    "gemini",
    "anthropic",
)

RESULT_COMPLETED_TERMS = (
    "reported",
    "beat",
    "missed",
    "declined",
    "rose",
    "results",
)
RESULT_FORWARD_TERMS = (
    "expects",
    "guides",
    "projects",
    "scheduled",
)

TIMEFRAME_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)^\d{4}$"),
    re.compile(r"(?i)^fy\s?20\d{2}$"),
    re.compile(r"(?i)^q[1-4]\s?(?:fy\s?)?20\d{2}$"),
    re.compile(r"(?i)^ttm(?:\s+as\s+of)?\s+\d{4}-\d{2}-\d{2}$"),
    re.compile(r"(?i)^quarter\s+ended\s+\d{4}-\d{2}-\d{2}$"),
    re.compile(r"(?i)^as\s+of\s+\d{4}-\d{2}-\d{2}$"),
)


def detect_deal_signal(research_brief: str) -> bool:
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


def _normalize_claim_id(value: Any, idx: int, normalization_notes: list[str]) -> str:
    candidate = str(value or "").strip().upper()
    if CLAIM_ID_RE.fullmatch(candidate):
        return candidate
    generated = f"C{idx + 1}"
    normalization_notes.append(f"Claim {idx}: claim_id normalized to {generated}.")
    return generated


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"true", "1", "yes"}:
            return True
        if s in {"false", "0", "no"}:
            return False
    return default


def _parse_date_yyyy_mm_dd(value: str | None) -> date | None:
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _normalize_event_date(raw_value: Any, idx: int, normalization_notes: list[str]) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    if not value:
        return None
    if ISO_DATE_RE.fullmatch(value):
        return value
    parse_formats = (
        "%m/%d/%Y",
        "%B %d %Y",
        "%B %d, %Y",
        "%b %d %Y",
        "%b %d, %Y",
    )
    for fmt in parse_formats:
        try:
            parsed = datetime.strptime(value, fmt).date()
            normalized = parsed.strftime("%Y-%m-%d")
            normalization_notes.append(f"Claim {idx}: event_date normalized from '{value}' to ISO '{normalized}'.")
            return normalized
        except ValueError:
            continue
    normalization_notes.append(f"Claim {idx}: event_date '{value}' is non-ISO and could not be parsed; treated as missing.")
    return None


def _timeframe_is_valid(value: str | None) -> bool:
    if value is None:
        return False
    cleaned = value.strip()
    if not cleaned:
        return False
    return any(pattern.fullmatch(cleaned) for pattern in TIMEFRAME_PATTERNS)


def _timeframe_to_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    m = re.fullmatch(r"(?i)(\d{4})", text)
    if m:
        return date(int(m.group(1)), 12, 31)
    m = re.fullmatch(r"(?i)fy\s?(20\d{2})", text)
    if m:
        return date(int(m.group(1)), 12, 31)
    m = re.fullmatch(r"(?i)q([1-4])\s?(?:fy\s?)?(20\d{2})", text)
    if m:
        q = int(m.group(1))
        y = int(m.group(2))
        month_day = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
        month, day = month_day[q]
        return date(y, month, day)
    m = re.fullmatch(r"(?i)ttm(?:\s+as\s+of)?\s+(\d{4}-\d{2}-\d{2})", text)
    if m:
        return _parse_date_yyyy_mm_dd(m.group(1))
    m = re.fullmatch(r"(?i)quarter\s+ended\s+(\d{4}-\d{2}-\d{2})", text)
    if m:
        return _parse_date_yyyy_mm_dd(m.group(1))
    m = re.fullmatch(r"(?i)as\s+of\s+(\d{4}-\d{2}-\d{2})", text)
    if m:
        return _parse_date_yyyy_mm_dd(m.group(1))
    return None


def _extract_date_from_statement(statement: str) -> date | None:
    if not statement:
        return None
    iso_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", statement)
    if iso_match:
        return _parse_date_yyyy_mm_dd(iso_match.group(1))
    slash_match = re.search(r"\b(\d{1,2}/\d{1,2}/\d{4})\b", statement)
    if slash_match:
        try:
            return datetime.strptime(slash_match.group(1), "%m/%d/%Y").date()
        except ValueError:
            return None
    quarter_match = re.search(r"\bQ([1-4])\s*(?:FY\s*)?(20\d{2})\b", statement, flags=re.IGNORECASE)
    if quarter_match:
        q = int(quarter_match.group(1))
        y = int(quarter_match.group(2))
        month_day = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
        month, day = month_day[q]
        return date(y, month, day)
    return None

def _normalize_claim(raw_claim: dict[str, Any], idx: int, normalization_notes: list[str], as_of_date: str) -> dict[str, Any]:
    claim: dict[str, Any] = {key: raw_claim.get(key) for key in REQUIRED_KEYS.union(OPTIONAL_KEYS)}

    missing = sorted(REQUIRED_KEYS - set(raw_claim.keys()))
    if missing:
        normalization_notes.append(f"Claim {idx}: missing keys filled with defaults: {', '.join(missing)}.")

    claim["claim_id"] = _normalize_claim_id(claim.get("claim_id"), idx, normalization_notes)

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

    if not isinstance(claim.get("unit"), str) or not str(claim["unit"]).strip():
        claim["unit"] = None
    if not isinstance(claim.get("timeframe"), str) or not str(claim["timeframe"]).strip():
        claim["timeframe"] = None
    if not isinstance(claim.get("notes"), str):
        claim["notes"] = ""
    if not isinstance(claim.get("source_title"), str) or not str(claim["source_title"]).strip():
        claim["source_title"] = None
    if not isinstance(claim.get("definition"), str) or not str(claim["definition"]).strip():
        claim["definition"] = None

    market_data_kind = str(claim.get("market_data_kind") or "").strip().lower()
    claim["market_data_kind"] = market_data_kind if market_data_kind in MARKET_DATA_KIND_VALUES else None

    claim["excluded_from_text"] = _to_bool(claim.get("excluded_from_text"), default=False)
    claim["is_forward_looking"] = _to_bool(claim.get("is_forward_looking"), default=False)
    claim["weak_source_used"] = _to_bool(claim.get("weak_source_used"), default=False)

    truth_errors = claim.get("truth_discipline_errors")
    if isinstance(truth_errors, list):
        claim["truth_discipline_errors"] = [str(item) for item in truth_errors]
    elif isinstance(truth_errors, str) and truth_errors.strip():
        claim["truth_discipline_errors"] = [truth_errors.strip()]
    else:
        claim["truth_discipline_errors"] = []

    claim["truth_discipline_valid"] = claim.get("truth_discipline_valid")
    claim["as_of_date"] = str(claim.get("as_of_date") or as_of_date)
    claim["event_date"] = _normalize_event_date(claim.get("event_date"), idx, normalization_notes)

    source_url = normalize_source_url(claim.get("source_url"))
    if not source_url:
        source_url = normalize_source_url(claim.get("source_citation"))
    claim["source_url"] = source_url
    claim["source_domain"] = (
        str(claim.get("source_domain")).strip().lower()
        if isinstance(claim.get("source_domain"), str) and str(claim.get("source_domain")).strip()
        else extract_source_domain(source_url)
    )

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
            _append_note(claim, "Numeric claim missing sourcing envelope: " + ", ".join(missing_numeric_fields) + ". Normalized as unverified.")

        metric_l = str(claim.get("metric", "")).lower()
        statement_l = str(claim.get("statement", "")).lower()
        if "net debt" in metric_l or "net debt" in statement_l:
            if claim["source_type"] == "unknown" or str(claim["source_citation"]).lower() == "unverified":
                claim["value"] = None
                claim["unit"] = None
                claim["timeframe"] = None
                claim["statement"] = "Net debt not computed due to sourcing limits."
                _append_note(claim, "Net debt claim neutralized due to incomplete sourcing.")

    source_trust_tier, verified_for_counter = classify_claim_source(
        source_type=str(claim.get("source_type", "")),
        source_citation=str(claim.get("source_citation", "")),
        source_url=claim.get("source_url"),
    )
    claim["source_trust_tier"] = source_trust_tier if source_trust_tier in SOURCE_TRUST_TIER_VALUES else "unknown"
    claim["verified_for_counter"] = bool(verified_for_counter)

    if is_weak_aggregator_domain(claim.get("source_domain")):
        claim["weak_source_used"] = True

    if claim["source_trust_tier"] == "unknown" and str(claim.get("source_citation", "")).lower() != "unverified":
        _append_note(claim, "Source trust tier unknown; treated as unverified for counters.")

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


def _extract_part_a_markers(part_a_md: str) -> list[str]:
    return [m.group(1).upper() for m in CLAIM_MARKER_RE.finditer(part_a_md or "")]


def _validate_part_a_numeric_coverage(part_a_md: str, ledger: list[dict[str, Any]], parse_errors: list[str]) -> None:
    ledger_statement_blob = " ".join(str(claim.get("statement", "")) for claim in ledger if isinstance(claim, dict)).lower()
    ledger_value_blob = " ".join(
        str(claim.get("value"))
        for claim in ledger
        if isinstance(claim, dict) and claim.get("value") is not None
    ).lower()

    for line_no, raw_line in enumerate(part_a_md.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        line_without_markers = CLAIM_MARKER_RE.sub("", line)
        tokens = [m.group(0).lower() for m in NUMERIC_TOKEN_RE.finditer(line_without_markers)]
        if not tokens:
            continue
        if _line_has_unverified_envelope(line_without_markers):
            continue

        missing = [token for token in tokens if token not in ledger_statement_blob and token not in ledger_value_blob]
        if missing:
            parse_errors.append(f"PART A line {line_no}: numeric tokens not covered by claims ledger or unverified envelope: {missing}")


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
        " ".join(str(claim.get(k, "")) for k in ("metric", "statement", "notes"))
        for claim in ledger
        if isinstance(claim, dict)
    ).lower()

    if not any(term in ledger_blob for term in MANAGEMENT_CLAIM_TERMS):
        parse_errors.append("Leadership, Governance & Incentives present in PART A but corresponding governance claims were not found in PART B.")


def _validate_claim_id_binding(part_a_md: str, ledger: list[dict[str, Any]], parse_errors: list[str]) -> tuple[list[str], list[str]]:
    markers = _extract_part_a_markers(part_a_md)
    marker_set = set(markers)

    ledger_ids: list[str] = []
    duplicates: set[str] = set()
    for claim in ledger:
        if not isinstance(claim, dict):
            continue
        cid = str(claim.get("claim_id", "")).strip().upper()
        if not CLAIM_ID_RE.fullmatch(cid):
            parse_errors.append(f"Invalid claim_id in ledger: {cid or '[missing]'}")
            continue
        if cid in ledger_ids:
            duplicates.add(cid)
        ledger_ids.append(cid)

    if duplicates:
        parse_errors.append(f"Duplicate claim_id entries in ledger: {sorted(duplicates)}")

    ledger_set = set(ledger_ids)
    missing_claim_ids = sorted(marker_set - ledger_set)
    orphan_claim_ids = sorted(ledger_set - marker_set)

    if not markers:
        parse_errors.append("PART A contains no claim markers ([C#]).")
    if missing_claim_ids:
        parse_errors.append(f"PART A markers missing in PART B ledger: {missing_claim_ids}")
    if orphan_claim_ids:
        parse_errors.append(f"PART B claim_ids not referenced in PART A: {orphan_claim_ids}")

    return missing_claim_ids, orphan_claim_ids

def _is_market_snapshot_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    return any(term in blob for term in MARKET_SNAPSHOT_TERMS)


def _is_runtime_market_metric_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    return any(term in blob for term in MARKET_RUNTIME_REQUIRED_TERMS)


def _claim_has_numeric_payload(claim: dict[str, Any]) -> bool:
    if claim.get("value") is not None:
        return True
    statement = str(claim.get("statement", ""))
    return bool(NUMERIC_TOKEN_RE.search(statement) or MID_RANGE_RE.search(statement))


def _is_named_ai_vendor_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    return any(term in blob for term in AI_VENDOR_TERMS)


def _is_ai_impact_metric_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    if "ai" not in blob:
        return False
    if not _claim_has_numeric_payload(claim):
        return False
    return any(token in blob for token in ("%", "bp", "bps", "improv", "uplift", "reduction"))


def _is_market_share_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    return "market share" in blob


def _is_debt_detail_claim(claim: dict[str, Any]) -> bool:
    blob = f"{claim.get('metric', '')} {claim.get('statement', '')}".lower()
    return any(term in blob for term in ("coupon", "maturity", "revolver", "revolving credit", "interest rate"))


def _implies_completed_result(claim: dict[str, Any]) -> bool:
    statement_l = str(claim.get("statement", "")).lower()
    if any(term in statement_l for term in RESULT_FORWARD_TERMS):
        return False
    return any(term in statement_l for term in RESULT_COMPLETED_TERMS) or bool(re.search(r"\bQ[1-4]\s+20\d{2}\b", statement_l))


def _has_scheduled_event_safeguards(claim: dict[str, Any]) -> bool:
    statement_l = str(claim.get("statement", "")).lower()
    return (
        bool(claim.get("is_forward_looking"))
        and "[scheduled event]" in statement_l
        and bool(claim.get("event_date"))
        and claim.get("source_trust_tier") in {"tier1", "tier2"}
    )


def _is_valid_quote_claim(claim: dict[str, Any]) -> bool:
    statement_l = str(claim.get("statement", "")).lower()
    return (
        claim.get("market_data_kind") == "quote"
        and bool(claim.get("event_date"))
        and claim.get("source_trust_tier") in {"tier1", "tier2"}
        and "as of market close on" in statement_l
    )


def _apply_truth_discipline_checks(
    part_a_md: str,
    claims_ledger: list[dict[str, Any]],
    *,
    as_of_date: str,
    has_live_market_feed: bool,
    parse_errors: list[str],
    normalization_notes: list[str],
) -> dict[str, Any]:
    del normalization_notes
    as_of = _parse_date_yyyy_mm_dd(as_of_date)
    if as_of is None:
        as_of = date.today()

    truth_errors: list[str] = []
    violating_ids: set[str] = set()

    for claim in claims_ledger:
        cid = str(claim.get("claim_id", "")).upper()
        claim_errors: list[str] = []

        if claim.get("confidence") == "high" and claim.get("source_trust_tier") not in {"tier1", "tier2"}:
            claim["confidence"] = "medium"
            _append_note(claim, "High confidence downgraded: source is not tier1/tier2.")
            claim_errors.append("high confidence requires tier1/tier2")

        if claim.get("source_trust_tier") in {"tier3", "unknown"} and claim.get("confidence") == "high":
            claim["confidence"] = "medium"

        if claim.get("weak_source_used") and claim.get("confidence") == "high":
            claim["confidence"] = "medium"
            _append_note(claim, "Weak aggregator source used; confidence capped at medium.")

        if claim.get("claim_type") == "numeric" and not _timeframe_is_valid(claim.get("timeframe")):
            claim_errors.append("numeric claim missing valid timeframe label")

        if _is_market_share_claim(claim):
            if claim.get("definition") is None:
                claim_errors.append("market share claim missing definition")
            if claim.get("source_trust_tier") not in {"tier1", "tier2"}:
                claim_errors.append("market share claim requires tier1/tier2 source")
            value = claim.get("value")
            if isinstance(value, float):
                raw = f"{value}".split(".")
                decimals = len(raw[1]) if len(raw) == 2 else 0
                if decimals > 1 and claim.get("source_trust_tier") != "tier1":
                    claim_errors.append("market share precision >1 decimal requires tier1 source")

        if _is_debt_detail_claim(claim) and claim.get("source_trust_tier") != "tier1":
            claim["claim_type"] = "qualitative"
            claim["value"] = None
            claim["unit"] = None
            claim["source_type"] = "unknown"
            claim["source_citation"] = "unverified"
            claim["confidence"] = "low"
            _append_note(claim, "Debt detail requires tier1 source; converted to qualitative unverified claim.")
            claim_errors.append("debt detail requires tier1 source")

        if _is_named_ai_vendor_claim(claim):
            if claim.get("source_trust_tier") not in {"tier1", "tier2"} or str(claim.get("source_citation", "")).lower() == "unverified":
                claim["excluded_from_text"] = True
                claim_errors.append("named AI vendor claim requires tier1/tier2 source with explicit citation")

        if _is_ai_impact_metric_claim(claim):
            if claim.get("source_trust_tier") not in {"tier1", "tier2"}:
                claim["excluded_from_text"] = True
                claim_errors.append("AI impact metric requires tier1/tier2 sourcing")

        event_date = _parse_date_yyyy_mm_dd(claim.get("event_date"))
        if event_date is None:
            event_date = _timeframe_to_date(claim.get("timeframe"))
        if event_date is None:
            event_date = _extract_date_from_statement(str(claim.get("statement", "")))

        if _implies_completed_result(claim) and event_date and event_date > as_of:
            if not _has_scheduled_event_safeguards(claim):
                claim["excluded_from_text"] = True
                claim_errors.append("future completed-result claim blocked without scheduled-event safeguards")

        if _is_market_snapshot_claim(claim):
            if claim.get("market_data_kind") == "quote":
                if not _is_valid_quote_claim(claim):
                    claim["excluded_from_text"] = True
                    claim_errors.append("quote market data requires event_date+tier1/2+dated quote phrasing")
            elif not has_live_market_feed:
                if str(claim.get("statement", "")).strip() != MARKET_DATA_FALLBACK or claim.get("value") is not None:
                    claim["excluded_from_text"] = True
                    claim_errors.append("snapshot market data blocked without live feed")

        if _is_runtime_market_metric_claim(claim) and _claim_has_numeric_payload(claim):
            if not claim.get("source_url"):
                claim_errors.append("runtime market metric numeric value requires explicit source_url in this run")

        claim["truth_discipline_errors"] = claim_errors
        claim["truth_discipline_valid"] = len(claim_errors) == 0

        if claim_errors:
            violating_ids.add(cid)
            truth_errors.append(f"{cid}: " + "; ".join(claim_errors))

    if not has_live_market_feed:
        valid_quote_ids = {str(claim.get("claim_id", "")).upper() for claim in claims_ledger if _is_valid_quote_claim(claim)}
        in_snapshot_zone = False
        for line_no, raw in enumerate(part_a_md.splitlines(), start=1):
            line = raw.strip()
            if not line:
                continue
            if line.startswith("#"):
                in_snapshot_zone = bool(SNAPSHOT_HEADING_RE.search(line))
                continue

            snapshot_label = bool(SNAPSHOT_LABEL_RE.search(line))
            if not in_snapshot_zone and not snapshot_label:
                continue

            line_without_markers = CLAIM_MARKER_RE.sub("", line)
            if line_without_markers.strip() == MARKET_DATA_FALLBACK:
                continue

            has_numeric = bool(NUMERIC_TOKEN_RE.search(line_without_markers) or MID_RANGE_RE.search(line_without_markers))
            if not has_numeric:
                continue

            markers = [m.group(1).upper() for m in CLAIM_MARKER_RE.finditer(line)]
            if markers and all(marker in valid_quote_ids for marker in markers):
                continue

            parse_errors.append(f"PART A line {line_no}: market data leakage blocked without live feed.")

    return {
        "truth_discipline_valid": len(truth_errors) == 0,
        "truth_discipline_errors": truth_errors,
        "truth_discipline_violating_claim_ids": sorted(cid for cid in violating_ids if cid),
    }


def _contains_deal_keywords(text: str) -> bool:
    txt = (text or "").lower()
    return any(keyword in txt for keyword in DEAL_KEYWORDS)


def _detect_recent_tiered_deal(claims_ledger: list[dict[str, Any]], as_of_date: str) -> bool:
    as_of = _parse_date_yyyy_mm_dd(as_of_date) or date.today()
    lookback_cutoff = as_of - timedelta(days=180)

    for claim in claims_ledger:
        blob = f"{claim.get('metric', '')} {claim.get('statement', '')}"
        if not _contains_deal_keywords(blob):
            continue
        if claim.get("source_trust_tier") not in {"tier1", "tier2"}:
            continue
        claim_event_date = _parse_date_yyyy_mm_dd(claim.get("event_date"))
        if claim_event_date is None:
            claim_event_date = _timeframe_to_date(claim.get("timeframe"))
        if claim_event_date is None:
            claim_event_date = _extract_date_from_statement(str(claim.get("statement", "")))
        if claim_event_date and claim_event_date >= lookback_cutoff:
            return True
    return False

def load_and_validate_ledger(ledger_json_text: str | None, *, as_of_date: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    parse_errors: list[str] = []
    normalization_notes: list[str] = []
    normalized_claims: list[dict[str, Any]] = []

    if ledger_json_text is None:
        parse_errors.append("Missing PART B claims ledger JSON.")
        return [], {"valid": False, "parse_errors": parse_errors, "normalization_notes": normalization_notes, "claim_count": 0}

    try:
        payload = json.loads(ledger_json_text)
    except json.JSONDecodeError as exc:
        parse_errors.append(f"Claims ledger JSON parse error: {exc}")
        return [], {"valid": False, "parse_errors": parse_errors, "normalization_notes": normalization_notes, "claim_count": 0}

    if not isinstance(payload, list):
        parse_errors.append("Claims ledger payload must be a JSON array.")
        return [], {"valid": False, "parse_errors": parse_errors, "normalization_notes": normalization_notes, "claim_count": 0}

    for idx, raw_claim in enumerate(payload):
        if not isinstance(raw_claim, dict):
            normalization_notes.append(f"Claim {idx}: dropped non-object entry.")
            continue
        normalized_claims.append(_normalize_claim(raw_claim, idx, normalization_notes, as_of_date))

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
    as_of_date: str | None = None,
    truth_discipline_enabled: bool = True,
    has_live_market_feed: bool = False,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    as_of = as_of_date or date.today().strftime("%Y-%m-%d")
    part_a, ledger_json_text = parse_stage2_output(output_text)
    claims_ledger, meta = load_and_validate_ledger(ledger_json_text, as_of_date=as_of)

    parse_errors = list(meta.get("parse_errors", []))
    if not part_a.strip():
        parse_errors.append("PART A markdown is empty.")
    if ledger_json_text is None:
        parse_errors.append("PART B marker missing or JSON array not found.")

    _validate_required_sections(part_a, parse_errors)
    _validate_part_a_numeric_coverage(part_a, claims_ledger, parse_errors)
    _validate_management_claim_coverage(part_a, claims_ledger, parse_errors)
    missing_claim_ids, orphan_claim_ids = _validate_claim_id_binding(part_a, claims_ledger, parse_errors)

    if truth_discipline_enabled:
        truth_meta = _apply_truth_discipline_checks(
            part_a,
            claims_ledger,
            as_of_date=as_of,
            has_live_market_feed=has_live_market_feed,
            parse_errors=parse_errors,
            normalization_notes=meta.get("normalization_notes", []),
        )
        if truth_meta.get("truth_discipline_valid") is False:
            parse_errors.extend(
                f"Truth discipline violation: {err}"
                for err in truth_meta.get("truth_discipline_errors", [])
            )
    else:
        truth_meta = {
            "truth_discipline_valid": None,
            "truth_discipline_errors": [],
            "truth_discipline_violating_claim_ids": [],
        }

    deal_with_source = _detect_recent_tiered_deal(claims_ledger, as_of)
    combined_deal_signal = (
        (
            deal_detected
            or any(
                _contains_deal_keywords(str(c.get("statement", "")) + " " + str(c.get("metric", "")))
                for c in claims_ledger
            )
        )
        and deal_with_source
    )

    merged_meta = {
        "valid": len(parse_errors) == 0,
        "parse_errors": parse_errors,
        "normalization_notes": meta.get("normalization_notes", []),
        "claim_count": meta.get("claim_count", len(claims_ledger)),
        "repair_used": False,
        "deal_detected": bool(combined_deal_signal),
        "citation_binding_valid": len(missing_claim_ids) == 0 and len(orphan_claim_ids) == 0,
        "missing_claim_ids": missing_claim_ids,
        "orphan_claim_ids": orphan_claim_ids,
        "as_of_date": as_of,
        "truth_discipline_enabled": bool(truth_discipline_enabled),
        "truth_discipline_valid": truth_meta.get("truth_discipline_valid"),
        "truth_discipline_errors": truth_meta.get("truth_discipline_errors", []),
        "truth_discipline_violating_claim_ids": truth_meta.get("truth_discipline_violating_claim_ids", []),
        "content_degraded": False,
    }
    return part_a, claims_ledger, merged_meta


def _degrade_part_a(
    part_a: str,
    violating_ids: set[str],
    *,
    has_live_market_feed: bool,
    valid_quote_ids: set[str],
) -> str:
    fallback_line = "Removed due to insufficient evidence or time mismatch (see Claims Ledger meta)."
    if not violating_ids and has_live_market_feed:
        return part_a

    degraded_lines: list[str] = []
    in_snapshot_zone = False
    for raw_line in part_a.splitlines():
        line = raw_line.rstrip("\n")
        if line.strip().startswith("#"):
            in_snapshot_zone = bool(SNAPSHOT_HEADING_RE.search(line))
            degraded_lines.append(line)
            continue

        if not has_live_market_feed and (in_snapshot_zone or SNAPSHOT_LABEL_RE.search(line)):
            line_without_markers = CLAIM_MARKER_RE.sub("", line)
            has_numeric = bool(NUMERIC_TOKEN_RE.search(line_without_markers) or MID_RANGE_RE.search(line_without_markers))
            markers = [m.group(1).upper() for m in CLAIM_MARKER_RE.finditer(line)]
            quote_ok = bool(markers) and all(m in valid_quote_ids for m in markers)
            if has_numeric and line_without_markers.strip() != MARKET_DATA_FALLBACK and not quote_ok:
                degraded_lines.append(fallback_line)
                continue

        markers = [m.group(1).upper() for m in CLAIM_MARKER_RE.finditer(line)]
        if markers and any(marker in violating_ids for marker in markers):
            degraded_lines.append(fallback_line)
        else:
            degraded_lines.append(line)

    compacted: list[str] = []
    for line in degraded_lines:
        if compacted and compacted[-1] == fallback_line and line == fallback_line:
            continue
        compacted.append(line)
    return "\n".join(compacted)


async def validate_stage2_with_repair(
    output_text: str,
    *,
    deal_detected: bool,
    as_of_date: str,
    truth_discipline_enabled: bool,
    has_live_market_feed: bool,
    repair_stage2_fn: Callable[[dict[str, Any]], Awaitable[str]] | None = None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    part_a, claims_ledger, claims_meta = parse_and_validate_stage2_output(
        output_text,
        deal_detected=deal_detected,
        as_of_date=as_of_date,
        truth_discipline_enabled=truth_discipline_enabled,
        has_live_market_feed=has_live_market_feed,
    )
    if claims_meta.get("valid", False):
        claims_meta["repair_used"] = False
        return part_a, claims_ledger, claims_meta

    if repair_stage2_fn is not None:
        repaired_output = (await repair_stage2_fn(claims_meta)).strip()
        repaired_part_a, repaired_part_b = parse_stage2_output(repaired_output)
        if repaired_part_a.strip() and repaired_part_b is not None:
            part_a, claims_ledger, claims_meta = parse_and_validate_stage2_output(
                repaired_output,
                deal_detected=deal_detected,
                as_of_date=as_of_date,
                truth_discipline_enabled=truth_discipline_enabled,
                has_live_market_feed=has_live_market_feed,
            )
            claims_meta["repair_used"] = True
            if claims_meta.get("valid", False):
                return part_a, claims_ledger, claims_meta
        else:
            claims_meta = {
                **claims_meta,
                "repair_used": True,
                "parse_errors": [
                    *claims_meta.get("parse_errors", []),
                    "Repair failed: output did not include full Stage-2 contract (PART A + PART B).",
                ],
            }

    violating_ids = set(claims_meta.get("truth_discipline_violating_claim_ids", []))
    for claim in claims_ledger:
        cid = str(claim.get("claim_id", "")).upper()
        if cid in violating_ids:
            claim["excluded_from_text"] = True

    valid_quote_ids = {
        str(claim.get("claim_id", "")).upper()
        for claim in claims_ledger
        if _is_valid_quote_claim(claim)
    }
    degraded_part_a = _degrade_part_a(
        part_a,
        violating_ids,
        has_live_market_feed=has_live_market_feed,
        valid_quote_ids=valid_quote_ids,
    )
    degraded_meta = {
        **claims_meta,
        "valid": False,
        "content_degraded": True,
        "degraded_ledger": True,
        "repair_used": bool(claims_meta.get("repair_used", False) or repair_stage2_fn is not None),
        "parse_errors": [
            *claims_meta.get("parse_errors", []),
            "Claims remained invalid after one repair pass; degraded content emitted safely.",
        ],
    }
    return degraded_part_a, claims_ledger, degraded_meta


def parse_and_validate_fact_first_output(output_text: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    return parse_and_validate_stage2_output(output_text, deal_detected=False)
