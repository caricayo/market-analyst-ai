"""
TriView Capital — Stage 1: Intake

Ticker normalization, input sanitization, and template substitution.
No LLM calls — pure application logic.
"""

import hashlib
import re
from pathlib import Path

from config import (
    ALLOWED_TICKER_CHARS,
    MAX_TICKER_LENGTH,
    TEMPLATE_PATH,
    TEMPLATE_PLACEHOLDER,
)


class IntakeError(Exception):
    """Raised when user input fails validation."""


# ---------------------------------------------------------------------------
# Common ticker-to-company-name lookup (fallback when no API is configured)
# Covers major tickers; the system also accepts full company names directly.
# ---------------------------------------------------------------------------
TICKER_LOOKUP: dict[str, str] = {
    "AAPL": "Apple Inc.",
    "MSFT": "Microsoft Corporation",
    "GOOGL": "Alphabet Inc.",
    "GOOG": "Alphabet Inc.",
    "AMZN": "Amazon.com Inc.",
    "NVDA": "NVIDIA Corporation",
    "META": "Meta Platforms Inc.",
    "TSLA": "Tesla Inc.",
    "BRK.A": "Berkshire Hathaway Inc.",
    "BRK.B": "Berkshire Hathaway Inc.",
    "JPM": "JPMorgan Chase & Co.",
    "V": "Visa Inc.",
    "JNJ": "Johnson & Johnson",
    "UNH": "UnitedHealth Group Inc.",
    "WMT": "Walmart Inc.",
    "MA": "Mastercard Inc.",
    "PG": "Procter & Gamble Co.",
    "HD": "The Home Depot Inc.",
    "XOM": "Exxon Mobil Corporation",
    "CVX": "Chevron Corporation",
    "LLY": "Eli Lilly and Company",
    "ABBV": "AbbVie Inc.",
    "PFE": "Pfizer Inc.",
    "MRK": "Merck & Co. Inc.",
    "COST": "Costco Wholesale Corporation",
    "AVGO": "Broadcom Inc.",
    "PEP": "PepsiCo Inc.",
    "KO": "The Coca-Cola Company",
    "TMO": "Thermo Fisher Scientific Inc.",
    "MCD": "McDonald's Corporation",
    "CSCO": "Cisco Systems Inc.",
    "ACN": "Accenture plc",
    "ABT": "Abbott Laboratories",
    "DHR": "Danaher Corporation",
    "NKE": "Nike Inc.",
    "TXN": "Texas Instruments Inc.",
    "NEE": "NextEra Energy Inc.",
    "NFLX": "Netflix Inc.",
    "AMD": "Advanced Micro Devices Inc.",
    "INTC": "Intel Corporation",
    "CRM": "Salesforce Inc.",
    "ADBE": "Adobe Inc.",
    "ORCL": "Oracle Corporation",
    "IBM": "International Business Machines Corporation",
    "GS": "Goldman Sachs Group Inc.",
    "MS": "Morgan Stanley",
    "BA": "The Boeing Company",
    "CAT": "Caterpillar Inc.",
    "GE": "GE Aerospace",
    "DIS": "The Walt Disney Company",
    "CMCSA": "Comcast Corporation",
    "T": "AT&T Inc.",
    "VZ": "Verizon Communications Inc.",
    "UBER": "Uber Technologies Inc.",
    "SQ": "Block Inc.",
    "SHOP": "Shopify Inc.",
    "SNOW": "Snowflake Inc.",
    "PLTR": "Palantir Technologies Inc.",
    "COIN": "Coinbase Global Inc.",
    "RIVN": "Rivian Automotive Inc.",
    "LCID": "Lucid Group Inc.",
    "SOFI": "SoFi Technologies Inc.",
    "ARM": "Arm Holdings plc",
    "SMCI": "Super Micro Computer Inc.",
    "PANW": "Palo Alto Networks Inc.",
    "CRWD": "CrowdStrike Holdings Inc.",
    "ZS": "Zscaler Inc.",
    "DDOG": "Datadog Inc.",
    "NET": "Cloudflare Inc.",
    "MU": "Micron Technology Inc.",
    "QCOM": "Qualcomm Inc.",
    "AMAT": "Applied Materials Inc.",
    "LRCX": "Lam Research Corporation",
    "KLAC": "KLA Corporation",
    "TSM": "Taiwan Semiconductor Manufacturing Company",
    "ASML": "ASML Holding N.V.",
    "NOW": "ServiceNow Inc.",
    "SPOT": "Spotify Technology S.A.",
    "SQ": "Block Inc.",
    "PYPL": "PayPal Holdings Inc.",
    "ABNB": "Airbnb Inc.",
    "DASH": "DoorDash Inc.",
    "ZM": "Zoom Video Communications Inc.",
    "ROKU": "Roku Inc.",
    "TTD": "The Trade Desk Inc.",
    "MELI": "MercadoLibre Inc.",
    "SE": "Sea Limited",
    "BABA": "Alibaba Group Holding Limited",
    "JD": "JD.com Inc.",
    "PDD": "PDD Holdings Inc.",
    "NIO": "NIO Inc.",
    "LI": "Li Auto Inc.",
    "XPEV": "XPeng Inc.",
}


