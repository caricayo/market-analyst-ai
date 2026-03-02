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

from api.services.claims_ledger import (  # noqa: E402
    MARKET_DATA_FALLBACK,
    detect_deal_signal,
    load_and_validate_ledger,
    parse_and_validate_stage2_output,
    parse_stage2_output,
    validate_stage2_with_repair,
)


def _base_part_a(financial_line: str, extra: str = "") -> str:
    return f"""PART A
## Business Model & Revenue Architecture
Unverified  requires primary filing review.
## Competitive Position & Power Structure
Unverified  requires primary filing review.
## Financial Quality Snapshot
{financial_line}
{extra}
## Capital Structure & Liquidity
Net debt not computed due to sourcing limits.
## Leadership, Governance & Incentives
CEO has prior operating background. timeframe=FY2025 unit=event source_type=SEC/IR source_citation=10-K [C2]
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
"""


def _base_ledger(claim1: dict, claim2: dict | None = None) -> list[dict]:
    governance = claim2 or {
        "claim_type": "qualitative",
        "metric": "governance_quality",
        "value": None,
        "unit": "event",
        "timeframe": "FY2025",
        "statement": "CEO has prior operating background. timeframe=FY2025 unit=event source_type=SEC/IR source_citation=10-K",
        "confidence": "medium",
        "source_type": "SEC/IR",
        "source_citation": "10-K",
        "notes": "",
        "claim_id": "C2",
        "source_url": "https://www.sec.gov/ixviewer/ix.html",
        "source_title": "10-K",
        "source_domain": "sec.gov",
    }
    return [claim1, governance]


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

    def test_event_date_must_be_iso_or_parsed(self):
        payload = [
            {
                "claim_type": "qualitative",
                "metric": "earnings_date",
                "value": None,
                "unit": "event",
                "timeframe": "Q1 FY2026",
                "statement": "[Scheduled Event] Earnings release expected. timeframe=Q1 FY2026 unit=event source_type=SEC/IR source_citation=8-K",
                "confidence": "medium",
                "source_type": "SEC/IR",
                "source_citation": "8-K",
                "notes": "",
                "claim_id": "C1",
                "source_url": "https://www.sec.gov/ixviewer/ix.html",
                "source_title": "8-K",
                "source_domain": "sec.gov",
                "is_forward_looking": True,
                "event_date": "03/04/2026",
            }
        ]
        claims, _meta = load_and_validate_ledger(json.dumps(payload), as_of_date="2026-03-02")
        self.assertEqual(claims[0]["event_date"], "2026-03-04")

    def test_timeframe_labels_present(self):
        claim = {
            "claim_type": "numeric",
            "metric": "revenue_growth",
            "value": 12,
            "unit": "percent",
            "timeframe": None,
            "statement": "Revenue growth was 12%. unit=percent source_type=SEC/IR source_citation=10-K [C1]",
            "confidence": "medium",
            "source_type": "SEC/IR",
            "source_citation": "10-K",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://www.sec.gov/ixviewer/ix.html",
            "source_title": "10-K",
            "source_domain": "sec.gov",
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, _claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
        )
        self.assertFalse(meta["valid"])
        self.assertTrue(any("timeframe" in e.lower() for e in meta["truth_discipline_errors"]))

    def test_high_confidence_requires_tier1_or_2(self):
        claim = {
            "claim_type": "qualitative",
            "metric": "industry_structure",
            "value": None,
            "unit": None,
            "timeframe": "FY2025",
            "statement": "Industry concentration elevated. timeframe=FY2025 unit=index source_type=estimate source_citation=https://stockanalysis.com [C1]",
            "confidence": "high",
            "source_type": "estimate",
            "source_citation": "https://stockanalysis.com/foo",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://stockanalysis.com/foo",
            "source_title": "Aggregator",
            "source_domain": "stockanalysis.com",
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, claims, _meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
        )
        self.assertEqual(claims[0]["confidence"], "medium")
        self.assertTrue(claims[0]["weak_source_used"])

    def test_market_share_requires_definition(self):
        claim = {
            "claim_type": "numeric",
            "metric": "market share",
            "value": 24.56,
            "unit": "percent",
            "timeframe": "FY2025",
            "statement": "Market share was 24.56%. timeframe=FY2025 unit=percent source_type=reputable_market_data source_citation=https://example.com [C1]",
            "confidence": "medium",
            "source_type": "reputable_market_data",
            "source_citation": "https://example.com",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://example.com",
            "source_title": "Example",
            "source_domain": "example.com",
            "definition": None,
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, _claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
        )
        self.assertFalse(meta["truth_discipline_valid"])
        self.assertTrue(any("market share" in e.lower() for e in meta["truth_discipline_errors"]))

    def test_debt_terms_require_sec_source(self):
        claim = {
            "claim_type": "numeric",
            "metric": "revolver interest rate",
            "value": 7.2,
            "unit": "percent",
            "timeframe": "FY2025",
            "statement": "Revolver coupon was 7.2%. timeframe=FY2025 unit=percent source_type=estimate source_citation=unverified [C1]",
            "confidence": "medium",
            "source_type": "estimate",
            "source_citation": "unverified",
            "notes": "",
            "claim_id": "C1",
            "source_url": None,
            "source_title": None,
            "source_domain": None,
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
        )
        self.assertEqual(claims[0]["claim_type"], "qualitative")
        self.assertFalse(meta["truth_discipline_valid"])

    def test_future_results_blocked(self):
        claim = {
            "claim_type": "qualitative",
            "metric": "earnings",
            "value": None,
            "unit": "event",
            "timeframe": "Q3 FY2026",
            "statement": "Company reported Q3 2026 results. timeframe=Q3 FY2026 unit=event source_type=SEC/IR source_citation=8-K [C1]",
            "confidence": "medium",
            "source_type": "SEC/IR",
            "source_citation": "8-K",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://www.sec.gov/ixviewer/ix.html",
            "source_title": "8-K",
            "source_domain": "sec.gov",
            "event_date": "2026-11-01",
            "is_forward_looking": False,
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
        )
        self.assertFalse(meta["truth_discipline_valid"])
        self.assertTrue(claims[0]["excluded_from_text"])

    def test_market_data_requires_runtime_source(self):
        claim = {
            "claim_type": "numeric",
            "metric": "current price",
            "value": 113.79,
            "unit": "USD",
            "timeframe": "as of 2026-03-02",
            "statement": "Current price was $113.79. timeframe=as of 2026-03-02 unit=USD source_type=unknown source_citation=unverified [C1]",
            "confidence": "low",
            "source_type": "unknown",
            "source_citation": "unverified",
            "notes": "",
            "claim_id": "C1",
            "source_url": None,
            "source_title": None,
            "source_domain": None,
            "market_data_kind": "snapshot",
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, _claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
            has_live_market_feed=False,
        )
        self.assertFalse(meta["truth_discipline_valid"])

    def test_part_a_market_data_leakage_blocked_without_live_feed(self):
        line = "Revenue growth was 12%. timeframe=FY2025 unit=percent source_type=SEC/IR source_citation=10-K [C1]"
        extra = "### Current Price\nCurrent Price: $113.79"
        claim = {
            "claim_type": "numeric",
            "metric": "revenue_growth",
            "value": 12,
            "unit": "percent",
            "timeframe": "FY2025",
            "statement": line,
            "confidence": "medium",
            "source_type": "SEC/IR",
            "source_citation": "10-K",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://www.sec.gov/ixviewer/ix.html",
            "source_title": "10-K",
            "source_domain": "sec.gov",
        }
        output = f"{_base_part_a(line, extra=extra)}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, _claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
            has_live_market_feed=False,
        )
        self.assertFalse(meta["valid"])
        self.assertTrue(any("market data leakage" in e.lower() for e in meta["parse_errors"]))

    def test_truth_discipline_valid_none_until_validated(self):
        claim = {
            "claim_type": "qualitative",
            "metric": "business_model",
            "value": None,
            "unit": None,
            "timeframe": "FY2025",
            "statement": "Recurring subscription mix is meaningful. timeframe=FY2025 unit=index source_type=SEC/IR source_citation=10-K [C1]",
            "confidence": "medium",
            "source_type": "SEC/IR",
            "source_citation": "10-K",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://www.sec.gov/ixviewer/ix.html",
            "source_title": "10-K",
            "source_domain": "sec.gov",
        }
        output = f"{_base_part_a(claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(claim))}"
        _part_a, _claims, meta = parse_and_validate_stage2_output(
            output,
            as_of_date="2026-03-02",
            truth_discipline_enabled=False,
        )
        self.assertIsNone(meta["truth_discipline_valid"])


class RepairFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_repair_removes_invalid_claims(self):
        bad_claim = {
            "claim_type": "qualitative",
            "metric": "earnings",
            "value": None,
            "unit": "event",
            "timeframe": "Q3 FY2026",
            "statement": "Company reported Q3 2026 results. timeframe=Q3 FY2026 unit=event source_type=SEC/IR source_citation=8-K [C1]",
            "confidence": "medium",
            "source_type": "SEC/IR",
            "source_citation": "8-K",
            "notes": "",
            "claim_id": "C1",
            "source_url": "https://www.sec.gov/ixviewer/ix.html",
            "source_title": "8-K",
            "source_domain": "sec.gov",
            "event_date": "2026-11-01",
        }
        output = f"{_base_part_a(bad_claim['statement'])}\nPART B  CLAIMS LEDGER\n{json.dumps(_base_ledger(bad_claim))}"

        async def bad_repair(_meta):
            return "PART A only"

        part_a, claims, meta = await validate_stage2_with_repair(
            output,
            deal_detected=False,
            as_of_date="2026-03-02",
            truth_discipline_enabled=True,
            has_live_market_feed=False,
            repair_stage2_fn=bad_repair,
        )
        self.assertTrue(meta["content_degraded"])
        self.assertIn("Removed due to insufficient evidence", part_a)
        self.assertTrue(any(c.get("excluded_from_text") for c in claims))


class DealDetectionTests(unittest.TestCase):
    def test_deal_detection_heuristic(self):
        self.assertTrue(detect_deal_signal("Company entered a definitive agreement to be acquired."))
        self.assertTrue(detect_deal_signal("Offer price disclosed in merger filing."))
        self.assertFalse(detect_deal_signal("No transaction announced; focus remains organic growth."))

    def test_fallback_constant(self):
        self.assertEqual(MARKET_DATA_FALLBACK, "Data not retrieved in this run.")


if __name__ == "__main__":
    unittest.main()
