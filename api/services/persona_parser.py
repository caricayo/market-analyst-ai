"""
arfor - Persona Parser

Extracts structured data (rating, confidence, time_horizon, position_size)
from persona markdown output. Reuses regex patterns from assembly.py.
"""

import re
from dataclasses import dataclass


@dataclass
class PersonaVerdict:
    persona_id: str
    persona_name: str
    persona_label: str
    rating: str  # Strong Buy, Buy, Watchlist, Avoid, Strong Avoid
    confidence: int  # 1-10
    time_horizon: str
    position_size: str  # None, Small, Moderate, Full
    available: bool = True


def parse_persona(persona_id: str, persona_name: str, persona_label: str, text: str | None) -> PersonaVerdict:
    """Extract structured verdict data from persona markdown."""
    if text is None:
        return PersonaVerdict(
            persona_id=persona_id,
            persona_name=persona_name,
            persona_label=persona_label,
            rating="N/A",
            confidence=0,
            time_horizon="N/A",
            position_size="N/A",
            available=False,
        )

    # Rating: Strong Buy / Buy / Watchlist / Avoid / Strong Avoid
    rating_match = re.search(
        r"\*\*Rating:\*\*\s*(Strong Buy|Buy|Watchlist|Avoid|Strong Avoid)",
        text,
        re.IGNORECASE,
    )
    rating = rating_match.group(1) if rating_match else "Unknown"
    if rating == "Unknown":
        fallback_rating = re.search(
            r"\b(recommend(?:ation)?\s*:?\s*)?(Strong Buy|Strong Avoid|Watchlist|Buy|Avoid)\b",
            text,
            re.IGNORECASE,
        )
        if fallback_rating:
            rating = fallback_rating.group(2)
    if rating != "Unknown":
        rating = " ".join(part.capitalize() for part in str(rating).split())

    # Confidence: 1-10
    confidence_match = re.search(r"\*\*Confidence:\*\*\s*(\d+)", text, re.IGNORECASE)
    if not confidence_match:
        confidence_match = re.search(r"\bconfidence\b[^\d]*(\d{1,2})", text, re.IGNORECASE)
    confidence = int(confidence_match.group(1)) if confidence_match else 0
    if not 1 <= confidence <= 10:
        confidence = 0

    # Time Horizon
    horizon_match = re.search(r"\*\*Time Horizon:\*\*\s*(.+)", text, re.IGNORECASE)
    if not horizon_match:
        horizon_match = re.search(
            r"\b(\d{1,2}\s*(?:-|to)\s*\d{1,2}\s*(?:months?|years?)|\d{1,2}\s*(?:months?|years?))\b",
            text,
            re.IGNORECASE,
        )
    time_horizon = horizon_match.group(1).strip() if horizon_match else "N/A"

    # Position Size: from Position Sizing Suggestion section
    size_match = re.search(
        r"(?:Position Sizing Suggestion|Position Size)[^\n]*\n+\*?\*?(None|Small|Moderate|Full)",
        text,
        re.IGNORECASE,
    )
    if not size_match:
        # Try inline pattern
        size_match = re.search(r"\*\*(None|Small|Moderate|Full)\s*(?:position|-)", text, re.IGNORECASE)
    if not size_match:
        size_match = re.search(r"\b(very\s+small|small|moderate|full|none)\s+position\b", text, re.IGNORECASE)
    if size_match:
        raw = size_match.group(1).strip().lower()
        position_size = "Small" if raw == "very small" else raw.capitalize()
    else:
        position_size = "N/A"

    return PersonaVerdict(
        persona_id=persona_id,
        persona_name=persona_name,
        persona_label=persona_label,
        rating=rating,
        confidence=confidence,
        time_horizon=time_horizon,
        position_size=position_size,
        available=True,
    )
