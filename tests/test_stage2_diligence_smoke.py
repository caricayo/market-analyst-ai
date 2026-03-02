import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if "dotenv" not in sys.modules:
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv

from api.services.claims_ledger import detect_deal_signal, parse_and_validate_stage2_output
from api.services.persona_parser import parse_persona
from deep_dive_prompts import fact_first_diligence_prompt


class Stage2DiligenceSmokeTests(unittest.TestCase):
    def test_canned_writer_output_parses_and_personas_compatible(self):
        company = "AAPL"
        research_brief = "The company entered a definitive agreement in a merger process."
        deal_detected = detect_deal_signal(research_brief)
        self.assertTrue(deal_detected)

        system_prompt, user_prompt = fact_first_diligence_prompt(company, research_brief, "2026-03-02")
        self.assertTrue(system_prompt.strip())
        self.assertIn("PART B  CLAIMS LEDGER", user_prompt)

        part_a = """## Business Model & Revenue Architecture
Unverified  requires primary filing review.
## Competitive Position & Power Structure
Competitive intensity elevated. timeframe=FY2025 unit=percent source_type=estimate source_citation=unverified [C4]
## Financial Quality Snapshot
Gross margin trend was 42%. timeframe=FY2025 unit=percent source_type=SEC/IR source_citation=10-K [C1]
## Capital Structure & Liquidity
Net debt not computed due to sourcing limits.
## Leadership, Governance & Incentives
CEO has prior operator experience and board oversight remains stable. timeframe=FY2025 unit=event source_type=SEC/IR source_citation=10-K [C2]
## SBC & Dilution Analysis
Unverified  requires primary filing review.
## Structural vs Cyclical Risk Separation
Unverified  requires primary filing review.
## Strategic Optionality & Upside Drivers
Unverified  requires primary filing review.
## Market Belief vs Mispricing Hypothesis
Unverified  requires primary filing review.
## Deal-Arb Appendix
Definitive agreement announced. timeframe=Q1 2026 unit=event source_type=SEC/IR source_citation=8-K [C3]
## Investment Framing Summary
Unverified  requires primary filing review.
"""
        ledger = [
            {
                "claim_type": "numeric",
                "metric": "gross_margin",
                "value": 42,
                "unit": "percent",
                "timeframe": "FY2025",
                "statement": "Gross margin trend was 42%. timeframe=FY2025 unit=percent source_type=SEC/IR source_citation=10-K",
                "confidence": "medium",
                "source_type": "SEC/IR",
                "source_citation": "10-K",
                "notes": "Definition risk may apply.",
                "claim_id": "C1",
                "source_url": "https://www.sec.gov/ixviewer/ix.html",
                "source_title": "AAPL 10-K",
                "source_domain": "sec.gov",
            },
            {
                "claim_type": "qualitative",
                "metric": "governance_quality",
                "value": None,
                "unit": "event",
                "timeframe": "FY2025",
                "statement": "CEO has prior operator experience and board oversight remains stable. timeframe=FY2025 unit=event source_type=SEC/IR source_citation=10-K",
                "confidence": "medium",
                "source_type": "SEC/IR",
                "source_citation": "10-K",
                "notes": "",
                "claim_id": "C2",
                "source_url": "https://www.sec.gov/ixviewer/ix.html",
                "source_title": "AAPL 10-K",
                "source_domain": "sec.gov",
            },
            {
                "claim_type": "qualitative",
                "metric": "deal_status",
                "value": None,
                "unit": None,
                "timeframe": "Q1 2026",
                "statement": "Definitive agreement announced. timeframe=Q1 2026 unit=event source_type=SEC/IR source_citation=8-K",
                "confidence": "medium",
                "source_type": "SEC/IR",
                "source_citation": "8-K",
                "notes": "",
                "claim_id": "C3",
                "source_url": "https://www.sec.gov/ixviewer/ix.html",
                "source_title": "AAPL 8-K",
                "source_domain": "sec.gov",
            },
            {
                "claim_type": "qualitative",
                "metric": "competitive_intensity",
                "value": None,
                "unit": "percent",
                "timeframe": "FY2025",
                "statement": "Competitive intensity elevated. timeframe=FY2025 unit=percent source_type=estimate source_citation=unverified",
                "confidence": "low",
                "source_type": "estimate",
                "source_citation": "unverified",
                "notes": "",
                "claim_id": "C4",
                "source_url": None,
                "source_title": None,
                "source_domain": None,
            },
        ]
        output = f"PART A\n{part_a}\nPART B  CLAIMS LEDGER\n{json.dumps(ledger)}"

        deep_dive, claims_ledger, meta = parse_and_validate_stage2_output(
            output,
            deal_detected=deal_detected,
        )

        required_headings = [
            "## Business Model & Revenue Architecture",
            "## Competitive Position & Power Structure",
            "## Financial Quality Snapshot",
            "## Capital Structure & Liquidity",
            "## Leadership, Governance & Incentives",
            "## SBC & Dilution Analysis",
            "## Structural vs Cyclical Risk Separation",
            "## Strategic Optionality & Upside Drivers",
            "## Market Belief vs Mispricing Hypothesis",
            "## Investment Framing Summary",
        ]
        for heading in required_headings:
            self.assertIn(heading, deep_dive)
        self.assertIn("## Deal-Arb Appendix", deep_dive)
        self.assertTrue(meta["valid"])
        self.assertGreater(len(claims_ledger), 0)

        # Smoke check: persona parser remains compatible with deep_dive path.
        persona_text = """### Verdict
**Rating:** Buy
**Confidence:** 7
**Time Horizon:** 12-24 months

### Position Sizing Suggestion
Moderate
"""
        verdict = parse_persona(
            persona_id="victor",
            persona_name="Victor Alvarez",
            persona_label="Macro",
            text=persona_text,
        )
        self.assertEqual(verdict.rating, "Buy")
        self.assertEqual(verdict.confidence, 7)
        self.assertEqual(verdict.position_size, "Moderate")


if __name__ == "__main__":
    unittest.main()