def sanitize_input(raw: str) -> str:
    """
    Sanitize user input to prevent prompt injection.

    Rules:
    - Strip leading/trailing whitespace
    - Limit to MAX_TICKER_LENGTH characters
    - Allow only alphanumeric, spaces, periods, ampersands, hyphens, apostrophes
    - Strip markdown formatting characters
    - Reject if empty after sanitization
    """
    text = raw.strip()

    if not text:
        raise IntakeError("Input is empty. Please provide a ticker symbol or company name.")

    # Strip markdown / injection characters
    text = re.sub(r"[#*_`~\[\](){}<>|\\;!@$%^+=\"]", "", text)

    # Enforce character whitelist
    text = "".join(c for c in text if c in ALLOWED_TICKER_CHARS)

    # Collapse multiple spaces
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        raise IntakeError("Input contains no valid characters after sanitization.")

    if len(text) > MAX_TICKER_LENGTH:
        raise IntakeError(
            f"Input too long ({len(text)} chars). Maximum is {MAX_TICKER_LENGTH}."
        )

    return text


def resolve_ticker(sanitized: str) -> tuple[str, str]:
    """
    Resolve sanitized input to (ticker, company_name).

    Returns:
        (ticker, company_name) — if input is a known ticker, both are populated.
        If input appears to be a company name already, ticker may be the same as input.
    """
    upper = sanitized.upper().strip()

    # Direct ticker match
    if upper in TICKER_LOOKUP:
        return upper, TICKER_LOOKUP[upper]

    # Check if input matches a company name (case-insensitive)
    lower = sanitized.lower()
    for ticker, name in TICKER_LOOKUP.items():
        if name.lower() == lower or name.lower().startswith(lower):
            return ticker, name

    # Check loaded ticker data (available when running inside the server)
    try:
        from api.services.ticker_data import get_ticker_name

        loaded_name = get_ticker_name(upper)
        if loaded_name:
            return upper, loaded_name
    except ImportError:
        pass

    # Not found in lookup — treat input as-is (could be a valid but unlisted ticker)
    return sanitized.upper(), sanitized


def load_template() -> str:
    """Load the deep dive template and return its contents."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Template not found at {TEMPLATE_PATH}")
    return TEMPLATE_PATH.read_text(encoding="utf-8")


def compute_template_hash(template: str) -> str:
    """Compute SHA-256 hash of the template for integrity verification."""
    return hashlib.sha256(template.encode("utf-8")).hexdigest()


def substitute_template(template: str, company_name: str) -> str:
    """
    Replace the placeholder in the template with the resolved company name.
    This is the ONLY permitted dynamic substitution.
    """
    return template.replace(TEMPLATE_PLACEHOLDER, company_name)


def run_intake(raw_input: str) -> dict:
    """
    Full Stage 1 pipeline.

    Returns:
        dict with keys:
        - ticker: str
        - company_name: str
        - prepared_template: str (template with company substituted)
        - template_hash: str (SHA-256 of original template)
    """
    sanitized = sanitize_input(raw_input)
    ticker, company_name = resolve_ticker(sanitized)
    template = load_template()
    template_hash = compute_template_hash(template)
    prepared_template = substitute_template(template, f"{company_name} ({ticker})")

    return {
        "ticker": ticker,
        "company_name": company_name,
        "prepared_template": prepared_template,
        "template_hash": template_hash,
    }
