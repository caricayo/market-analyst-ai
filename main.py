"""
TriView Capital — Main Orchestration Engine

5-stage pipeline:
  1. Intake — normalize ticker, sanitize input, prepare template
  2. Deep Dive — GPT-5 with web search, full 14-section institutional report
  3. Personas — 3 parallel GPT-5 Mini calls, each evaluating the deep dive
  4. Synthesis — GPT-5 Mini arbitration across all 3 persona verdicts
  5. Assembly — combine, validate, and output final report

Usage:
  python main.py AAPL
  python main.py "Meta Platforms"
"""

import asyncio
import json
import logging
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from config import (
    OPENAI_API_KEY,
    OPENAI_PROMPT_CACHE_ENABLED,
    OPENAI_PROMPT_CACHE_RETENTION,
    OPENAI_PROMPT_CACHE_NAMESPACE,
    DEEP_DIVE_MODEL,
    DEEP_DIVE_TEMPERATURE,
    DEEP_DIVE_MAX_TOKENS,
    DEEP_DIVE_TIMEOUT,
    DEEP_DIVE_WEB_SEARCH,
    RESEARCH_MODEL,
    RESEARCH_LANE_MAX_TOKENS,
    RESEARCH_LANE_TIMEOUT,
    RESEARCH_MERGE_MAX_TOKENS,
    RESEARCH_MERGE_TIMEOUT,
    RESEARCH_PHASE_TIMEOUT,
    RESEARCH_MIN_LANES_REQUIRED,
    RESEARCH_LANES,
    SECTION_WRITE_MODEL,
    SECTION_WRITE_MAX_TOKENS,
    SECTION_WRITE_TIMEOUT,
    BOOKEND_MODEL,
    BOOKEND_MAX_TOKENS,
    BOOKEND_TIMEOUT,
    SECTION_GROUPS,
    BOOKEND_SECTIONS,
    PERSONA_MODEL,
    PERSONA_TEMPERATURE,
    PERSONA_MAX_TOKENS,
    PERSONA_TIMEOUT,
    SYNTHESIS_MODEL,
    SYNTHESIS_TEMPERATURE,
    SYNTHESIS_MAX_TOKENS,
    SYNTHESIS_TIMEOUT,
    MAX_RETRIES,
    RETRY_DELAY_SECONDS,
    PERSONAS,
    SYNTHESIS_PROMPT_PATH,
    OPENAI_MODEL_PRICING_PER_1M,
    OPENAI_WEB_SEARCH_PRICING_PER_1K,
    FACT_FIRST_DILIGENCE_ENABLED,
    FACT_FIRST_DILIGENCE_MAX_TOKENS,
    DEEP_DIVE_OUTPUT_MODE,
    DEEP_DIVE_MIN_CHARS,
    DEEP_DIVE_MIN_H2,
    INSTITUTIONAL_LAYER_MODEL,
    INSTITUTIONAL_LAYER_MAX_TOKENS,
)
from intake import run_intake, IntakeError
from assembly import (
    assemble_report,
    save_report,
    extract_executive_summary,
    PERSONA_SPLIT_MARKER,
)
from deep_dive_prompts import (
    RESEARCH_LANE_PROMPTS,
    RESEARCH_MERGE_PROMPT,
    load_template_sections,
    section_group_prompt,
    bookend_prompt,
    fact_first_diligence_prompt,
)
from api.services.claims_ledger import (
    detect_deal_signal,
    parse_and_validate_stage2_output,
    validate_stage2_with_repair,
)
from api.services.institutional_layer import apply_institutional_layer


# ---------------------------------------------------------------------------
# OpenAI Client
# ---------------------------------------------------------------------------
client = AsyncOpenAI(api_key=OPENAI_API_KEY)
log = logging.getLogger(__name__)


