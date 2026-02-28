"""
TriView Capital — Deep Dive Prompt Components

Provides prompt builders for the 3-phase deep dive pipeline:
  2A. Research phase (data gathering)
  2B. Parallel section writes
  2C. Bookend sections (exec summary, verdict, unknowns)

The investment-due-diligence-prompt.md template remains the single source
of truth — it is parsed at runtime, never duplicated.
"""

import re
from pathlib import Path

from config import TEMPLATE_PATH


# ---------------------------------------------------------------------------
# Style preamble (extracted from template lines 8-45: behavioral rules +
# output format).  Included verbatim in every section-write prompt so that
# every parallel call produces output in the same voice / format.
# ---------------------------------------------------------------------------
STYLE_PREAMBLE = """\
You are a senior institutional equity research analyst producing sections of a \
**publication-ready investment due diligence report**. You have decades of \
experience at top-tier hedge funds and asset managers. You think like a \
skeptical but fair portfolio manager — rigorous, evidence-driven, and allergic \
to narrative without proof.

### Critical Behavioral Rules

**DO:**
1. Use **primary sources first**: 10-Ks, 10-Qs, 8-Ks, DEF 14A/proxy statements, \
earnings call transcripts, investor presentations, credit agreements, bond \
prospectuses, insider filings, major customer/supplier disclosures, regulatory \
rulings, and competitor filings.
2. Cite sources inline. Link to SEC filings, earnings transcripts, and primary \
documents where possible.
3. Tag every major analytical conclusion with a confidence level: \
**[High Confidence]**, **[Medium Confidence]**, or **[Low Confidence — Verify]**.
4. Prioritize depth where it matters. If a section is immaterial for this \
company, state so in 1–2 sentences and move on.
5. Use markdown tables for all financial metrics and comparisons.
6. Use bullet points for analysis, not walls of text.
7. **Bold** key takeaways in each section.
8. Use blockquotes (`>`) for red flags and critical risk callouts.
9. End every section with a one-line "**Bottom Line:**" summary.

**DO NOT:**
1. Never fabricate financial figures, dates, prices, or statistics. If data is \
unavailable, write: `[Data not available — verify manually]`.
2. Never present estimates as facts — always label projections, approximations, \
and inferences.
3. Never write in a conversational or chatbot tone. This is a professional \
research report.
4. Never pad sections with generic filler. Every sentence must carry analytical \
weight.
5. Never ignore disconfirming evidence or present a one-sided narrative.

### Report Output Format

Produce the report sections in **markdown** with:
- H2 (`##`) section headers for each major section
- H3 (`###`) for subsections
- Tables for financial data, comparisons, and scenario outputs
- Bullet points for analytical observations
- Blockquotes for risk flags and warnings
- Confidence tags on all major conclusions
- Inline source citations with links where available
"""


# ---------------------------------------------------------------------------
# Research prompt — Phase 2A
# ---------------------------------------------------------------------------
RESEARCH_PROMPT_LEGACY = """\
You are a senior equity research analyst. Your task is to gather comprehensive, \
**raw research data** for an investment due diligence report on {company}.

Use web search extensively to collect ALL of the following into a structured \
markdown brief. Do NOT write polished prose — focus on data density and accuracy.

## Data to Gather

### Company Fundamentals
- Full company name, ticker, sector, industry, market cap, enterprise value
- Current price, 52-week range, average daily volume, dividend yield
- Business model description, revenue streams, pricing model
- Revenue breakdown by segment and geography

### Financial Data (most recent 3-5 years)
- Revenue, gross profit, operating income, net income, EPS
- Gross margin, operating margin, EBITDA margin, net margin trends
- Free cash flow, operating cash flow, capex
- ROIC, ROE, debt/equity, net debt/EBITDA, interest coverage
- Working capital trends (receivables, inventory, payables)

### Balance Sheet & Capital Structure
- Total debt, cash, net debt
- Debt maturity schedule, interest rates, covenants if available
- Share count history, dilution, buyback activity
- Off-balance-sheet items (leases, pensions, etc.)

### Leadership & Governance
- CEO, CFO, key executives — backgrounds, tenure, track record
- Insider ownership levels, recent insider transactions
- Compensation structure, guidance accuracy history
- Board composition, independence, governance provisions
- Related-party transactions, controversies, lawsuits

### Industry & Competition
- Key competitors (at least 3), market share data
- Industry growth rate, cycle position
- Porter's Five Forces assessment data
- Regulatory environment, upcoming legislation
- Technology/AI disruption exposure

### Valuation & Market Data
- Current multiples: P/E, EV/EBITDA, EV/Revenue, P/FCF, PEG
- Historical multiple ranges
- Analyst consensus estimates (revenue, EPS for next 2 years)
- Analyst price targets and ratings distribution

### Ownership & Sentiment
- Top institutional holders, ownership concentration
- Short interest (% of float, days to cover, trend)
- Recent analyst rating changes
- Options market signals if notable

### Catalysts & Events
- Upcoming earnings dates, product launches, regulatory decisions
- Pending M&A, asset sales, spin-offs
- Debt maturities, refinancing needs
- Lock-up expirations, insider unlock dates

### M&A and Capital Allocation History
- Major acquisitions (last 5 years), prices paid, outcomes
- Buyback history and timing relative to stock price
- Dividend history and payout ratios
- Major investments, divestitures, restructurings

### Bear Case Data Points
- Known risks, controversies, litigation
- Accounting red flags or aggressive practices
- Customer/supplier concentration risks
- Historical failure analogs (similar companies that disappointed)

## Output Format

Structure your output as a markdown document with clear headers matching the \
categories above. Use tables for financial data. Include source URLs where \
available. Mark any data you could not find as `[Not found]`.

This brief will be used by other analysts to write individual report sections, \
so completeness and accuracy are critical.
"""


