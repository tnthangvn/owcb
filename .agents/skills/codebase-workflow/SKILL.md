---
name: codebase-workflow
description: "Turn a codebase, an idea, a plan/PRD or existing docs into a GitHub-Pages-ready documentation site of Archify (tt-a1i/archify) diagrams — user journeys, architecture, sequences, ERD, lifecycles, data flows — with full coverage of what the source contains, bilingual (vi + en) by default, one folder per project with a generated index.html sidemap. The agent that invokes the skill orchestrates: it interviews the human with option lists (each with an 'Other + input' choice), inventories the source, splits page work across worker agents/models installed on this machine (agy, gemini, cursor-agent, qwen, claude…), gates quality and coverage, builds the site, and learns from worker reports. Use when the user asks to 'gen workflow từ codebase', 'vẽ kiến trúc/luồng nghiệp vụ cho repo X', 'làm trang tài liệu workflow cho end user', 'đóng gói sơ đồ lên GitHub Pages', or to regenerate/update such a site."
metadata:
  version: "1.0"
  requires: "archify >= 3.2 (installed at .agents/skills/archify)"
---

# Codebase Workflow

Produce a documentation site: one folder per project (`<site-root>/<project>/`), Archify pages inside it, an `index.html` sidemap per folder, all static and relative so it works from `file://` and GitHub Pages.

You — the agent that loaded this skill — are the **orchestrator**. You run every phase, decide small things yourself and bring big decisions to the human ([orchestration.md](references/orchestration.md)). Workers only write page candidates and report back.

Every agent in a run — you and each worker — follows [working-principles.md](references/working-principles.md) (think first, simplest thing, touch only what you must, verifiable goals). The worker prompt embeds it.

Paths below are relative to this skill folder (`SKILL_DIR`). Archify lives at `ARCHIFY=<site-root>/.agents/skills/archify` unless preflight finds another install.

## Phase 0 — Preflight (no questions yet)

1. Read [lessons.md](lessons.md) — known pitfalls from earlier runs. Apply them.
2. Locate Archify (`$ARCHIFY/bin/archify.mjs`); run `node $ARCHIFY/bin/archify.mjs doctor`. Missing → ask before `npx skills add tt-a1i/archify`.
3. Run `bash scripts/detect-agents.sh` → JSON of installed agent CLIs + versions. If `agy` is a candidate, add `--probe <model>...` to catch an exhausted quota now ([agents.md](references/agents.md)).
4. Compare versions with the "last verified" table in [agents.md](references/agents.md) and Archify's version with `metadata.requires`. Drift → tell the human the skill may be outdated in that area (one line), continue.

## Phase 1 — Interview

Ask with option lists, every question ending in an "Other — type your own" choice. Use the structured question tool when your harness has one; otherwise print numbered options. Questions, defaults and branching: [interview.md](references/interview.md). It always covers: source kind, **source path** (for codebase / idea / plan / docs), audience, scope, page types, worker agents, language (default **bilingual vi + en**), output folder.

## Phase 2 — Load only the branch you need

| Source kind chosen | Read |
|---|---|
| Codebase | [source-codebase.md](references/source-codebase.md) |
| Idea (no code yet) | [source-idea.md](references/source-idea.md) |
| Plan / PRD / spec | [source-plan.md](references/source-plan.md) |
| Existing docs / Mermaid | [source-docs.md](references/source-docs.md) |
| Mixed | each relevant file above |

Always read [audience.md](references/audience.md) and [i18n.md](references/i18n.md). Do not load the other branches.

## Phase 3 — Inventory and page plan

Follow the branch reference to write `<project>/src/inventory.json` (every item has evidence). Then plan pages: group inventory features into pages, pick the Archify type per page, rate each task's difficulty and pick its worker + model ([orchestration.md](references/orchestration.md#model-routing)). Every inventory item must land on a page or in `src/coverage-exclusions.json` with a reason.