def _as_dict(value) -> dict:
    """Convert OpenAI SDK objects/dicts into plain dicts."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump()
        except Exception:
            return {}
    if hasattr(value, "dict"):
        try:
            return value.dict()
        except Exception:
            return {}
    if hasattr(value, "__dict__"):
        try:
            return dict(value.__dict__)
        except Exception:
            return {}
    return {}


def _safe_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _resolve_model_pricing(model_name: str) -> dict[str, float]:
    """Resolve pricing by exact model id or base prefix (e.g. gpt-4.1-mini-*)."""
    if model_name in OPENAI_MODEL_PRICING_PER_1M:
        return OPENAI_MODEL_PRICING_PER_1M[model_name]

    for base_model, pricing in OPENAI_MODEL_PRICING_PER_1M.items():
        if model_name.startswith(f"{base_model}-") or model_name.startswith(base_model):
            return pricing

    # Default to mini pricing when model name is unavailable.
    return OPENAI_MODEL_PRICING_PER_1M.get("gpt-4.1-mini", {"input": 0.0, "cached_input": 0.0, "output": 0.0})


def _count_web_search_calls(response) -> int:
    """Count web search tool calls in a responses API result."""
    output_items = getattr(response, "output", None) or []
    count = 0
    for item in output_items:
        item_dict = _as_dict(item)
        item_type = item_dict.get("type")
        if not item_type and hasattr(item, "type"):
            item_type = getattr(item, "type")
        if isinstance(item_type, str) and "web_search" in item_type:
            count += 1
    return count


def _deep_dive_quality_stats(markdown: str) -> dict[str, int | bool]:
    text = markdown or ""
    h2_count = len(re.findall(r"(?m)^##\s+", text))
    deep_chars = len(text)
    return {
        "deep_chars": deep_chars,
        "h2_count": h2_count,
        "section_check_passed": deep_chars >= DEEP_DIVE_MIN_CHARS and h2_count >= DEEP_DIVE_MIN_H2,
    }


def _normalize_cache_fragment(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
    return normalized.strip("-") or "na"


def _build_prompt_cache_key(
    *,
    stage: str,
    model: str,
    company: str = "",
    variant: str = "default",
    prompt_version: str = "v1",
) -> str:
    return ":".join(
        [
            _normalize_cache_fragment(OPENAI_PROMPT_CACHE_NAMESPACE),
            _normalize_cache_fragment(stage),
            _normalize_cache_fragment(model),
            _normalize_cache_fragment(prompt_version),
            _normalize_cache_fragment(variant),
            _normalize_cache_fragment(company),
        ]
    )


async def _create_response(
    *,
    model: str,
    instructions: str,
    input_text: str,
    max_output_tokens: int,
    timeout_seconds: int,
    usage_tracker,
    cache_key: str | None = None,
    tools: list[dict[str, Any]] | None = None,
):
    request_kwargs: dict[str, Any] = {
        "model": model,
        "instructions": instructions,
        "input": input_text,
        "max_output_tokens": max_output_tokens,
    }
    if tools is not None:
        request_kwargs["tools"] = tools

    cache_enabled = OPENAI_PROMPT_CACHE_ENABLED and bool(cache_key)
    if cache_enabled:
        request_kwargs["prompt_cache_key"] = cache_key
        request_kwargs["prompt_cache_retention"] = OPENAI_PROMPT_CACHE_RETENTION

    try:
        response = await asyncio.wait_for(
            client.responses.create(**request_kwargs),
            timeout=timeout_seconds,
        )
    except Exception as e:
        # Some SDK/account combinations may reject cache params.
        if cache_enabled and "prompt_cache" in str(e).lower():
            log.warning("Prompt caching rejected for key %s. Retrying without cache params.", cache_key)
            request_kwargs.pop("prompt_cache_key", None)
            request_kwargs.pop("prompt_cache_retention", None)
            response = await asyncio.wait_for(
                client.responses.create(**request_kwargs),
                timeout=timeout_seconds,
            )
        else:
            raise

    if usage_tracker:
        usage_tracker.record_response(response)
    return response


@dataclass
class UsageTracker:
    """Accumulates token usage and estimated cost for one pipeline run."""
    request_count: int = 0
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    web_search_calls: int = 0
    input_token_cost_usd: float = 0.0
    output_token_cost_usd: float = 0.0
    web_search_cost_usd: float = 0.0
    estimated_cache_savings_usd: float = 0.0

    def record_response(self, response) -> None:
        usage = _as_dict(getattr(response, "usage", None))
        input_tokens = _safe_int(usage.get("input_tokens"))
        output_tokens = _safe_int(usage.get("output_tokens"))
        total_tokens = _safe_int(usage.get("total_tokens")) or (input_tokens + output_tokens)

        input_details = _as_dict(usage.get("input_tokens_details"))
        cached_tokens = _safe_int(input_details.get("cached_tokens"))
        billable_input_tokens = max(input_tokens - cached_tokens, 0)

        model_name = str(getattr(response, "model", "") or "")
        model_pricing = _resolve_model_pricing(model_name)

        self.request_count += 1
        self.input_tokens += input_tokens
        self.cached_input_tokens += cached_tokens
        self.output_tokens += output_tokens
        self.total_tokens += total_tokens

        self.input_token_cost_usd += (
            (billable_input_tokens * model_pricing.get("input", 0.0))
            + (cached_tokens * model_pricing.get("cached_input", 0.0))
        ) / 1_000_000
        self.estimated_cache_savings_usd += (
            cached_tokens * max(model_pricing.get("input", 0.0) - model_pricing.get("cached_input", 0.0), 0.0)
        ) / 1_000_000
        self.output_token_cost_usd += (
            output_tokens * model_pricing.get("output", 0.0)
        ) / 1_000_000

        search_calls = _count_web_search_calls(response)
        self.web_search_calls += search_calls
        self.web_search_cost_usd += (
            search_calls * OPENAI_WEB_SEARCH_PRICING_PER_1K.get("web_search_preview_non_reasoning", 0.0)
        ) / 1_000

    def snapshot(self) -> dict[str, int | float]:
        total_cost = self.input_token_cost_usd + self.output_token_cost_usd + self.web_search_cost_usd
        return {
            "request_count": self.request_count,
            "input_tokens": self.input_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "web_search_calls": self.web_search_calls,
            "input_token_cost_usd": round(self.input_token_cost_usd, 6),
            "output_token_cost_usd": round(self.output_token_cost_usd, 6),
            "web_search_cost_usd": round(self.web_search_cost_usd, 6),
            "estimated_cache_savings_usd": round(self.estimated_cache_savings_usd, 6),
            "cache_enabled": OPENAI_PROMPT_CACHE_ENABLED,
            "cache_retention": OPENAI_PROMPT_CACHE_RETENTION,
            "total_cost_usd": round(total_cost, 6),
        }


# ---------------------------------------------------------------------------
# Progress Display
# ---------------------------------------------------------------------------
def progress(stage: str, detail: str = "", _on_progress=None, _start=None) -> None:
    """Print a timestamped progress message and optionally invoke a callback."""
    elapsed = time.time() - (_start or _start_time)
    msg = f"[{elapsed:6.1f}s] {stage}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    if _on_progress is not None:
        _on_progress(stage, "running", detail)


# ---------------------------------------------------------------------------
# Stage 2: Deep Dive — 3-Phase Pipeline
# ---------------------------------------------------------------------------

async def run_research_lane(
    lane_id: str,
    company: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
) -> tuple[str, str]:
    """
    Run a single focused research lane with web search.

    Returns (lane_id, text). On failure after retries, returns (lane_id, "").
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    label = RESEARCH_LANES[lane_id]["label"]
    prompt = RESEARCH_LANE_PROMPTS[lane_id].format(company=company)

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.responses.create(
                    model=RESEARCH_MODEL,
                    instructions=prompt,
                    input=f"Gather research data for {company}. "
                          f"Search the web for real, current data.",
                    max_output_tokens=RESEARCH_LANE_MAX_TOKENS,
                    tools=[{"type": "web_search_preview"}],
                ),
                timeout=RESEARCH_LANE_TIMEOUT,
            )
            if usage_tracker:
                usage_tracker.record_response(response)

            text = response.output_text
            if not text:
                raise ValueError(f"Lane {lane_id} returned empty output")

            _p("Stage 2", f"Research lane {lane_id} ({label}) complete ({len(text):,} chars)")
            return lane_id, text

        except Exception as e:
            if attempt < MAX_RETRIES:
                _p("Stage 2", f"Lane {lane_id} ({label}) attempt {attempt + 1} failed: {e}. Retrying...")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            else:
                _p("Stage 2", f"WARNING: Lane {lane_id} ({label}) failed: {e}")
                return lane_id, ""


