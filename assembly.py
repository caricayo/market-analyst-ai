"""
TriView Capital — Stage 5: Assembly & Validation

Combines deep dive, persona evaluations, and synthesis into the final report.
Validates outputs, adds metadata, writes to disk.
"""

import re
from datetime import datetime, timezone
from pathlib import Path

from config import (
    DEEP_DIVE_MODEL,
    RESEARCH_MODEL,
    SECTION_WRITE_MODEL,
    BOOKEND_MODEL,
    PERSONA_MODEL,
    SYNTHESIS_MODEL,
    OUTPUT_DIR,
)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

# Expected H2 headers in the deep dive (Section 0 through Section 13)
EXPECTED_DEEP_DIVE_SECTIONS = [
    "Section 0",
    "Section 1",
    "Section 2",
    "Section 3",
    "Section 4",
    "Section 5",
    "Section 6",
    "Section 7",
    "Section 8",
    "Section 9",
    "Section 10",
    "Section 11",
    "Section 12",
    "Section 13",
]

EXPECTED_PERSONA_HEADERS = [
    "### Verdict",
    "### Thesis",
    "### Key Strengths Identified",
    "### Key Risks and Red Flags",
    "### Position Sizing Suggestion",
    "### What Would Change My Mind",
    "### Pre-Mortem",
    "### Unanswered Questions",
]

EXPECTED_SYNTHESIS_HEADERS = [
    "### Consensus Points",
    "### Points of Disagreement",
    "### Verdict Summary Table",
    "### Where the Market May Be Mispricing",
    "### Overall Risk-Reward Profile",
    "### Key KPIs to Monitor",
    "### Disclaimer",
]


def validate_deep_dive(text: str) -> list[str]:
    """Check that the deep dive contains all expected section headers."""
    warnings = []
    for section in EXPECTED_DEEP_DIVE_SECTIONS:
        if section not in text:
            warnings.append(f"Deep dive missing: {section}")
    return warnings


def validate_persona_output(text: str, persona_name: str) -> list[str]:
    """Check that a persona output contains all required headers."""
    warnings = []
    for header in EXPECTED_PERSONA_HEADERS:
        if header not in text:
            warnings.append(f"{persona_name} output missing: {header}")

    # Validate rating value
    rating_match = re.search(r"\*\*Rating:\*\*\s*(Strong Buy|Buy|Watchlist|Avoid|Strong Avoid)", text)
    if not rating_match:
        warnings.append(f"{persona_name}: Rating not one of Strong Buy/Buy/Watchlist/Avoid/Strong Avoid")

    # Validate confidence value
    confidence_match = re.search(r"\*\*Confidence:\*\*\s*(\d+)", text)
    if confidence_match:
        val = int(confidence_match.group(1))
        if not 1 <= val <= 10:
            warnings.append(f"{persona_name}: Confidence {val} outside 1-10 range")
    else:
        warnings.append(f"{persona_name}: Confidence score not found")

    return warnings


def validate_synthesis(text: str) -> list[str]:
    """Check that the synthesis contains all required headers."""
    warnings = []
    for header in EXPECTED_SYNTHESIS_HEADERS:
        if header not in text:
            warnings.append(f"Synthesis missing: {header}")
    return warnings


def extract_executive_summary(deep_dive: str) -> str:
    """Extract Section 0 (Executive Summary) from the deep dive."""
    # Find Section 0 start
    match = re.search(r"(## Section 0.*?)(?=\n## Section 1|\Z)", deep_dive, re.DOTALL)
    if match:
        return match.group(1).strip()
    # Fallback: return first 2000 characters
    return deep_dive[:2000]


