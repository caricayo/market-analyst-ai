import json
import os
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        if key not in os.environ:
            os.environ[key] = value.strip()


def _extract_text(response_obj: dict) -> str:
    direct = response_obj.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    parts: list[str] = []
    for item in response_obj.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            if content.get("type") in {"output_text", "text"}:
                txt = content.get("text")
                if isinstance(txt, str) and txt.strip():
                    parts.append(txt.strip())
    return "\n".join(parts).strip()


_load_env_file(ROOT / ".env")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "").strip()
RUN_LIVE = os.getenv("RUN_LIVE_GPT5_SMOKE", "").strip().lower() in {"1", "true", "yes"} and bool(OPENAI_KEY)


@unittest.skipUnless(RUN_LIVE, "Set RUN_LIVE_GPT5_SMOKE=1 and OPENAI_API_KEY to run live GPT-5 smoke test")
class LiveGPT5ResearchSmokeTests(unittest.TestCase):
    def test_gpt5_web_search_returns_text(self):
        payload = {
            "model": os.getenv("RESEARCH_MODEL", "gpt-5"),
            "instructions": "Use web search and return concise factual bullets with source URLs.",
            "input": "Apple Inc latest investor-relevant facts.",
            "max_output_tokens": 2200,
            "tools": [{"type": "web_search_preview", "search_context_size": "low"}],
            "reasoning": {"effort": "low"},
            "text": {"verbosity": "low"},
        }

        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            self.fail(f"Live GPT-5 smoke HTTP {exc.code}: {error_body}")

        response_obj = json.loads(body)
        if response_obj.get("error"):
            self.fail(f"Live GPT-5 smoke API error: {response_obj['error']}")

        text = _extract_text(response_obj)
        output_items = response_obj.get("output", []) or []
        web_calls = sum(
            1 for item in output_items
            if isinstance(item, dict) and "web_search" in str(item.get("type", ""))
        )

        self.assertGreater(web_calls, 0, "Expected at least one web_search tool call")
        self.assertGreater(len(text), 120, "Expected non-trivial assistant text output")
        self.assertRegex(text.lower(), r"https?://|sec\.gov|investor")


if __name__ == "__main__":
    unittest.main()