async def merge_research_lanes(
    company: str,
    lane_results: dict[str, str],
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
) -> str:
    """
    Merge successful lane outputs into a unified research brief.
    No web search — pure text synthesis.

    Falls back to raw concatenation if the merge API call fails.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)

    # Build lane output block for the merge prompt
    lane_parts = []
    for lane_id in sorted(lane_results.keys()):
        label = RESEARCH_LANES[lane_id]["label"]
        text = lane_results[lane_id]
        lane_parts.append(f"### Lane {lane_id}: {label}\n\n{text}")
    lane_outputs_text = "\n\n---\n\n".join(lane_parts)

    merge_prompt = RESEARCH_MERGE_PROMPT.format(
        company=company,
        lane_outputs=lane_outputs_text,
    )

    try:
        response = await asyncio.wait_for(
            client.responses.create(
                model=RESEARCH_MODEL,
                instructions=merge_prompt,
                input=f"Merge the research lane outputs for {company} into a unified brief.",
                max_output_tokens=RESEARCH_MERGE_MAX_TOKENS,
            ),
            timeout=RESEARCH_MERGE_TIMEOUT,
        )
        if usage_tracker:
            usage_tracker.record_response(response)

        text = response.output_text
        if not text:
            raise ValueError("Merge returned empty output")

        _p("Stage 2", f"Research merge complete ({len(text):,} chars)")
        return text

    except Exception as e:
        _p("Stage 2", f"WARNING: Merge failed ({e}), using raw concatenation fallback")
        # Fallback: concatenate lane outputs with headers
        return lane_outputs_text


async def run_research_phase(
    company: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
) -> str:
    """
    Phase 2A: Scatter-gather research — launch 6 parallel focused lanes,
    then merge into a unified brief.  Returns the research brief markdown.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Researching (6 parallel lanes)...")

    # Launch all lanes in parallel with an outer timeout
    lane_tasks = [
        run_research_lane(lid, company, usage_tracker, on_progress, start_time)
        for lid in RESEARCH_LANES
    ]

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*lane_tasks, return_exceptions=True),
            timeout=RESEARCH_PHASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"Research phase exceeded {RESEARCH_PHASE_TIMEOUT}s outer timeout"
        )

    # Collect successful results
    lane_results: dict[str, str] = {}
    for result in results:
        if isinstance(result, Exception):
            _p("Stage 2", f"WARNING: A research lane raised: {result}")
            continue
        lane_id, text = result
        if text:
            lane_results[lane_id] = text

    succeeded = len(lane_results)
    total = len(RESEARCH_LANES)
    _p("Stage 2", f"Research lanes complete: {succeeded}/{total} succeeded")

    if succeeded < RESEARCH_MIN_LANES_REQUIRED:
        raise RuntimeError(
            f"Only {succeeded}/{total} research lanes succeeded "
            f"(minimum {RESEARCH_MIN_LANES_REQUIRED} required)"
        )

    # Merge lane outputs into unified brief
    brief = await merge_research_lanes(
        company,
        lane_results,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=start_time,
    )
    _p("Stage 2", f"Research complete ({len(brief):,} chars)")
    return brief


