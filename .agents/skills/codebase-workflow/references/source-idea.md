# Source: idea (no code yet)

The source path from Q2 is a folder with notes/sketches, or an existing repo to align with. There is no code evidence, so the risk is invention.

1. Read everything in the path. Summarise the idea back in 5–10 bullets: actors, goals, main journeys, data the idea implies, open questions.
2. **Ask before inventing.** For each gap that would change a diagram (who approves, what happens on failure, which data is stored), ask with options (2–3 plausible answers + Khác). Batch up to 4 per round; stop after 2 rounds and mark the rest as assumptions.
3. Write `src/inventory.json` with the same shape as `source-codebase.md`, but `evidence` points to the idea files (`notes/idea.md:12`) or `"human:Q<n>"` for an answer given in the interview. Assumptions get `"evidence": ["assumption"]` and `notes` saying so.
4. Page plan: overview explainer, one workflow per journey, lifecycle for any status the idea defines, a proposed architecture marked "đề xuất" in its subtitle. No ERD unless the idea lists data fields.
5. Archify candidates use `meta.evidence: "illustrative"` where the type supports it, and every assumption is visible on the page (a card or a dashed node), never silent.

Coverage gate still applies: every idea item lands on a page or in exclusions.