def assemble_report(
    ticker: str,
    company_name: str,
    template_hash: str,
    deep_dive: str,
    persona_outputs: dict[str, str | None],
    synthesis: str | None,
) -> tuple[str, list[str]]:
    """
    Assemble the final TriView Capital report.

    Args:
        ticker: Resolved ticker symbol
        company_name: Resolved company name
        template_hash: SHA-256 of the template used
        deep_dive: Full deep dive markdown
        persona_outputs: Dict of persona_id -> markdown output (None if failed)
        synthesis: Synthesis markdown (None if failed)

    Returns:
        (final_report_markdown, validation_warnings)
    """
    warnings: list[str] = []
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # --- Validate deep dive ---
    warnings.extend(validate_deep_dive(deep_dive))

    # --- Validate persona outputs ---
    persona_sections = []
    available_personas = 0
    total_personas = len(persona_outputs)

    for pid, output in persona_outputs.items():
        if output is None:
            warnings.append(f"Persona '{pid}' evaluation unavailable")
            persona_sections.append(
                f"> **[{pid}] evaluation unavailable** — showing "
                f"{total_personas - 1} of {total_personas} perspectives\n"
            )
        else:
            available_personas += 1
            pw = validate_persona_output(output, pid)
            warnings.extend(pw)
            section = output
            if pw:
                section = (
                    f"> *Formatting notice: some expected fields may be missing "
                    f"from this evaluation.*\n\n{output}"
                )
            persona_sections.append(section)

    # --- Validate synthesis ---
    synthesis_section = ""
    if synthesis is None:
        warnings.append("Synthesis unavailable — displaying persona verdicts only")
        synthesis_section = (
            "> **Synthesis unavailable.** The persona verdicts above are displayed "
            "side-by-side for independent comparison.\n"
        )
    else:
        sw = validate_synthesis(synthesis)
        warnings.extend(sw)
        synthesis_section = synthesis
        if sw:
            synthesis_section = (
                f"> *Formatting notice: some expected fields may be missing "
                f"from the synthesis.*\n\n{synthesis}"
            )

    # --- Build final report ---
    parts = [
        f"# TriView Capital — Investment Intelligence Report",
        f"## {company_name} ({ticker})",
        "",
        "---",
        "",
        f"*Generated: {timestamp}*  ",
        f"*Template version hash: `{template_hash[:12]}...`*  ",
        f"*Models: Research — {RESEARCH_MODEL} | Sections — {SECTION_WRITE_MODEL} | "
        f"Bookend — {BOOKEND_MODEL} | Personas — {PERSONA_MODEL} | "
        f"Synthesis — {SYNTHESIS_MODEL}*  ",
        f"*Personas reporting: {available_personas} of {total_personas}*",
        "",
        "---",
        "",
        "# Part I: Institutional Deep Dive",
        "",
        deep_dive,
        "",
        "---",
        "",
        "# Part II: Perspective Panel",
        "",
        "\n\n---\n\n".join(persona_sections),
        "",
        "---",
        "",
        "# Part III: Consensus & Disagreement",
        "",
        synthesis_section,
        "",
        "---",
        "",
        "## Report Metadata",
        "",
        f"| Field | Value |",
        f"|-------|-------|",
        f"| Company | {company_name} |",
        f"| Ticker | {ticker} |",
        f"| Generated | {timestamp} |",
        f"| Research Model | {RESEARCH_MODEL} |",
        f"| Section Write Model | {SECTION_WRITE_MODEL} |",
        f"| Bookend Model | {BOOKEND_MODEL} |",
        f"| Persona Model | {PERSONA_MODEL} |",
        f"| Synthesis Model | {SYNTHESIS_MODEL} |",
        f"| Template Hash | `{template_hash}` |",
        f"| Personas Available | {available_personas} / {total_personas} |",
        "",
        "---",
        "",
        "## What This Report Cannot Do",
        "",
        "- This is **not** investment advice.",
        "- AI-generated analysis **may contain errors**, including fabricated or "
        "outdated financial figures.",
        "- All financial data should be **independently verified** against primary "
        "sources (SEC filings, earnings reports, company disclosures).",
        "- Past patterns **do not guarantee** future outcomes.",
        "- This system does not remember past queries or adapt to user behavior. "
        "Every analysis starts fresh from the same template.",
        "",
    ]

    # --- Warnings appendix ---
    if warnings:
        parts.append("---")
        parts.append("")
        parts.append("## Validation Notices")
        parts.append("")
        for w in warnings:
            parts.append(f"- {w}")
        parts.append("")

    final_report = "\n".join(parts)
    return final_report, warnings


def save_report(ticker: str, report: str) -> Path:
    """Write the final report to disk and return the file path."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{ticker}_{timestamp}.md"
    filepath = OUTPUT_DIR / filename
    filepath.write_text(report, encoding="utf-8")
    return filepath
