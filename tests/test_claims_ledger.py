import asyncio
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

from api.services.claims_ledger import (
    detect_deal_signal,
    load_and_validate_ledger,
    parse_stage2_output,
    parse_and_validate_stage2_output,
    validate_stage2_with_repair,
)


class Stage2ParseTests(unittest.TestCase):
    def test_parse_stage2_output_splits_part_a_and_b(self):
        text = """PART A
## Business Model & Revenue Architecture
Alpha

PART B  CLAIMS LEDGER
[{"claim_type":"qualitative","metric":"m","value":null,"unit":null,"timeframe":null,"statement":"s","confidence":"medium","source_type":"SEC/IR","source_citation":"10-K","notes":""}]
"""
        part_a, ledger_json = parse_stage2_output(text)
        self.assertIn("Business Model & Revenue Architecture", part_a)
        self.assertTrue(ledger_json and ledger_json.strip().startswith("["))

    def test_load_and_validate_ledger_normalizes_numeric_missing_envelope(self):
        payload = [
            {
                "claim_type": "numeric",
                "metric": "Revenue",
                "value": 10,
                "unit": None,
                "timeframe": None,
                "statement": "Revenue is 10",
                "confidence": "high",
                "source_type": "SEC/IR",
                "source_citation": "",
                "notes": "",
            }
        ]
        claims, meta = load_and_validate_ledger(json.dumps(payload))
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]["source_type"], "unknown")
        self.assertEqual(claims[0]["source_citation"], "unverified")
        self.assertEqual(claims[0]["confidence"], "low")
        self.assertTrue(meta["valid"])

    def test_numeric_coverage_violation_marks_invalid(self):
        text = """PART A
## Financial Quality Snapshot
Revenue grew to 25% without ledger mapping.

PART B  CLAIMS LEDGER
[{"claim_type":"qualitative","metric":"trend","value":null,"unit":null,"timeframe":null,"statement":"Demand improved qualitatively.","confidence":"medium","source_type":"unknown","source_citation":"unverified","notes":""}]
"""
        _, _, meta = parse_and_validate_stage2_output(text, deal_detected=False)
        self.assertFalse(meta["valid"])
        self.assertTrue(any("numeric tokens not covered" in err for err in meta["parse_errors"]))


class RepairFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_repair_path_invoked_on_malformed_json(self):
        bad_output = """PART A
## Business Model & Revenue Architecture
Unverified  requires primary filing review.
## Competitive Position & Power Structure
Unverified  requires primary filing review.
## Financial Quality Snapshot
Unverified  requires primary filing review.
## Capital Structure & Liquidity
Unverified  requires primary filing review.
## Leadership, Governance & Incentives
Unverified  requires primary filing review.
## SBC & Dilution Analysis
Unverified  requires primary filing review.
## Structural vs Cyclical Risk Separation
Unverified  requires primary filing review.
## Strategic Optionality & Upside Drivers
Unverified  requires primary filing review.
## Market Belief vs Mispricing Hypothesis
Unverified  requires primary filing review.
## Investment Framing Summary
Unverified  requires primary filing review.

PART B  CLAIMS LEDGER
[{broken json}
"""
        called = {"count": 0}

        async def repair_fn(_meta):
            called["count"] += 1
            return json.dumps(
                [
                    {
                        "claim_type": "qualitative",
                        "metric": "governance_data_gap",
                        "value": None,
                        "unit": None,
                        "timeframe": None,
                        "statement": "Unverified  requires primary filing review.",
                        "confidence": "low",
                        "source_type": "unknown",
                        "source_citation": "unverified",
                        "notes": "Missing primary filing support.",
                    }
                ]
            )

        part_a, claims, meta = await validate_stage2_with_repair(
            bad_output,
            deal_detected=False,
            repair_ledger_json_fn=repair_fn,
        )
        self.assertIn("Leadership, Governance & Incentives", part_a)
        self.assertEqual(called["count"], 1)
        self.assertTrue(meta["repair_used"])
        self.assertTrue(meta["valid"])
        self.assertEqual(len(claims), 1)

    def test_management_section_requires_management_claims(self):
        text = """PART A
## Business Model & Revenue Architecture
Unverified  requires primary filing review.
## Competitive Position & Power Structure
Unverified  requires primary filing review.
## Financial Quality Snapshot
Unverified  requires primary filing review.
## Capital Structure & Liquidity
Unverified  requires primary filing review.
## Leadership, Governance & Incentives
CEO transition underway. timeframe=FY2025 unit=event source_type=SEC/IR source_citation=10-K
## SBC & Dilution Analysis
Unverified  requires primary filing review.
## Structural vs Cyclical Risk Separation
Unverified  requires primary filing review.
## Strategic Optionality & Upside Drivers
Unverified  requires primary filing review.
## Market Belief vs Mispricing Hypothesis
Unverified  requires primary filing review.
## Investment Framing Summary
Unverified  requires primary filing review.

PART B  CLAIMS LEDGER
[{"claim_type":"qualitative","metric":"demand_trend","value":null,"unit":null,"timeframe":null,"statement":"Unverified  requires primary filing review.","confidence":"low","source_type":"unknown","source_citation":"unverified","notes":""}]
"""
        _, _, meta = parse_and_validate_stage2_output(text, deal_detected=False)
        self.assertFalse(meta["valid"])
        self.assertTrue(any("governance claims were not found" in err for err in meta["parse_errors"]))


class DealDetectionTests(unittest.TestCase):
    def test_deal_detection_heuristic(self):
        self.assertTrue(detect_deal_signal("Company entered a definitive agreement to be acquired."))
        self.assertTrue(detect_deal_signal("Offer price disclosed in merger filing."))
        self.assertFalse(detect_deal_signal("No transaction announced; focus remains organic growth."))


if __name__ == "__main__":
    unittest.main()
