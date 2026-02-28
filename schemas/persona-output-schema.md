# Persona Output Schema

Every persona evaluation MUST conform to this exact structure. No sections may be added or omitted.

---

```markdown
## [Persona Name] — [Framework Label]

### Verdict
- **Rating:** Buy / Watchlist / Avoid
- **Confidence:** 1–10
- **Time Horizon:** [specific]

### Thesis (3–5 bullets)
[Why this verdict, from this persona's framework]

### Key Strengths Identified (2–3 bullets)
[What in the deep dive supports the opportunity]

### Key Risks and Red Flags (2–3 bullets)
[What in the deep dive concerns this persona]

### Position Sizing Suggestion
[None / Small / Moderate / Full — with reasoning]

### What Would Change My Mind
[Specific triggers that would flip the verdict]

### Pre-Mortem
[If this investment fails, the reason will have been...]

### Unanswered Questions (2–3 bullets)
[What the deep dive couldn't resolve that matters for this framework]
```

---

## Field Definitions

### Verdict
- **Rating** must be one of exactly three values: `Buy`, `Watchlist`, or `Avoid`. No other values are permitted. No qualifiers like "Strong Buy" or "Lean Avoid."
- **Confidence** is an integer from 1 to 10. 1 = virtually no conviction. 10 = highest possible conviction. Most verdicts should fall in the 4–7 range.
- **Time Horizon** must be a specific range (e.g., "3–5 years", "6–12 months", "12–18 months"). Do not write "long-term" or "short-term" without specificity.

### Thesis
- 3 to 5 bullet points, each a complete analytical statement (not a label or topic)
- Must reference specific evidence from the deep dive report
- Must be framed through the persona's analytical framework

### Key Strengths Identified
- 2 to 3 bullet points
- Must cite specific data, findings, or conclusions from the deep dive
- Must explain WHY this is a strength from the persona's framework perspective

### Key Risks and Red Flags
- 2 to 3 bullet points
- Must cite specific data, findings, or conclusions from the deep dive
- Must explain WHY this is a risk from the persona's framework perspective

### Position Sizing Suggestion
- One of: `None`, `Small`, `Moderate`, `Full`
- Must include 1–2 sentences of reasoning
- Must be consistent with the Rating and Confidence

### What Would Change My Mind
- Specific, falsifiable conditions
- Must relate to observable data, events, or metrics
- Not vague statements like "if things get worse"

### Pre-Mortem
- Written as: "If this investment fails, the reason will have been..."
- Must identify the single most likely failure mode from the persona's framework
- Must be a specific scenario, not a generic risk

### Unanswered Questions
- 2 to 3 bullet points
- Must identify genuine gaps in the deep dive that matter for THIS persona's framework
- Should acknowledge `[Data not available — verify manually]` tags where relevant

---

## Validation Rules

The application layer should verify:
1. All 8 section headers are present
2. Rating is one of: Buy, Watchlist, Avoid
3. Confidence is an integer 1–10
4. Thesis has 3–5 bullet points
5. Key Strengths has 2–3 bullet points
6. Key Risks has 2–3 bullet points
7. Position Sizing is one of: None, Small, Moderate, Full
8. Unanswered Questions has 2–3 bullet points

If validation fails, present the output with a formatting notice — do not discard useful analysis over formatting.