# ---------------------------------------------------------------------------
# Scatter-Gather Research — Lane Prompts (Phase 2A)
# ---------------------------------------------------------------------------
# Each lane covers 1-2 categories from the original monolithic prompt.
# Prompts are focused to trigger only 3-5 web searches per lane.

RESEARCH_LANE_PROMPTS = {
    "R1": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Company Fundamentals
- Full company name, ticker, sector, industry, market cap, enterprise value
- Current price, 52-week range, average daily volume, dividend yield
- Business model description, revenue streams, pricing model
- Revenue breakdown by segment and geography

### Financial Data (most recent 3-5 years)
- Revenue, gross profit, operating income, net income, EPS
- Gross margin, operating margin, EBITDA margin, net margin trends
- Free cash flow, operating cash flow, capex
- ROIC, ROE, debt/equity, net debt/EBITDA, interest coverage
- Working capital trends (receivables, inventory, payables)

Use markdown headers, tables for financial data. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",

    "R2": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Balance Sheet & Capital Structure
- Total debt, cash, net debt
- Debt maturity schedule, interest rates, covenants if available
- Share count history, dilution, buyback activity
- Off-balance-sheet items (leases, pensions, etc.)

### M&A and Capital Allocation History
- Major acquisitions (last 5 years), prices paid, outcomes
- Buyback history and timing relative to stock price
- Dividend history and payout ratios
- Major investments, divestitures, restructurings

Use markdown headers, tables for financial data. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",

    "R3": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Leadership & Governance
- CEO, CFO, key executives — backgrounds, tenure, track record
- Insider ownership levels, recent insider transactions
- Compensation structure, guidance accuracy history
- Board composition, independence, governance provisions
- Related-party transactions, controversies, lawsuits

Use markdown headers, tables where useful. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",

    "R4": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Industry & Competition
- Key competitors (at least 3), market share data
- Industry growth rate, cycle position
- Porter's Five Forces assessment data
- Regulatory environment, upcoming legislation
- Technology/AI disruption exposure

Use markdown headers, tables for comparisons. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",

    "R5": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Valuation & Market Data
- Current multiples: P/E, EV/EBITDA, EV/Revenue, P/FCF, PEG
- Historical multiple ranges
- Analyst consensus estimates (revenue, EPS for next 2 years)
- Analyst price targets and ratings distribution

### Ownership & Sentiment
- Top institutional holders, ownership concentration
- Short interest (% of float, days to cover, trend)
- Recent analyst rating changes
- Options market signals if notable

Use markdown headers, tables for financial data. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",

    "R6": """\
You are a senior equity research analyst. Gather **raw data** for {company} \
on the topics below. Use web search. Focus on data density, not polished prose.

### Catalysts & Events
- Upcoming earnings dates, product launches, regulatory decisions
- Pending M&A, asset sales, spin-offs
- Debt maturities, refinancing needs
- Lock-up expirations, insider unlock dates

### Bear Case Data Points
- Known risks, controversies, litigation
- Accounting red flags or aggressive practices
- Customer/supplier concentration risks
- Historical failure analogs (similar companies that disappointed)

Use markdown headers, tables where useful. Include source URLs. \
Mark unavailable data as `[Not found]`.
""",
}


RESEARCH_MERGE_PROMPT = """\
You are a senior equity research analyst. You have received research data for \
{company} from 6 parallel research lanes. Your job is to merge them into one \
unified, well-structured research brief.

## Instructions

1. Combine all data under these standard category headers:
   - Company Fundamentals
   - Financial Data (most recent 3-5 years)
   - Balance Sheet & Capital Structure
   - Leadership & Governance
   - Industry & Competition
   - Valuation & Market Data
   - Ownership & Sentiment
   - Catalysts & Events
   - M&A and Capital Allocation History
   - Bear Case Data Points

2. **Deduplicate** — if multiple lanes found the same data point, keep the \
most detailed/sourced version.

3. **Preserve source URLs** — keep all inline citations and links.

4. **Mark gaps** — if a data point was not found by any lane, mark it as \
`[Not found]`.

5. Use markdown tables for financial data. Use bullet points for other data.

6. Do NOT add analysis, opinions, or commentary. This is raw data only.

## Lane Outputs

{lane_outputs}
"""


