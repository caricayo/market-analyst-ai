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

from api.services.institutional_layer import apply_institutional_layer
from api.services.persona_parser import parse_persona


class _ConstantCaller:
    def __init__(self, output: str):
        self.output = output

    async def __call__(self, _system_prompt: str, _user_prompt: str) -> str:
        return self.output


class PipelineInstitutionalSmoke(unittest.IsolatedAsyncioTestCase):
    async def test_institutional_output_headings_and_persona_path(self):
        base_deep_dive = """## Section 0: Executive Summary

- Existing context only. Unverified / needs source.
"""
        enriched = """## Section 0: Executive Summary

- Existing context only. Unverified / needs source.

## Strategic Positioning
- Value-chain power and profit-pool control.

## Capital Allocation & Incentives
- Alignment and governance quality discussion.

## Structural vs Cyclical Risks
- Distinguish permanent impairment from cycle noise.

## Asymmetry Framework
- Upside/downside skew framing without new numerics.

## Market Mispricing Hypothesis
- What the market believes and what could falsify it.

## Investment Framing Summary
- Qualitative framing by style and horizon.
"""
        caller = _ConstantCaller(enriched)

        deep_dive, meta = await apply_institutional_layer(
            company="AAPL",
            deep_dive_markdown=base_deep_dive,
            model_call=caller,
        )

        required_headings = [
            "## Strategic Positioning",
            "## Capital Allocation & Incentives",
            "## Structural vs Cyclical Risks",
            "## Asymmetry Framework",
            "## Market Mispricing Hypothesis",
            "## Investment Framing Summary",
        ]
        for heading in required_headings:
            self.assertIn(heading, deep_dive)

        self.assertTrue(meta["applied"])

        # Persona parser should still function in the same run path.
        persona_text = """### Verdict
**Rating:** Buy
**Confidence:** 8
**Time Horizon:** 3-5 years

### Position Sizing Suggestion
Moderate
"""
        verdict = parse_persona(
            persona_id="daniel",
            persona_name="Daniel Cho",
            persona_label="Quality Compounder",
            text=persona_text,
        )
        self.assertEqual(verdict.rating, "Buy")
        self.assertEqual(verdict.confidence, 8)
        self.assertEqual(verdict.position_size, "Moderate")


if __name__ == "__main__":
    unittest.main()
