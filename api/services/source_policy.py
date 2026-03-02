"""
Source trust-tier policy and claim-source normalization helpers.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse


def _parse_domain_list(env_name: str, default: set[str]) -> set[str]:
    raw = (os.getenv(env_name, "") or "").strip()
    if not raw:
        return set(default)
    return {
        part.strip().lower().removeprefix("www.")
        for part in raw.split(",")
        if part.strip()
    }


DEFAULT_TIER1_DOMAINS = {
    "sec.gov",
    "www.sec.gov",
}

DEFAULT_TIER2_DOMAINS = {
    "nasdaq.com",
    "nyse.com",
    "fred.stlouisfed.org",
    "bloomberg.com",
    "reuters.com",
    "finance.yahoo.com",
}

TIER1_DOMAINS = _parse_domain_list("SOURCE_TIER1_DOMAINS", DEFAULT_TIER1_DOMAINS)
TIER2_DOMAINS = _parse_domain_list("SOURCE_TIER2_DOMAINS", DEFAULT_TIER2_DOMAINS)
WEAK_AGGREGATOR_DOMAINS = _parse_domain_list(
    "SOURCE_WEAK_AGGREGATOR_DOMAINS",
    {
        "csimarket.com",
        "dcfmodeling.com",
        "stockanalysis.com",
    },
)


def normalize_source_url(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if not candidate.startswith(("http://", "https://")):
        return None
    parsed = urlparse(candidate)
    if not parsed.scheme or not parsed.netloc:
        return None
    return candidate


def extract_source_domain(source_url: str | None) -> str | None:
    if not source_url:
        return None
    try:
        parsed = urlparse(source_url)
    except Exception:
        return None
    netloc = (parsed.netloc or "").lower().strip()
    if not netloc:
        return None
    return netloc.removeprefix("www.")


def classify_claim_source(
    *,
    source_type: str,
    source_citation: str,
    source_url: str | None,
) -> tuple[str, bool]:
    """
    Return (source_trust_tier, verified_for_counter).
    """
    citation_l = (source_citation or "").strip().lower()
    source_type_norm = (source_type or "").strip()
    domain = extract_source_domain(source_url)

    if citation_l == "unverified" or source_type_norm in {"unknown", ""}:
        return "unknown", False

    if domain in TIER1_DOMAINS:
        return "tier1", True
    if domain in TIER2_DOMAINS:
        return "tier2", True

    if source_type_norm == "SEC/IR":
        return "tier1", True
    if source_type_norm == "reputable_market_data":
        return "tier2", True
    if source_type_norm == "estimate":
        return "tier3", False

    if domain:
        return "tier3", False
    return "unknown", False


def is_weak_aggregator_domain(domain: str | None) -> bool:
    if not domain:
        return False
    base = domain.lower().removeprefix("www.")
    return base in WEAK_AGGREGATOR_DOMAINS
