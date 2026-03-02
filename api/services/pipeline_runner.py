"""
arfor — Pipeline Runner

Wraps run_pipeline() from main.py with event emission to the analysis session.
Saves completed results to Supabase and deducts credits.
"""

import asyncio
import logging
import re
import sys
from pathlib import Path
from dataclasses import asdict
from datetime import datetime, timezone

# Add project root to path so we can import main, config, etc.
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

log = logging.getLogger(__name__)

from main import run_pipeline
from config import PERSONAS
from api.services.event_bus import AnalysisSession
from api.services.persona_parser import parse_persona

PERSONA_SPLIT_MARKER = "<!-- PERSONA_SPLIT -->"

_URL_RE = re.compile(r"https?://[^\s)>\"]+")
_FILING_RE = re.compile(r"\b(10-K|10-Q|8-K|DEF 14A|20-F|6-K|earnings release)\b", re.IGNORECASE)


def _split_report_sections(report_text: str) -> dict[str, str]:
    """Split the assembled report into Part I, Part II, Part III sections."""
    sections = {
        "deep_dive": "",
        "perspectives": "",
        "synthesis": "",
    }

    # Split on "# Part I:", "# Part II:", "# Part III:"
    part1_match = re.search(r"# Part I: Institutional Deep Dive\s*\n(.*?)(?=\n# Part II:|\Z)", report_text, re.DOTALL)
    part2_match = re.search(r"# Part II: Perspective Panel\s*\n(.*?)(?=\n# Part III:|\Z)", report_text, re.DOTALL)
    part3_match = re.search(r"# Part III: Consensus & Disagreement\s*\n(.*?)(?=\n---\n\n## Report Metadata|\Z)", report_text, re.DOTALL)

    if part1_match:
        sections["deep_dive"] = part1_match.group(1).strip()
    if part2_match:
        sections["perspectives"] = part2_match.group(1).strip()
    if part3_match:
        sections["synthesis"] = part3_match.group(1).strip()

    return sections


def _fallback_evidence_summary_from_markdown(deep_dive: str) -> dict[str, int]:
    """Infer evidence counts from markdown when claims ledger is unavailable/degraded."""
    text = deep_dive or ""
    sec_ir_claims = len(re.findall(r"source_type\s*=\s*SEC/IR", text, flags=re.IGNORECASE))
    if sec_ir_claims == 0:
        sec_ir_claims = len(_FILING_RE.findall(text))

    unverified_claims = len(
        re.findall(r"Unverified\s+requires primary filing review\.", text, flags=re.IGNORECASE)
    )
    if unverified_claims == 0:
        unverified_claims = len(re.findall(r"source_citation\s*=\s*unverified", text, flags=re.IGNORECASE))

    unique_urls = set(_URL_RE.findall(text))
    filing_refs = {m.group(0).upper() for m in _FILING_RE.finditer(text)}
    source_count = len(unique_urls.union(filing_refs))

    return {
        "sec_ir_claims": sec_ir_claims,
        "unverified_claims": unverified_claims,
        "source_count": source_count,
    }


