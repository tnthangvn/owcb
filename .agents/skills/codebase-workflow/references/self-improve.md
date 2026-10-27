# Self-improvement

Tools and models drift (new Archify version, changed CLI flags, a model that stops following the brief). The orchestrator owns keeping this skill current.

## Every run

1. Each worker writes `src/pages/<page-id>/report.json` (schema `schemas/worker-report.schema.json`): status, attempts, model, duration, `covers_done`, `difficulties[]` (category + detail + suggestion), `unknowns[]`.
2. The orchestrator merges them into `<project>/src/run-report.json` with its own entries (preflight drift, gate failures, human decisions).
3. For each difficulty that is not already in `lessons.md`, append one entry:

```md
## 2026-10-27 · archify-gate · workflow overflow with long Vietnamese labels
- Seen: shop/login-sso (sonnet), 2 attempts
- Fix used: shortened labels to ≤ 28 chars, moved detail to `detail`
- Proposed skill change: i18n.md — add label length guidance   (status: proposed)
```

Categories: `archify-gate`, `missing-source`, `schema`, `cli-flags`, `model-quality`, `timeout`, `coverage`, `i18n`, `other`.

## When to change the skill

Propose a patch when any of these hold:
- the same lesson appears in two runs;
- preflight found version drift and a worker hit a related failure;
- a gate keeps failing for a reason the references don't cover.

Show the human the lesson(s) and the exact diff to the reference file (an option question: apply / skip / Khác). Apply only on a yes, then delete the lesson from `lessons.md` (it keeps only open lessons; git history keeps applied ones) and update the "Last verified" table in `agents.md` when versions were confirmed.

Never change the skill silently, and never let a worker edit it.
