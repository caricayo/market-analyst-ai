"""
TriView Capital — Configuration

Model settings, token budgets, temperature controls, and system-wide constants.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def _env_float(name: str, default: float) -> float:
    """Parse float env vars safely with a fallback."""
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
TEMPLATE_PATH = PROJECT_ROOT / "investment-due-diligence-prompt.md"
PERSONAS_DIR = PROJECT_ROOT / "personas"
SYNTHESIS_PROMPT_PATH = PROJECT_ROOT / "synthesis" / "synthesis-prompt.md"
OUTPUT_DIR = PROJECT_ROOT / "reports"

# ---------------------------------------------------------------------------
# OpenAI API
# ---------------------------------------------------------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Standard token pricing (USD per 1M tokens), aligned with docs pricing.
# Override via env vars if your account tier differs (batch/flex/priority).
OPENAI_MODEL_PRICING_PER_1M = {
    "gpt-4.1": {
        "input": _env_float("OPENAI_GPT41_INPUT_PER_1M", 2.00),
        "cached_input": _env_float("OPENAI_GPT41_CACHED_INPUT_PER_1M", 0.50),
        "output": _env_float("OPENAI_GPT41_OUTPUT_PER_1M", 8.00),
    },
    "gpt-4.1-mini": {
        "input": _env_float("OPENAI_GPT41_MINI_INPUT_PER_1M", 0.40),
        "cached_input": _env_float("OPENAI_GPT41_MINI_CACHED_INPUT_PER_1M", 0.10),
        "output": _env_float("OPENAI_GPT41_MINI_OUTPUT_PER_1M", 1.60),
    },
    "gpt-4o-mini": {
        "input": _env_float("OPENAI_GPT4O_MINI_INPUT_PER_1M", 0.15),
        "cached_input": _env_float("OPENAI_GPT4O_MINI_CACHED_INPUT_PER_1M", 0.075),
        "output": _env_float("OPENAI_GPT4O_MINI_OUTPUT_PER_1M", 0.60),
    },
}

# Web search tool pricing (USD per 1K tool calls).
OPENAI_WEB_SEARCH_PRICING_PER_1K = {
    "web_search": _env_float("OPENAI_WEB_SEARCH_PER_1K", 10.0),
    "web_search_preview_non_reasoning": _env_float("OPENAI_WEB_SEARCH_PREVIEW_NON_REASONING_PER_1K", 25.0),
    "web_search_preview_reasoning": _env_float("OPENAI_WEB_SEARCH_PREVIEW_REASONING_PER_1K", 10.0),
}

# ---------------------------------------------------------------------------
# Model Configuration
# ---------------------------------------------------------------------------
# Stage 2: Deep Dive (legacy monolithic — kept for reference)
DEEP_DIVE_MODEL = "gpt-4.1"
DEEP_DIVE_TEMPERATURE = 0.25
DEEP_DIVE_MAX_TOKENS = 32_000  # large output — 14 detailed sections
DEEP_DIVE_TIMEOUT = 600  # 10 minutes
FACT_FIRST_DEEP_DIVE_ENABLED = os.getenv("FACT_FIRST_DEEP_DIVE_ENABLED", "true").lower() == "true"
FACT_FIRST_DILIGENCE_ENABLED = os.getenv("FACT_FIRST_DILIGENCE_ENABLED", "true").lower() == "true"
INSTITUTIONAL_LAYER_MODEL = os.getenv("INSTITUTIONAL_LAYER_MODEL", "gpt-5-mini")

# Stage 2A: Scatter-Gather Research (parallel lanes + merge)
RESEARCH_MODEL = "gpt-4.1-mini"            # Data gathering, not analysis — faster
RESEARCH_LANE_MAX_TOKENS = 3_000           # Each lane: ~2000-3000 chars
RESEARCH_LANE_TIMEOUT = 90                 # Per lane (expected: 20-40s)
RESEARCH_MERGE_MAX_TOKENS = 12_000         # Unified brief
RESEARCH_MERGE_TIMEOUT = 60                # No web search
RESEARCH_PHASE_TIMEOUT = 150               # Outer safety net (2.5 min)
RESEARCH_SEARCH_CONTEXT_SIZE = "low"       # Minimize context for speed
RESEARCH_MIN_LANES_REQUIRED = 3            # Minimum lanes to proceed

RESEARCH_LANES = {
    "R1": {"label": "Fundamentals & Financials"},
    "R2": {"label": "Balance Sheet & Capital"},
    "R3": {"label": "Leadership & Governance"},
    "R4": {"label": "Industry & Competition"},
    "R5": {"label": "Valuation & Ownership"},
    "R6": {"label": "Catalysts & Bear Case"},
}

# Stage 2B: Parallel Section Writes (GPT-4.1-mini, no web search)
SECTION_WRITE_MODEL = "gpt-4.1-mini"
SECTION_WRITE_MAX_TOKENS = 12_000
SECTION_WRITE_TIMEOUT = 180         # 3 min per group

# Stage 2C: Bookend Sections 0,12,13 (GPT-4.1-mini, no web search)
BOOKEND_MODEL = "gpt-4.1-mini"
BOOKEND_MAX_TOKENS = 6_000
BOOKEND_TIMEOUT = 120               # 2 min

# Section groupings for parallel writes
SECTION_GROUPS = {
    "A": {"sections": [1, 2, 3], "label": "Business, Financials, Leadership"},
    "B": {"sections": [4, 5, 6], "label": "Industry, Valuation, Ownership"},
    "C": {"sections": [7, 8, 9], "label": "Variant View, Bear Thesis, Catalysts"},
    "D": {"sections": [10, 11], "label": "Scenarios, Capital Allocation"},
}
BOOKEND_SECTIONS = [0, 12, 13]

# Stage 3: Personas
PERSONA_MODEL = "gpt-4.1-mini"
PERSONA_TEMPERATURE = 0.7
PERSONA_MAX_TOKENS = 6_000
PERSONA_TIMEOUT = 180  # 3 minutes

# Stage 4: Synthesis
SYNTHESIS_MODEL = "gpt-4.1-mini"
SYNTHESIS_TEMPERATURE = 0.3
SYNTHESIS_MAX_TOKENS = 5_000
SYNTHESIS_TIMEOUT = 180  # 3 minutes

# ---------------------------------------------------------------------------
# Web Search
# ---------------------------------------------------------------------------
# Only Stage 2 (deep dive) uses web search
DEEP_DIVE_WEB_SEARCH = True

# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------
CACHE_ENABLED = True
DEEP_DIVE_CACHE_TTL_HOURS = 24
PERSONA_CACHE_TTL_HOURS = 4

# ---------------------------------------------------------------------------
# Retry
# ---------------------------------------------------------------------------
MAX_RETRIES = 1  # retry once on failure
RETRY_DELAY_SECONDS = 5

# ---------------------------------------------------------------------------
# Input Validation
# ---------------------------------------------------------------------------
MAX_TICKER_LENGTH = 100
ALLOWED_TICKER_CHARS = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "0123456789 .&-'"
)

# ---------------------------------------------------------------------------
# Template Integrity
# ---------------------------------------------------------------------------
TEMPLATE_PLACEHOLDER = "[COMPANY_NAME_OR_TICKER]"

# ---------------------------------------------------------------------------
# Persona Registry
# ---------------------------------------------------------------------------
PERSONAS = [
    {
        "id": "eleanor",
        "name": "Eleanor Grant",
        "label": "Deep Value & Capital Preservation",
        "file": PERSONAS_DIR / "eleanor-grant-value.md",
    },
    {
        "id": "daniel",
        "name": "Daniel Cho",
        "label": "Quality Compounder",
        "file": PERSONAS_DIR / "daniel-cho-compounder.md",
    },
    {
        "id": "victor",
        "name": "Victor Alvarez",
        "label": "Macro-Strategic & Cycle Analyst",
        "file": PERSONAS_DIR / "victor-alvarez-macro.md",
    },
]