Write the plan to `<project>/src/plan.json` (title, summary, repo, origin, commit, languages, groups, pages with id · group · folder · type · audience · title · summary · question · covers · worker · notes). Show the human the page plan table (page · type · audience · covers · worker/model) and confirm with options (OK / drop some / add / Other) before generating. Then:

```bash
node scripts/plan.mjs briefs <project-dir> --archify $ARCHIFY   # src/pages/<id>/brief.md + inventory-slice.json
```

## Phase 4 — Generate (spec-first)

Nobody hand-writes Archify layout. Every diagram page is a semantic **spec** (`src/pages/<id>/spec.<lang>.json`, format in [references/specs/](references/specs/)) compiled by `scripts/compile-spec.mjs` + `scripts/compilers/<type>.mjs`, which place nodes, size text, retry layout and run `archify finalize`.

| Page type | Who writes the spec |
|---|---|
| `tree` (screen map, API by module) | `scripts/gen-tree.mjs` from the inventory — no agent |
| `erd` | `scripts/gen-erd.mjs` from the Prisma schema — no agent |
| `workflow`, `sequence`, `lifecycle`, `architecture`, `dataflow` | a worker reads the code and writes the spec (brief from `plan.mjs briefs`) |
| `explainer` (overview) | the orchestrator writes `candidate.archify.md` (Archify's compact Markdown) |
| other languages | a light model translates the spec text; `i18n.mjs check-pair` verifies |

Dispatch spec workers in parallel up to the agreed limit. Own subagents get "Follow the worker brief in `<dir>/brief.md`"; external CLIs run through `bash scripts/run-worker.sh <cli> <model|default> <dir> <repo> [minutes] [fallback-cli:model ...]` in the background (a quota error moves on to the next fallback) ([agents.md](references/agents.md)). Each writes `report.json` ([schemas/worker-report.schema.json](schemas/worker-report.schema.json)).

Compile (or recompile after a spec/compiler change) — languages run one after another because Archify locks the output folder:

```bash
node scripts/plan.mjs compile <project-dir> [--page <id>]
```

A page the compiler cannot place after its own relax rounds is the only case for hand-authoring a candidate: give a worker the printed diagnostics and the [fallback rules](references/orchestration.md#fallback-hand-authoring-a-candidate). A diagram type without a compiler → write `scripts/compilers/<type>.mjs` + `references/specs/<type>.md` + a sample (contract: `scripts/compilers/README.md`) instead of authoring by hand.

Review each result: spot-check claims against evidence and that every `covers` item is on the page; re-dispatch failures (upgrade the model on the second failure).

## Phase 5 — Package

Merge finished pages into `<project>/manifest.json` ([packaging.md](references/packaging.md), schema `schemas/manifest.schema.json`) — pages whose HTML exists are taken from the plan; hand-added entries (e.g. `legacy`) are kept. **Never hand-write or let a worker write any `index.html`** — run:

```bash
node scripts/plan.mjs manifest <project-dir>
node scripts/build-site.mjs <site-root>
```

It renders every project index, every sub-folder index (when a folder holds more than one page), the root index, and `.nojekyll`, from the fixed template in `templates/site/`.

## Phase 6 — Gates

```bash
node scripts/check-site.mjs <site-root> [--project <name>]
```

Must pass: manifest valid, every listed file exists, no orphan HTML, only relative links (no `file://`, no absolute local paths), coverage complete (or excluded with reason), no secret-looking values. Archify `finalize` must have passed for every page. Details: [quality-gates.md](references/quality-gates.md).

## Phase 7 — Learn and report

1. Merge worker reports into `<project>/src/run-report.json`; append new pitfalls to [lessons.md](lessons.md) ([self-improve.md](references/self-improve.md)). Repeated pitfall or version drift → draft a patch to the relevant reference and **ask the human** before editing the skill.
2. Reply briefly: link to the project `index.html`, pages count, coverage %, what was excluded and why, anything that needs a human decision. Never commit, push or enable Pages without an explicit yes.
