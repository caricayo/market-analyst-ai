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

from api.services.institutional_layer import (
    apply_institutional_layer,
    extract_numeric_tokens,
    find_new_numeric_tokens,
)


class _SequenceCaller:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    async def __call__(self, _system_prompt: str, _user_prompt: str) -> str:
        self.calls += 1
        if not self.outputs:
            raise RuntimeError("No more mock outputs")
        return self.outputs.pop(0)


class NumericGuardTests(unittest.TestCase):
    def test_extract_numeric_tokens(self):
        tokens = extract_numeric_tokens("Revenue was $1.2 billion, margin 15%, leverage 3x.")
        self.assertIn("$1.2", tokens)
        self.assertIn("15%", tokens)
        self.assertIn("3x", tokens)

    def test_find_new_numeric_tokens(self):
        base = "Margin is 10% and revenue is $5."
        out = "Margin is 10% and leverage is 3x."
        new_tokens = find_new_numeric_tokens(base, out)
        self.assertIn("3x", new_tokens)
        self.assertNotIn("10%", new_tokens)


class InstitutionalLayerApplyTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_repairs_new_numbers(self):
        input_memo = "## Base Memo\n\nExisting figure: 10%."
        first = "## Strategic Positioning\nNew claim 25%."
        repaired = "## Strategic Positioning\nQualitative framing only. Existing figure: 10%."
        caller = _SequenceCaller([first, repaired])

        output, meta = await apply_institutional_layer(
            company="AAPL",
            deep_dive_markdown=input_memo,
            model_call=caller,
        )

        self.assertEqual(output, repaired)
        self.assertTrue(meta["applied"])
        self.assertTrue(meta["retry_used"])
        self.assertFalse(meta["blocked_new_numbers"])
        self.assertEqual(meta["new_number_count"], 0)
        self.assertEqual(caller.calls, 2)

    async def test_retry_fallback_when_numbers_remain(self):
        input_memo = "## Base Memo\n\nExisting figure: 10%."
        first = "## Strategic Positioning\nNew claim 25%."
        second = "## Strategic Positioning\nStill new number $999."
        caller = _SequenceCaller([first, second])

        output, meta = await apply_institutional_layer(
            company="AAPL",
            deep_dive_markdown=input_memo,
            model_call=caller,
        )

        self.assertEqual(output, input_memo)
        self.assertFalse(meta["applied"])
        self.assertTrue(meta["retry_used"])
        self.assertTrue(meta["blocked_new_numbers"])
        self.assertGreater(meta["new_number_count"], 0)
        self.assertEqual(caller.calls, 2)


if __name__ == "__main__":
    unittest.main()
