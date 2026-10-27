# Worker agents

`bash scripts/detect-agents.sh` lists what is installed. When the plan uses `agy`, run `bash scripts/detect-agents.sh --probe <model>...` with the models you intend to use: each gets a one-line prompt, and `"quota: Resets in …"` means that model is out for this run — assign its pages to another model or CLI before dispatching (agy quotas are per model family: the Gemini models can be exhausted while Claude-via-agy still answers). Run workers from the **site root** so they load its `AGENTS.md` / `GEMINI.md` / `CLAUDE.md` (all the same file), and give the prompt through a file to avoid shell quoting problems.

| CLI | Headless command (prompt in `$P`, a file) | Notes |
|---|---|---|
| Claude Code (orchestrator) | Agent/subagent tool with `model: haiku \| sonnet \| opus` | Preferred when the orchestrator is Claude Code. |
| `claude` | `claude -p "$(cat $P)" --model sonnet --permission-mode acceptEdits` | Separate process; uses the same account quota. |
| `agy` | `agy -p "$(cat $P)" --dangerously-skip-permissions --effort medium --output-format json` | Antigravity CLI. `--model` to pin a model; `--print-timeout 30m` as a guard. |
| `gemini` | `gemini -p "$(cat $P)" --yolo --skip-trust` | **Free-tier ("Code Assist for individuals") accounts are rejected since 2026 — use `agy` with a Gemini model instead.** Paid/API-key accounts: `-m <model>`. |
| `cursor-agent` | `cursor-agent -p "$(cat $P)" --force --output-format text` | `--model <name>`. |
| `qwen` | `qwen -p "$(cat $P)" --yolo` | Light tasks. |
| `opencode` | `opencode run "$(cat $P)"` | Only when the human picks it. |
| `codex` | `codex exec "$(cat $P)" --full-auto` | Not installed when this table was verified. |

`scripts/run-worker.sh` (extra `cli:model` arguments = fallback chain on quota errors) wraps these commands (adds the source repo to the CLI's workspace: `agy --add-dir`, `gemini --include-directories`, `claude --add-dir`). `agy models` lists model ids (e.g. `gemini-4-argon-medium`, `claude-sonnet-5-5-medium`).

Run each external worker in the background with its output captured to `src/pages/<page-id>/worker.log`, and a timeout (30 min default). The worker's report is the JSON file it writes (`report.json`), not its stdout.

## Last verified

Update this table when a run confirms a CLI still works with the flags above. A version newer than the one listed is not an error — note it at preflight and watch that worker's report for flag/behaviour problems.

| Tool | Version | Verified |
|---|---|---|
| archify | 3.2.0 | 2026-10-27 |
| claude | 2.1.309 | 2026-10-27 |
| agy | 1.4.8 | 2026-10-28 (`-p`, `--model`, `--print-timeout` confirmed by `--probe`) |
| gemini | 0.44.0 | 2026-10-27 — auth rejected on free tier |
| cursor-agent | 2026.07.23 | 2026-10-27 (flags from `--help` only) |
| qwen | 0.14.5 | 2026-10-27 (flags not exercised) |
| opencode | 1.3.13 | 2026-10-27 (flags not exercised) |