async def run_section_group(
    group_id: str,
    company: str,
    research_brief: str,
    sections: list[int],
    templates: dict[int, str],
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
) -> tuple[str, str]:
    """
    Phase 2B: Write one group of sections using GPT-5-mini (no web search).

    Returns (group_id, section_text).
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    label = SECTION_GROUPS[group_id]["label"]

    system_prompt, user_prompt = section_group_prompt(
        company, research_brief, sections, templates
    )

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.responses.create(
                    model=SECTION_WRITE_MODEL,
                    instructions=system_prompt,
                    input=user_prompt,
                    max_output_tokens=SECTION_WRITE_MAX_TOKENS,
                ),
                timeout=SECTION_WRITE_TIMEOUT,
            )
            if usage_tracker:
                usage_tracker.record_response(response)

            text = response.output_text
            if not text:
                raise ValueError(f"Section group {group_id} returned empty output")

            section_range = f"{min(sections)}-{max(sections)}"
            _p("Stage 2", f"Phase 2/3: Group {group_id} complete (Sections {section_range})")
            return group_id, text

        except Exception as e:
            if attempt < MAX_RETRIES:
                _p("Stage 2", f"Group {group_id} ({label}) attempt {attempt + 1} failed: {e}. Retrying...")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            else:
                _p("Stage 2", f"WARNING: Group {group_id} ({label}) failed: {e}")
                return group_id, ""


async def run_bookend_phase(
    company: str,
    research_brief: str,
    prior_sections_text: str,
    templates: dict[int, str],
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
) -> str:
    """
    Phase 2C: Write bookend sections (0, 12, 13) using GPT-5-mini.
    These need all prior sections as context.

    Returns the bookend section text.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Phase 3/3: Writing executive summary and verdict...")

    system_prompt, user_prompt = bookend_prompt(
        company, research_brief, prior_sections_text, templates
    )

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.responses.create(
                    model=BOOKEND_MODEL,
                    instructions=system_prompt,
                    input=user_prompt,
                    max_output_tokens=BOOKEND_MAX_TOKENS,
                ),
                timeout=BOOKEND_TIMEOUT,
            )
            if usage_tracker:
                usage_tracker.record_response(response)

            text = response.output_text
            if not text:
                raise ValueError("Bookend phase returned empty output")

            _p("Stage 2", f"Bookend complete ({len(text):,} chars)")
            return text

        except Exception as e:
            if attempt < MAX_RETRIES:
                _p("Stage 2", f"Bookend attempt {attempt + 1} failed: {e}. Retrying...")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            else:
                # Fallback: generate minimal Section 0 from research brief
                _p("Stage 2", f"WARNING: Bookend failed: {e}. Using minimal fallback.")
                return (
                    f"## Section 0: Executive Summary\n\n"
                    f"*Auto-generated fallback — bookend generation failed.*\n\n"
                    f"{research_brief[:3000]}\n"
                )


