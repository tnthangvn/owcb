# Worker brief — {{PAGE_ID}}

You are a worker in a codebase-workflow run. You produce ONE page **spec** (meaning only) and a report. A compiler turns your spec into the Archify diagram; you never place nodes, columns, widths or routes. The orchestrator owns everything else.

## Your page

- Title: {{TITLE_VI}} / {{TITLE_EN}}
- Archify type: {{TYPE}}   ·   Audience: {{AUDIENCE}}
- Question the page must answer: {{QUESTION}}
- Must cover: {{COVERS}} — every one of these must be represented on the page (as a step, screen, node, entity or state). Do not print the raw ids on the page; the orchestrator tracks coverage in the manifest.
- Inventory items for those ids (with evidence): see `{{INVENTORY_SLICE}}`

## Inputs and limits

- Source repository (READ-ONLY, never modify): `{{REPO}}` at revision `{{COMMIT}}`. Read and cite files **at that revision** (`git -C {{REPO}} show {{COMMIT}}:<path>`), never the working tree — it may hold uncommitted changes — with exact line ranges.
- Spec format for your type: `{{SKILL_DIR}}/references/specs/{{TYPE}}.md` (read it fully; a sample is in `{{SKILL_DIR}}/scripts/compilers/samples/{{TYPE}}.spec.json`).
- Write only inside `{{WORK_DIR}}/` — helper scripts too (never a shared scratch/tmp folder: parallel workers overwrite each other's files there). Do not touch `manifest.json`, any `index.html`, other pages, the compilers, or the skill.
- Audience rules: `{{SKILL_DIR}}/references/audience.md`. Known pitfalls: `{{SKILL_DIR}}/lessons.md`.
{{EXTRA_NOTES}}

## Steps

1. Read the source slice for your covers: follow imports and call sites until each step/relationship has evidence.
2. Write `{{WORK_DIR}}/spec.vi.json` in **Vietnamese** (no `lang` field). Edit JSON with a load/dump script, not text replacement.
3. Compile: `node {{SKILL_DIR}}/scripts/compile-spec.mjs {{WORK_DIR}}/spec.vi.json {{OUT_VI}} --lang vi --repo-root {{REPO}} --work {{WORK_DIR}}/build-vi`. Exit 0 = done. On failure fix the **spec** (meaning, evidence, overly long text) and rerun; the compiler already retries layout itself.
4. {{EN_STEP}}
5. Only if the compiler still fails after you fixed the spec twice: say so in the report with the printed diagnostics (category `archify-gate`) — the orchestrator decides whether to hand-author the candidate.
6. Write `{{WORK_DIR}}/report.json` matching `{{SKILL_DIR}}/schemas/worker-report.schema.json`. Be honest: list every difficulty (compiler limits, confusing spec rules, missing source) with a suggestion — the orchestrator uses them to improve the skill.

## Working principles

{{WORKING_PRINCIPLES}}

Finish with one line: `REPORT {{WORK_DIR}}/report.json <status>`.