async def execute_pipeline(session: AnalysisSession) -> None:
    """Run the pipeline and emit events to the session."""
    try:
        def on_progress(stage: str, status: str, detail: str = "") -> None:
            if session.is_cancelled:
                return
            session.emit_stage(stage, status, detail)

        def on_section(section_name: str, content: str, extra: dict | None = None) -> None:
            if session.is_cancelled:
                return
            session.emit_section(section_name, content, extra)

        # Run the pipeline with a 10-minute global timeout
        filepath, run_meta = await asyncio.wait_for(
            run_pipeline(
                session.ticker,
                on_progress=on_progress,
                on_section=on_section,
                return_usage=True,
            ),
            timeout=600,
        )
        usage = run_meta.get("usage", {}) if isinstance(run_meta, dict) else {}
        claims_ledger = run_meta.get("claims_ledger", []) if isinstance(run_meta, dict) else []
        claims_ledger_meta = run_meta.get("claims_ledger_meta", {}) if isinstance(run_meta, dict) else {}
        institutional_layer_meta = run_meta.get("institutional_layer_meta", {}) if isinstance(run_meta, dict) else {}
        output_quality_meta = run_meta.get("output_quality_meta", {}) if isinstance(run_meta, dict) else {}

        if session.is_cancelled:
            return

        # Read the saved report
        report_text = filepath.read_text(encoding="utf-8")

        # Split into sections
        sections = _split_report_sections(report_text)

        # Parse persona verdicts from the perspectives section
        persona_verdicts = []
        # Re-run persona parsing on the raw persona outputs
        # We need to parse from the perspectives section of the report
        perspectives_text = sections["perspectives"]
        # Split by explicit marker first; fallback to legacy separator for older rows.
        if PERSONA_SPLIT_MARKER in perspectives_text:
            persona_blocks = [b.strip() for b in perspectives_text.split(PERSONA_SPLIT_MARKER) if b.strip()]
        else:
            persona_blocks = [b.strip() for b in re.split(r"\n---\n", perspectives_text) if b.strip()]

        for i, persona_cfg in enumerate(PERSONAS):
            block = persona_blocks[i] if i < len(persona_blocks) else None
            if block and block.startswith(">"):
                # This is an unavailable notice
                block = None
            verdict = parse_persona(
                persona_id=persona_cfg["id"],
                persona_name=persona_cfg["name"],
                persona_label=persona_cfg["label"],
                text=block,
            )
            persona_verdicts.append(asdict(verdict))

        result_data = {
            "ticker": session.ticker,
            "filepath": str(filepath),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sections": sections,
            "persona_verdicts": persona_verdicts,
            "usage": usage,
            "claims_ledger": claims_ledger,
            "claims_ledger_meta": claims_ledger_meta,
            "institutional_layer_meta": institutional_layer_meta,
        }
        sec_ir_claims = sum(
            1 for c in claims_ledger
            if isinstance(c, dict) and c.get("source_type") == "SEC/IR"
        )
        unverified_claims = sum(
            1 for c in claims_ledger
            if isinstance(c, dict)
            and (
                str(c.get("source_citation", "")).strip().lower() == "unverified"
                or c.get("source_type") == "unknown"
            )
        )
        source_count = len({
            str(c.get("source_citation", "")).strip()
            for c in claims_ledger
            if isinstance(c, dict)
            and str(c.get("source_citation", "")).strip()
            and str(c.get("source_citation", "")).strip().lower() != "unverified"
        })

        inferred = False
        if not claims_ledger or (sec_ir_claims == 0 and unverified_claims == 0 and source_count == 0):
            inferred_counts = _fallback_evidence_summary_from_markdown(sections.get("deep_dive", ""))
            sec_ir_claims = max(sec_ir_claims, inferred_counts["sec_ir_claims"])
            unverified_claims = max(unverified_claims, inferred_counts["unverified_claims"])
            source_count = max(source_count, inferred_counts["source_count"])
            inferred = True

        result_data["evidence_summary"] = {
            "sec_ir_claims": sec_ir_claims,
            "unverified_claims": unverified_claims,
            "source_count": source_count,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "inferred": inferred,
        }
        result_data["output_quality_meta"] = output_quality_meta

        # Update analysis record with result (record + credit deducted in analyze.py)
        if session.user_id and hasattr(session, "analysis_db_id"):
            try:
                from api.services.supabase import get_supabase_admin
                sb = get_supabase_admin()
                await sb.from_("analyses").update({
                    "status": "complete",
                    "result": result_data,
                    "cost_usd": usage.get("total_cost_usd", 0.0),
                }).eq("id", session.analysis_db_id).execute()
            except Exception as e:
                log.warning("Failed to update analysis in Supabase: %s", e)

        # Emit completion
        session.emit_complete(result_data)

    except asyncio.CancelledError:
        session.is_cancelled = True
        session.is_complete = True
        # Update DB status and refund credit for cancelled analyses
        if session.user_id and hasattr(session, "analysis_db_id") and session.analysis_db_id:
            try:
                from api.services.supabase import get_supabase_admin
                from api.services.credits import refund_credit
                sb = get_supabase_admin()
                await sb.from_("analyses").update({
                    "status": "cancelled",
                }).eq("id", session.analysis_db_id).execute()
                await refund_credit(session.user_id, session.analysis_db_id)
                log.info("Cancelled analysis %s: updated status and refunded credit", session.analysis_db_id)
            except Exception as cancel_err:
                log.error("Failed to cleanup cancelled analysis %s: %s", session.analysis_db_id, cancel_err)
    except TimeoutError:
        # Pipeline exceeded 10-minute global timeout
        log.error("Pipeline timed out for %s after 600s", session.ticker)
        if session.user_id and hasattr(session, "analysis_db_id"):
            try:
                from api.services.supabase import get_supabase_admin
                from api.services.credits import refund_credit
                sb = get_supabase_admin()
                await sb.from_("analyses").update({
                    "status": "error",
                    "result": {"error": "Analysis timed out after 10 minutes"},
                }).eq("id", session.analysis_db_id).execute()
                await refund_credit(session.user_id, session.analysis_db_id)
            except Exception as refund_err:
                log.error("Failed to refund credit on timeout: %s", refund_err)
        session.emit_error("Analysis timed out. Your credit has been refunded.")
    except Exception as e:
        # Update analysis record to error status and refund credit
        if session.user_id and hasattr(session, "analysis_db_id"):
            try:
                from api.services.supabase import get_supabase_admin
                from api.services.credits import refund_credit
                sb = get_supabase_admin()
                await sb.from_("analyses").update({
                    "status": "error",
                    "result": {"error": str(e)},
                }).eq("id", session.analysis_db_id).execute()
                await refund_credit(session.user_id, session.analysis_db_id)
            except Exception as refund_err:
                log.error("Failed to refund credit on error: %s", refund_err)
        session.emit_error(str(e))
