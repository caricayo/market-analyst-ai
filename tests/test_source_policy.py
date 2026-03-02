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

from api.services.source_policy import classify_claim_source, extract_source_domain, normalize_source_url


class SourcePolicyTests(unittest.TestCase):
    def test_normalize_source_url(self):
        self.assertEqual(
            normalize_source_url("https://www.sec.gov/ixviewer/ix.html"),
            "https://www.sec.gov/ixviewer/ix.html",
        )
        self.assertIsNone(normalize_source_url("sec.gov/doc"))

    def test_extract_domain(self):
        self.assertEqual(extract_source_domain("https://www.sec.gov/ixviewer/ix.html"), "sec.gov")
        self.assertIsNone(extract_source_domain(None))

    def test_classify_tiers(self):
        tier, verified = classify_claim_source(
            source_type="SEC/IR",
            source_citation="10-K",
            source_url="https://www.sec.gov/ixviewer/ix.html",
        )
        self.assertEqual(tier, "tier1")
        self.assertTrue(verified)

        tier, verified = classify_claim_source(
            source_type="reputable_market_data",
            source_citation="https://www.nasdaq.com",
            source_url="https://www.nasdaq.com",
        )
        self.assertEqual(tier, "tier2")
        self.assertTrue(verified)

        tier, verified = classify_claim_source(
            source_type="estimate",
            source_citation="unverified",
            source_url=None,
        )
        self.assertEqual(tier, "unknown")
        self.assertFalse(verified)


if __name__ == "__main__":
    unittest.main()

