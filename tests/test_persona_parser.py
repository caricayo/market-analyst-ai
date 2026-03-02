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

from api.services.persona_parser import parse_persona


class PersonaParserFallbackTests(unittest.TestCase):
    def test_fallback_extracts_rating_and_position_from_summary(self):
        text = (
            "**Summary:** This is speculative. I recommend Avoid and a very small position "
            "only for specialized buckets with a 12-24 months horizon."
        )
        verdict = parse_persona(
            persona_id="victor",
            persona_name="Victor Alvarez",
            persona_label="Macro",
            text=text,
        )
        self.assertEqual(verdict.rating, "Avoid")
        self.assertEqual(verdict.position_size, "Small")
        self.assertEqual(verdict.time_horizon.lower(), "12-24 months")


if __name__ == "__main__":
    unittest.main()