async def run_fact_first_diligence_deep_dive(
    company: str,
    research_brief: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
    model_caller=None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Generate strict fact-first diligence deep dive output:
      - PART A markdown narrative
      - PART B claims ledger JSON (parsed/validated to Python list)
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Phase 2/2: Writing fact-first diligence memo + claims ledger...")

    deal_detected = detect_deal_signal(research_brief)
    system_prompt, user_prompt = fact_first_diligence_prompt(company, research_brief)
    fact_first_cache_key = _build_prompt_cache_key(
        stage="stage2-fact-first",
        model=SECTION_WRITE_MODEL,
        company=company,
        variant="writer",
        prompt_version="v1",
    )

    async def _default_model_caller(instructions: str, input_text: str) -> str:
        response = await _create_response(
            model=SECTION_WRITE_MODEL,
            instructions=instructions,
            input_text=input_text,
            max_output_tokens=FACT_FIRST_DILIGENCE_MAX_TOKENS,
            timeout_seconds=SECTION_WRITE_TIMEOUT,
            usage_tracker=usage_tracker,
            cache_key=fact_first_cache_key,
        )
        return response.output_text or ""

    _call_model = model_caller or _default_model_caller
    raw_output = (await _call_model(system_prompt, user_prompt)).strip()
    if not raw_output:
        raise RuntimeError("Fact-first diligence writer returned empty output")

    async def _validate_with_repair(output_text: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
        part_a_local, claims_ledger_local, claims_meta_local = parse_and_validate_stage2_output(
            output_text,
            deal_detected=deal_detected,
        )
        if not part_a_local.strip():
            raise RuntimeError("PART A narrative was empty after parsing")

        if claims_meta_local.get("valid", False):
            claims_meta_local["repair_used"] = False
            return part_a_local, claims_ledger_local, claims_meta_local

        _p("Stage 2", "Claims ledger validation failed. Running one repair pass...")

        async def _repair_ledger_json(meta: dict[str, Any]) -> str:
            repair_instructions = (
                "Return ONLY PART B JSON array conforming to schema; do not include markdown."
            )
            repair_input = (
                "Repair the PART B Claims Ledger JSON array only.\n\n"
                f"Parse errors:\n{json.dumps(meta.get('parse_errors', []), indent=2)}\n\n"
                "Required schema keys per object:\n"
                "claim_type, metric, value, unit, timeframe, statement, confidence, source_type, source_citation, notes\n"
                f"\nOriginal Stage-2 output:\n{output_text}"
            )
            return await _call_model(repair_instructions, repair_input)

        return await validate_stage2_with_repair(
            output_text,
            deal_detected=deal_detected,
            repair_ledger_json_fn=_repair_ledger_json,
        )

    part_a, claims_ledger, claims_meta = await _validate_with_repair(raw_output)

    quality_stats = _deep_dive_quality_stats(part_a)
    if not quality_stats["section_check_passed"]:
        _p("Stage 2", "Deep dive below depth targets. Running one expansion pass...")
        expansion_instructions = (
            "You are revising a Stage-2 deep dive. Increase depth and section completeness while preserving factual discipline. "
            "Return full output with PART A markdown and PART B JSON claims ledger."
        )
        expansion_input = (
            f"Company: {company}\n\n"
            f"Depth targets:\n- Minimum characters in PART A: {DEEP_DIVE_MIN_CHARS}\n"
            f"- Minimum H2 sections in PART A: {DEEP_DIVE_MIN_H2}\n\n"
            "Keep source envelopes and no-fabrication constraints.\n\n"
            f"Current Stage-2 output:\n{raw_output}\n\n"
            "Rewrite and expand PART A where shallow; keep PART B valid JSON."
        )
        expanded_output = (await _call_model(expansion_instructions, expansion_input)).strip()
        if expanded_output:
            part_a, claims_ledger, claims_meta = await _validate_with_repair(expanded_output)
            quality_stats = _deep_dive_quality_stats(part_a)
            claims_meta["quality_retry_used"] = True
        else:
            claims_meta["quality_retry_used"] = False
    else:
        claims_meta["quality_retry_used"] = False

    claims_meta["output_quality_meta"] = quality_stats

    _p("Stage 2", f"Fact-first diligence deep dive complete ({len(part_a):,} chars)")
    return part_a, claims_ledger, claims_meta


async def run_deep_dive(
    prepared_template: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
    company_name: str = "",
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Orchestrate Stage 2 deep-dive generation.

    FACT_FIRST_DILIGENCE_ENABLED=True:
      2A. Research (parallel web-search lanes + merge)
      2B. Fact-first diligence writer (PART A narrative + PART B claims ledger)

    Else: legacy 3-phase deep dive path.

    Returns:
      (deep_dive_markdown, claims_ledger, claims_ledger_meta)
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Starting deep dive analysis...")

    mode = DEEP_DIVE_OUTPUT_MODE
    use_legacy_mode = mode.startswith("legacy")
    use_fact_first_mode = mode.startswith("fact_first")

    if use_fact_first_mode and FACT_FIRST_DILIGENCE_ENABLED:
        research_brief = await run_research_phase(
            company_name,
            usage_tracker=usage_tracker,
            on_progress=on_progress,
            start_time=start_time,
        )
        deep_dive, claims_ledger, claims_meta = await run_fact_first_diligence_deep_dive(
            company=company_name,
            research_brief=research_brief,
            usage_tracker=usage_tracker,
            on_progress=on_progress,
            start_time=start_time,
        )
        _p("Stage 2", f"Deep dive complete ({len(deep_dive):,} characters)")
        claims_meta["output_mode"] = mode
        return deep_dive, claims_ledger, claims_meta

    if (not use_legacy_mode) and FACT_FIRST_DILIGENCE_ENABLED and not use_fact_first_mode:
        # Backward-compatible default when mode is unknown and fact-first is enabled.
        research_brief = await run_research_phase(
            company_name,
            usage_tracker=usage_tracker,
            on_progress=on_progress,
            start_time=start_time,
        )
        deep_dive, claims_ledger, claims_meta = await run_fact_first_diligence_deep_dive(
            company=company_name,
            research_brief=research_brief,
            usage_tracker=usage_tracker,
            on_progress=on_progress,
            start_time=start_time,
        )
        _p("Stage 2", f"Deep dive complete ({len(deep_dive):,} characters)")
        claims_meta["output_mode"] = "fact_first_fallback"
        return deep_dive, claims_ledger, claims_meta

    # Load section templates from the due diligence prompt
    templates = load_template_sections()

    # --- Phase 2A: Research ---
    research_brief = await run_research_phase(
        company_name,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=start_time,
    )

    # --- Phase 2B: Parallel section writes ---
    _p("Stage 2", "Phase 2/3: Writing sections in parallel (4 groups)...")

    group_tasks = []
    for gid, ginfo in SECTION_GROUPS.items():
        group_tasks.append(
            run_section_group(
                gid, company_name, research_brief,
                ginfo["sections"], templates,
                usage_tracker=usage_tracker,
                on_progress=on_progress,
                start_time=start_time,
            )
        )
    group_results = await asyncio.gather(*group_tasks, return_exceptions=True)

    # Collect results ordered by group, then concatenate sections in order
    group_texts: dict[str, str] = {}
    for result in group_results:
        if isinstance(result, Exception):
            log.error("Section group failed with exception: %s", result)
            continue
        gid, text = result
        group_texts[gid] = text

    # Concatenate sections 1-11 in order (groups A, B, C, D)
    prior_sections_parts = []
    for gid in ["A", "B", "C", "D"]:
        if group_texts.get(gid):
            prior_sections_parts.append(group_texts[gid])

    prior_sections_text = "\n\n".join(prior_sections_parts)

    # --- Phase 2C: Bookend sections ---
    bookend_text = await run_bookend_phase(
        company_name, research_brief, prior_sections_text,
        templates,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=start_time,
    )

    # --- Assemble final report: Section 0, then 1-11, then 12-13 ---
    # The bookend text contains Sections 0, 12, 13.
    # We need to split Section 0 from Sections 12-13 for proper ordering.
    section_0_match = re.search(
        r"(## Section 0:.*?)(?=\n## Section 1[2-3]:|\Z)",
        bookend_text, re.DOTALL,
    )
    sections_12_13_match = re.search(
        r"(## Section 12:.*)",
        bookend_text, re.DOTALL,
    )

    section_0_text = section_0_match.group(1).rstrip() if section_0_match else ""
    sections_12_13_text = sections_12_13_match.group(1).rstrip() if sections_12_13_match else ""

    final_parts = []
    if section_0_text:
        final_parts.append(section_0_text)
    if prior_sections_text:
        final_parts.append(prior_sections_text)
    if sections_12_13_text:
        final_parts.append(sections_12_13_text)

    full_report = "\n\n---\n\n".join(final_parts)

    _p("Stage 2", f"Deep dive complete ({len(full_report):,} characters)")
    legacy_meta = {
        "valid": True,
        "not_applicable": True,
        "parse_errors": [],
        "normalization_notes": [],
        "claim_count": 0,
        "raw_json_extracted": False,
        "output_mode": mode,
        "output_quality_meta": _deep_dive_quality_stats(full_report),
    }
    return full_report, [], legacy_meta


# ---------------------------------------------------------------------------
# Stage 3: Persona Evaluation
# ---------------------------------------------------------------------------
async def run_single_persona(
    persona: dict,
    deep_dive: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
    company_name: str = "",
) -> tuple[str, str | None]:
    """
    Run a single persona evaluation.

    Args:
        persona: Dict with id, name, label, file keys
        deep_dive: The full deep dive report text

    Returns:
        (persona_id, output_text or None if failed)
    """
    persona_id = persona["id"]
    persona_name = persona["name"]
    persona_file: Path = persona["file"]

    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 3", f"Starting {persona_name} evaluation...")

    try:
        system_prompt = persona_file.read_text(encoding="utf-8")
    except FileNotFoundError:
        _p("Stage 3", f"ERROR: Persona file not found: {persona_file}")
        return persona_id, None
    persona_cache_key = _build_prompt_cache_key(
        stage="stage3-persona",
        model=PERSONA_MODEL,
        company=company_name,
        variant=persona_id,
        prompt_version="v1",
    )

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await _create_response(
                model=PERSONA_MODEL,
                instructions=system_prompt,
                input_text=deep_dive,
                max_output_tokens=PERSONA_MAX_TOKENS,
                timeout_seconds=PERSONA_TIMEOUT,
                usage_tracker=usage_tracker,
                cache_key=persona_cache_key,
            )

            text = response.output_text
            if not text:
                raise ValueError(f"{persona_name} returned empty output")

            _p("Stage 3", f"{persona_name} complete ({len(text):,} chars)")
            return persona_id, text

        except Exception as e:
            if attempt < MAX_RETRIES:
                _p(
                    "Stage 3",
                    f"{persona_name} attempt {attempt + 1} failed: {e}. Retrying...",
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            else:
                _p("Stage 3", f"ERROR: {persona_name} failed: {e}")
                return persona_id, None


async def run_personas(
    deep_dive: str,
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
    company_name: str = "",
) -> dict[str, str | None]:
    """
    Run all persona evaluations in parallel.

    Returns dict of persona_id -> output_text (or None if failed).
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 3", "Launching 3 persona evaluations in parallel...")

    tasks = [
        run_single_persona(
            p,
            deep_dive,
            usage_tracker,
            on_progress,
            start_time,
            company_name=company_name,
        )
        for p in PERSONAS
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    persona_outputs: dict[str, str | None] = {}
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            persona_id = PERSONAS[i]["id"]
            log.error("Persona %s failed with exception: %s", persona_id, result)
            persona_outputs[persona_id] = None
        else:
            persona_id, output = result
            persona_outputs[persona_id] = output

    available = sum(1 for v in persona_outputs.values() if v is not None)
    _p("Stage 3", f"Personas complete: {available}/{len(PERSONAS)} available")

    return persona_outputs


# ---------------------------------------------------------------------------
# Stage 4: Synthesis
# ---------------------------------------------------------------------------
async def run_synthesis(
    executive_summary: str,
    persona_outputs: dict[str, str | None],
    usage_tracker: UsageTracker | None = None,
    on_progress=None,
    start_time=None,
    company_name: str = "",
) -> str | None:
    """
    Run the synthesis model to arbitrate across persona evaluations.

    Receives the executive summary (not full deep dive) plus all persona outputs.

    Returns synthesis markdown or None if failed.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    available = {k: v for k, v in persona_outputs.items() if v is not None}
    if len(available) < 2:
        _p("Stage 4", "Skipping synthesis — fewer than 2 personas available")
        return None

    _p("Stage 4", "Starting synthesis...")

    try:
        synthesis_system = SYNTHESIS_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        _p("Stage 4", "ERROR: Synthesis prompt file not found")
        return None

    # Build the user message with executive summary + all persona outputs
    persona_name_map = {p["id"]: p["name"] for p in PERSONAS}
    user_parts = [
        "# Executive Summary (from deep dive report)\n",
        executive_summary,
        "\n\n---\n\n",
        "# Persona Evaluations\n",
    ]
    for pid, output in available.items():
        name = persona_name_map.get(pid, pid)
        user_parts.append(f"\n## {name}\n\n{output}\n\n---\n")

    user_message = "".join(user_parts)
    synthesis_cache_key = _build_prompt_cache_key(
        stage="stage4-synthesis",
        model=SYNTHESIS_MODEL,
        company=company_name,
        variant="consensus",
        prompt_version="v1",
    )

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await _create_response(
                model=SYNTHESIS_MODEL,
                instructions=synthesis_system,
                input_text=user_message,
                max_output_tokens=SYNTHESIS_MAX_TOKENS,
                timeout_seconds=SYNTHESIS_TIMEOUT,
                usage_tracker=usage_tracker,
                cache_key=synthesis_cache_key,
            )

            text = response.output_text
            if not text:
                raise ValueError("Synthesis returned empty output")

            _p("Stage 4", f"Synthesis complete ({len(text):,} chars)")
            return text

        except Exception as e:
            if attempt < MAX_RETRIES:
                _p(
                    "Stage 4", f"Attempt {attempt + 1} failed: {e}. Retrying..."
                )
                await asyncio.sleep(RETRY_DELAY_SECONDS)
            else:
                _p("Stage 4", f"ERROR: Synthesis failed: {e}")
                return None


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------
async def run_pipeline(
    raw_input: str,
    on_progress=None,
    on_section=None,
    return_usage: bool = False,
) -> Path | tuple[Path, dict[str, Any]]:
    """
    Execute the full TriView Capital analysis pipeline.

    Args:
        raw_input: User-provided ticker or company name
        on_progress: Optional callback(stage_id, status, detail) for web UI
        on_section: Optional callback(section_name, content, extra_data) for streaming partial results

    Returns:
        Path to the saved report file, or (path, run_metadata) when return_usage=True
    """
    pipeline_start = time.time()
    usage_tracker = UsageTracker()
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=pipeline_start)

    # ---- Stage 1: Intake ----
    _p("Stage 1", "Processing input...")
    intake = run_intake(raw_input)
    ticker = intake["ticker"]
    company_name = intake["company_name"]
    template_hash = intake["template_hash"]
    prepared_template = intake["prepared_template"]
    _p("Stage 1", f"Resolved: {company_name} ({ticker})")
    if on_progress:
        on_progress("Stage 1", "complete", f"Resolved: {company_name} ({ticker})")

    # ---- Stage 2: Deep Dive ----
    if on_progress:
        on_progress("Stage 2", "running", "Starting deep dive analysis...")
    deep_dive, claims_ledger, claims_ledger_meta = await run_deep_dive(
        prepared_template,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=pipeline_start,
        company_name=company_name,
    )

    async def _institutional_model_call(system_prompt: str, user_prompt: str) -> str:
        response = await asyncio.wait_for(
            client.responses.create(
                model=INSTITUTIONAL_LAYER_MODEL,
                instructions=system_prompt,
                input=user_prompt,
                max_output_tokens=INSTITUTIONAL_LAYER_MAX_TOKENS,
            ),
            timeout=SECTION_WRITE_TIMEOUT,
        )
        if usage_tracker:
            usage_tracker.record_response(response)
        return response.output_text or ""

    apply_addendum = "addendum" in DEEP_DIVE_OUTPUT_MODE
    if apply_addendum:
        _p("Stage 2", "Applying institutional intelligence addendum...")
        deep_dive, institutional_layer_meta = await apply_institutional_layer(
            company=company_name,
            deep_dive_markdown=deep_dive,
            model_call=_institutional_model_call,
            append_only=True,
        )
        if institutional_layer_meta.get("blocked_new_numbers"):
            _p(
                "Stage 2",
                f"Institutional addendum blocked new numbers ({institutional_layer_meta.get('new_number_count', 0)}). Base memo kept.",
            )
        elif institutional_layer_meta.get("applied"):
            _p("Stage 2", "Institutional addendum applied.")
        else:
            _p("Stage 2", "Institutional addendum skipped.")
    else:
        institutional_layer_meta = {
            "applied": False,
            "retry_used": False,
            "blocked_new_numbers": False,
            "new_number_count": 0,
            "mode": "disabled",
        }
        _p("Stage 2", "Institutional addendum disabled by output mode.")

    if on_progress:
        on_progress("Stage 2", "complete", f"Deep dive complete ({len(deep_dive):,} chars)")
    if on_section:
        on_section("deep_dive", deep_dive)

    # ---- Stage 3: Personas (parallel) ----
    if on_progress:
        on_progress("Stage 3", "running", "Launching persona evaluations...")
    persona_outputs = await run_personas(
        deep_dive,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=pipeline_start,
        company_name=company_name,
    )
    if on_progress:
        available = sum(1 for v in persona_outputs.values() if v is not None)
        on_progress("Stage 3", "complete", f"{available}/{len(persona_outputs)} personas complete")
    if on_section:
        # Format persona outputs the same way assembly.py does
        formatted_personas = PERSONA_SPLIT_MARKER.join(
            output for output in persona_outputs.values() if output is not None
        )
        on_section("perspectives", formatted_personas, {"persona_outputs": persona_outputs})

    # ---- Stage 4: Synthesis ----
    if on_progress:
        on_progress("Stage 4", "running", "Starting synthesis...")
    executive_summary = extract_executive_summary(deep_dive)
    synthesis = await run_synthesis(
        executive_summary,
        persona_outputs,
        usage_tracker=usage_tracker,
        on_progress=on_progress,
        start_time=pipeline_start,
        company_name=company_name,
    )
    if on_progress:
        on_progress("Stage 4", "complete", "Synthesis complete")
    if on_section and synthesis:
        on_section("synthesis", synthesis)

    # ---- Stage 5: Assembly ----
    if on_progress:
        on_progress("Stage 5", "running", "Assembling final report...")
    _p("Stage 5", "Assembling final report...")
    final_report, warnings = assemble_report(
        ticker=ticker,
        company_name=company_name,
        template_hash=template_hash,
        deep_dive=deep_dive,
        persona_outputs=persona_outputs,
        synthesis=synthesis,
    )

    # Save to disk
    filepath = save_report(ticker, final_report)
    _p("Stage 5", f"Report saved: {filepath}")
    if on_progress:
        on_progress("Stage 5", "complete", f"Report saved: {filepath}")

    if warnings:
        _p("Validation", f"{len(warnings)} notice(s):")
        for w in warnings:
            print(f"           - {w}")

    usage_snapshot = usage_tracker.snapshot()
    _p("Usage", f"Estimated OpenAI cost: ${usage_snapshot['total_cost_usd']:.4f}")
    output_quality_meta = _deep_dive_quality_stats(deep_dive)

    if return_usage:
        return filepath, {
            "usage": usage_snapshot,
            "claims_ledger": claims_ledger,
            "claims_ledger_meta": claims_ledger_meta,
            "institutional_layer_meta": institutional_layer_meta,
            "output_quality_meta": output_quality_meta,
        }
    return filepath


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------
_start_time = time.time()


def main():
    global _start_time
    _start_time = time.time()
    if len(sys.argv) < 2:
        print("Usage: python main.py <TICKER_OR_COMPANY_NAME>")
        print("Examples:")
        print('  python main.py AAPL')
        print('  python main.py "Meta Platforms"')
        print('  python main.py NVDA')
        sys.exit(1)

    raw_input = " ".join(sys.argv[1:])

    print()
    print("=" * 60)
    print("  TriView Capital — Investment Intelligence System")
    print("=" * 60)
    print()

    try:
        filepath = asyncio.run(run_pipeline(raw_input))
    except IntakeError as e:
        print(f"\nInput error: {e}")
        sys.exit(1)
    except RuntimeError as e:
        print(f"\nPipeline error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nAnalysis cancelled by user.")
        sys.exit(130)

    print()
    print("=" * 60)
    print(f"  Analysis complete. Report saved to:")
    print(f"  {filepath}")
    print("=" * 60)
    print()


if __name__ == "__main__":
    main()