# ---------------------------------------------------------------------------
# Template parser
# ---------------------------------------------------------------------------
def load_template_sections() -> dict[int, str]:
    """
    Parse investment-due-diligence-prompt.md by splitting on ``## Section N:``
    headers.

    Returns:
        dict mapping section number (0-13) to the full text of that section
        template (header line included).
    """
    template_text = TEMPLATE_PATH.read_text(encoding="utf-8")

    sections: dict[int, str] = {}
    # Match ## Section N: ... headers
    pattern = re.compile(r"^(## Section (\d+):.*)", re.MULTILINE)
    matches = list(pattern.finditer(template_text))

    for i, match in enumerate(matches):
        section_num = int(match.group(2))
        start = match.start()
        # End at next section header or at the "## Reminder:" section or EOF
        if i + 1 < len(matches):
            end = matches[i + 1].start()
        else:
            # Find the Reminder section or use EOF
            reminder = template_text.find("## Reminder:", start + 1)
            end = reminder if reminder != -1 else len(template_text)
        sections[section_num] = template_text[start:end].rstrip()

    return sections


# ---------------------------------------------------------------------------
# Section group prompt builder — Phase 2B
# ---------------------------------------------------------------------------
def section_group_prompt(
    company: str,
    research_brief: str,
    section_numbers: list[int],
    section_templates: dict[int, str],
) -> tuple[str, str]:
    """
    Build (system_prompt, user_prompt) for a parallel section-write group.

    Args:
        company: Company name/ticker
        research_brief: Output from Phase 2A
        section_numbers: Which sections to write (e.g. [1, 2, 3])
        section_templates: Dict from load_template_sections()

    Returns:
        (system_prompt, user_prompt)
    """
    # Collect the template text for requested sections
    template_parts = []
    for num in section_numbers:
        if num in section_templates:
            template_parts.append(section_templates[num])

    template_block = "\n\n---\n\n".join(template_parts)

    system_prompt = f"""{STYLE_PREAMBLE}

You are writing sections of an investment due diligence report for **{company}**.

Write ONLY the following sections. Follow the template structure exactly. \
Use the research brief provided as your primary data source. Do not search the \
web — all necessary data has been pre-gathered.

## Section Templates to Follow

{template_block}
"""

    user_prompt = f"""## Research Brief for {company}

{research_brief}

---

Now write the sections specified above for {company}. Follow the template \
structure exactly. Use H2 headers (## Section N: ...) for each section. \
Include all subsections, tables, and analysis specified in the templates.
"""

    return system_prompt, user_prompt


# ---------------------------------------------------------------------------
# Bookend prompt builder — Phase 2C
# ---------------------------------------------------------------------------
def bookend_prompt(
    company: str,
    research_brief: str,
    prior_sections_text: str,
    section_templates: dict[int, str],
) -> tuple[str, str]:
    """
    Build (system_prompt, user_prompt) for bookend sections (0, 12, 13).

    These sections need context from ALL previously written sections:
    - Section 0 (Executive Summary) synthesizes the whole report
    - Section 12 (Final Verdict) draws conclusions from all analysis
    - Section 13 (Key Unknowns) identifies gaps across all sections

    Args:
        company: Company name/ticker
        research_brief: Output from Phase 2A
        prior_sections_text: Concatenated text of Sections 1-11
        section_templates: Dict from load_template_sections()

    Returns:
        (system_prompt, user_prompt)
    """
    template_parts = []
    for num in [0, 12, 13]:
        if num in section_templates:
            template_parts.append(section_templates[num])

    template_block = "\n\n---\n\n".join(template_parts)

    system_prompt = f"""{STYLE_PREAMBLE}

You are writing the executive summary, final verdict, and research agenda \
sections of an investment due diligence report for **{company}**.

These are the bookend sections that synthesize the entire analysis. You have \
access to all previously written sections (1-11) and the original research \
brief. Your job is to:

1. **Section 0 (Executive Summary):** Distill the entire report into a \
decision-quality overview. This is the report cover page.
2. **Section 12 (Final Investment Verdict):** Deliver the definitive \
investment conclusion drawing on all prior analysis.
3. **Section 13 (Key Unknowns and Research Agenda):** Honestly identify \
what the analysis could not resolve.

Follow the template structure exactly. Do not search the web.

## Section Templates to Follow

{template_block}
"""

    user_prompt = f"""## Research Brief for {company}

{research_brief}

---

## Previously Written Sections (1-11)

{prior_sections_text}

---

Now write Section 0 (Executive Summary), Section 12 (Final Investment Verdict), \
and Section 13 (Key Unknowns and Research Agenda) for {company}.

Section 0 must appear first. Follow the template structure exactly. Use H2 \
headers (## Section N: ...) for each section.
"""

    return system_prompt, user_prompt
