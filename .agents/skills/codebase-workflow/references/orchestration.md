# Orchestration

The agent that invoked the skill is the orchestrator for the whole run. It owns the plan, every decision below, the manifest, the build and the gates. Workers produce page candidates and reports, nothing else.

## Decide yourself (do not ask)

- Which worker and model runs each task; retry; upgrade the model after a second failure.
- Archify layout/validation repairs, splitting a crowded page into two, page grouping and naming.
- Skipping generated, vendored, build-output and test-fixture files (record them as exclusions with that reason).
- Translating vi → en.
- Small fixes to your own scripts/templates during the run (log them in `lessons.md`).

## Bring to the human (one option question each, batched when possible)

- Narrowing scope or excluding an item for any reason other than the ones above.
- A plan above the budget: more than **15 pages** per project or more than **4 workers** in parallel.
- Business meaning you cannot cite (idea/plan sources, or code that contradicts docs).
- A secret-looking value found in source that would reach a page.
- Overwriting an existing output folder (offer: update changed pages / regenerate with old files moved to `legacy/`).
- Any edit to this skill proposed by `self-improve.md`.
- Commit, push, enabling GitHub Pages, or anything published outside the local folder.

## Model routing

Rate each task, then pick the cheapest worker that reliably passes for that rating. Prefer the CLIs the human selected in Q6; otherwise follow the table.

| Rating | Typical task | Claude (subagent `model`) | Other CLIs |
|---|---|---|---|
| none | tree and ERD specs, layout, finalize — scripts (`gen-tree`, `gen-erd`, `compile-spec`) | — | — |
| light | enumerate files/routes/tables, translate spec text vi → en, fill manifest text | `haiku` | `agy` flash model, `qwen` |
| medium | the spec of one user journey, lifecycle, or sequence of one flow | `sonnet` | `agy` (`gemini-4-argon-medium`), `cursor-agent` |
| heavy | overview explainer, cross-app architecture spec, a page the compiler could not place | `opus` / current model | `agy --effort high` |

Signals that raise a rating: > 12 nodes expected, several apps involved, contradictory sources, a previous failure. Record the choice per task in `src/run-report.json` so the next run can compare cost and outcome.

## Dispatch

- One task = one page (both languages: the worker does vi; a light translator does en).
- Each worker gets `templates/worker-prompt.md` filled in, its own folder `src/pages/<page-id>/`, and the absolute Archify path.
- Run tasks in parallel up to the agreed limit; never two writers on the same page folder.
- Prefer the harness's own subagents when the orchestrator is Claude Code (cheaper hand-off, no CLI auth). Use external CLIs for the workers the human chose, with the headless commands in `agents.md`.
- Give every external worker a fallback chain (`run-worker.sh … agy default 40 agy:claude-sonnet-5-5-medium claude:sonnet`): a quota error moves the page to the next entry and logs `# failover:` in `worker.log`; record the switch in `run-report.json`.
- No external CLI usable (not installed, not logged in, quota out at the `--probe`): run every task as your own subagents with the model the rating table gives — a small decision, tell the human in the progress note, do not ask.
- Your own quota is the last source: subagents share it. If it runs out, stop dispatching, keep what passed (staged `out/`, reports, `plan.json`), write `run-report.json` with the pages left, and tell the human what to rerun — never leave half-written pages published.
- Orchestrator without model-selectable subagents (e.g. running inside agy or codex): do the pages yourself, one at a time, heavy ones first.

## Review loop

For each finished task: read the worker report → confirm `finalize` passed (receipt `*.finalize-summary.json`) → spot-check two or three claims against `sources` → confirm every `covers` id is visible. Failure → re-dispatch with the report's difficulties added to the prompt; second failure → upgrade the model; third → take it yourself or ask the human.

## Fallback: hand-authoring a candidate

Only for a page the compiler could not place (see `plan.mjs compile` output). Give the worker the printed diagnostics and these rules, learned on earlier runs:

- Edit the candidate with a JSON load/dump script, never text replacement: `i18n.mjs inject` reformats the file, so `sed`-style edits silently miss.
- Set `meta.output` to the output path **relative to the folder finalize runs in** (run finalize from the output's folder with the bare file name). Delivery rejects a missing or absolute `meta.output`, even though the schema marks it optional.
- Workflow v2: omit `fromSide`/`toSide`, and add groups/tags only where they mean something. Pinned sides plus groups on every row cause `workflow/explicit-pin-conflict` and `workflow/solver-budget-exhausted`.
- No explicit node widths; labels ≤ 24 characters, sublabels ≤ 28 (see `audience.md`).
- Reuse one evidence folder per language: delete `review-<lang>` before each finalize run, then pass it as `--out-dir`. Archify refuses to write into an existing folder.
- Write the fixes back into the spec or the compiler afterwards, so the next run does not need the fallback.

