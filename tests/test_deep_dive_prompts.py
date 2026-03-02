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

from deep_dive_prompts import (
    FACT_FIRST_DILIGENCE_SYSTEM,
    INSTITUTIONAL_LAYER_SYSTEM,
    fact_first_diligence_prompt,
    institutional_layer_prompt,
)


class InstitutionalPromptTests(unittest.TestCase):
    def test_institutional_layer_prompt_non_empty(self):
        system_prompt, user_prompt = institutional_layer_prompt(
            "AAPL",
            "## Existing Memo\n\nUnverified / needs source",
        )
        self.assertTrue(system_prompt.strip())
        self.assertTrue(user_prompt.strip())

    def test_institutional_layer_prompt_contains_required_sections(self):
        _, user_prompt = institutional_layer_prompt("AAPL", "memo")
        required = [
            "Strategic Positioning",
            "Capital Allocation & Incentives",
            "Structural vs Cyclical Risks",
            "Asymmetry Framework",
            "Market Mispricing Hypothesis",
            "Investment Framing Summary",
            "NO NEW NUMERIC CLAIMS",
        ]
        for needle in required:
            self.assertIn(needle, user_prompt)

    def test_system_prompt_has_guardrails(self):
        self.assertIn("Do NOT introduce new numeric financial claims", INSTITUTIONAL_LAYER_SYSTEM)
        self.assertIn("Do NOT fabricate facts", INSTITUTIONAL_LAYER_SYSTEM)


class FactFirstDiligencePromptTests(unittest.TestCase):
    def test_prompt_non_empty(self):
        system_prompt, user_prompt = fact_first_diligence_prompt("AAPL", "brief")
        self.assertTrue(system_prompt.strip())
        self.assertTrue(user_prompt.strip())

    def test_prompt_contains_required_sections(self):
        _, user_prompt = fact_first_diligence_prompt("AAPL", "brief")
        required = [
            "PART A",
            "PART B  CLAIMS LEDGER",
            "Business Model & Revenue Architecture",
            "Competitive Position & Power Structure",
            "Financial Quality Snapshot",
            "Capital Structure & Liquidity",
            "Leadership, Governance & Incentives (Mandatory)",
            "SBC & Dilution Analysis (Mandatory)",
            "Structural vs Cyclical Risk Separation",
            "Strategic Optionality & Upside Drivers",
            "Market Belief vs Mispricing Hypothesis",
            "Deal-Arb Appendix",
            "Investment Framing Summary",
        ]
        for needle in required:
            self.assertIn(needle, user_prompt)

    def test_system_enforces_hard_rules(self):
        self.assertIn("No naked numbers", FACT_FIRST_DILIGENCE_SYSTEM)
        self.assertIn("Do not fabricate facts", FACT_FIRST_DILIGENCE_SYSTEM)
        self.assertIn("SBC & Dilution Analysis section is mandatory", FACT_FIRST_DILIGENCE_SYSTEM)
        self.assertIn("Leadership, Governance & Incentives section is mandatory", FACT_FIRST_DILIGENCE_SYSTEM)


if __name__ == "__main__":
    unittest.main()
