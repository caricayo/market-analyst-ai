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
import re
import sys
import time
from pathlib import Path

from openai import AsyncOpenAI

from config import (
    OPENAI_API_KEY,
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
)
from intake import run_intake, IntakeError
from assembly import (
    assemble_report,
    save_report,
    extract_executive_summary,
)
from deep_dive_prompts import (
    RESEARCH_LANE_PROMPTS,
    RESEARCH_MERGE_PROMPT,
    load_template_sections,
    section_group_prompt,
    bookend_prompt,
)


# ---------------------------------------------------------------------------
# OpenAI Client
# ---------------------------------------------------------------------------
client = AsyncOpenAI(api_key=OPENAI_API_KEY)


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
    company: str, on_progress=None, start_time=None
) -> str:
    """
    Phase 2A: Scatter-gather research — launch 6 parallel focused lanes,
    then merge into a unified brief.  Returns the research brief markdown.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Phase 1/3: Researching (6 parallel lanes)...")

    # Launch all lanes in parallel with an outer timeout
    lane_tasks = [
        run_research_lane(lid, company, on_progress, start_time)
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
    brief = await merge_research_lanes(company, lane_results, on_progress, start_time)
    _p("Stage 2", f"Research complete ({len(brief):,} chars)")
    return brief


async def run_section_group(
    group_id: str,
    company: str,
    research_brief: str,
    sections: list[int],
    templates: dict[int, str],
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


async def run_deep_dive(
    prepared_template: str,
    on_progress=None,
    start_time=None,
    company_name: str = "",
) -> str:
    """
    Orchestrate the 3-phase deep dive pipeline:
      2A. Research (GPT-5 + web search)
      2B. Parallel section writes (4 groups, GPT-5-mini)
      2C. Bookend sections 0,12,13 (GPT-5-mini)

    Returns the full concatenated deep dive report.
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 2", "Starting deep dive analysis (3-phase pipeline)...")

    # Load section templates from the due diligence prompt
    templates = load_template_sections()

    # --- Phase 2A: Research ---
    research_brief = await run_research_phase(company_name, on_progress, start_time)

    # --- Phase 2B: Parallel section writes ---
    _p("Stage 2", "Phase 2/3: Writing sections in parallel (4 groups)...")

    group_tasks = []
    for gid, ginfo in SECTION_GROUPS.items():
        group_tasks.append(
            run_section_group(
                gid, company_name, research_brief,
                ginfo["sections"], templates,
                on_progress, start_time,
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
        templates, on_progress, start_time,
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
    return full_report


# ---------------------------------------------------------------------------
# Stage 3: Persona Evaluation
# ---------------------------------------------------------------------------
async def run_single_persona(
    persona: dict, deep_dive: str, on_progress=None, start_time=None
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

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.responses.create(
                    model=PERSONA_MODEL,
                    instructions=system_prompt,
                    input=deep_dive,
                    max_output_tokens=PERSONA_MAX_TOKENS,
                ),
                timeout=PERSONA_TIMEOUT,
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


async def run_personas(deep_dive: str, on_progress=None, start_time=None) -> dict[str, str | None]:
    """
    Run all persona evaluations in parallel.

    Returns dict of persona_id -> output_text (or None if failed).
    """
    _p = lambda s, d="": progress(s, d, _on_progress=on_progress, _start=start_time)
    _p("Stage 3", "Launching 3 persona evaluations in parallel...")

    tasks = [run_single_persona(p, deep_dive, on_progress, start_time) for p in PERSONAS]
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
    on_progress=None,
    start_time=None,
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

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                client.responses.create(
                    model=SYNTHESIS_MODEL,
                    instructions=synthesis_system,
                    input=user_message,
                    max_output_tokens=SYNTHESIS_MAX_TOKENS,
                ),
                timeout=SYNTHESIS_TIMEOUT,
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
async def run_pipeline(raw_input: str, on_progress=None, on_section=None) -> Path:
    """
    Execute the full TriView Capital analysis pipeline.

    Args:
        raw_input: User-provided ticker or company name
        on_progress: Optional callback(stage_id, status, detail) for web UI
        on_section: Optional callback(section_name, content, extra_data) for streaming partial results

    Returns:
        Path to the saved report file
    """
    pipeline_start = time.time()
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

    # ---- Stage 2: Deep Dive (3-phase pipeline) ----
    if on_progress:
        on_progress("Stage 2", "running", "Starting deep dive analysis...")
    deep_dive = await run_deep_dive(
        prepared_template, on_progress, pipeline_start, company_name=company_name
    )
    if on_progress:
        on_progress("Stage 2", "complete", f"Deep dive complete ({len(deep_dive):,} chars)")
    if on_section:
        on_section("deep_dive", deep_dive)

    # ---- Stage 3: Personas (parallel) ----
    if on_progress:
        on_progress("Stage 3", "running", "Launching persona evaluations...")
    persona_outputs = await run_personas(deep_dive, on_progress, pipeline_start)
    if on_progress:
        available = sum(1 for v in persona_outputs.values() if v is not None)
        on_progress("Stage 3", "complete", f"{available}/{len(persona_outputs)} personas complete")
    if on_section:
        # Format persona outputs the same way assembly.py does
        formatted_personas = "\n\n---\n\n".join(
            output for output in persona_outputs.values() if output is not None
        )
        on_section("perspectives", formatted_personas, {"persona_outputs": persona_outputs})

    # ---- Stage 4: Synthesis ----
    if on_progress:
        on_progress("Stage 4", "running", "Starting synthesis...")
    executive_summary = extract_executive_summary(deep_dive)
    synthesis = await run_synthesis(executive_summary, persona_outputs, on_progress, pipeline_start)
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
