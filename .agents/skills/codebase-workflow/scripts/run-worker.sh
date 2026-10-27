#!/usr/bin/env bash
# Run one page brief on an external agent CLI, headless, from the site root.
#   run-worker.sh <cli> <model|default> <work-dir> <source-repo> [timeout-minutes] [fallback-cli:model ...]
# The brief is <work-dir>/brief.md; output goes to <work-dir>/worker.log; the worker writes <work-dir>/report.json.
# A run that ends on a quota / rate-limit error is retried with the next fallback (e.g. agy:claude-sonnet-5-5-medium
# claude:sonnet); each switch is a "# failover:" line in worker.log so the orchestrator can record it.
set -u
dir=$3 repo=$4 minutes=${5:-40}
chain=("$1:$2" "${@:6}")
brief="$dir/brief.md"
log="$dir/worker.log"
[ -f "$brief" ] || { echo "no brief at $brief" >&2; exit 2; }
prompt="Follow the worker brief in $brief exactly. Read it first."
QUOTA='RESOURCE_EXHAUSTED|[Qq]uota|rate.?limit|usage limit|code 429|status 429'

run_one() {
cli=$1 model=$2
case "$cli" in
  agy)
    args=(-p "$prompt" --dangerously-skip-permissions --add-dir "$repo" --add-dir "$dir" --print-timeout "${minutes}m")
    [ "$model" != default ] && args+=(--model "$model")
    ;;
  gemini)
    args=(-p "$prompt" --yolo --skip-trust --include-directories "$repo")
    [ "$model" != default ] && args+=(-m "$model")
    ;;
  cursor-agent)
    args=(-p "$prompt" --force --output-format text)
    [ "$model" != default ] && args+=(--model "$model")
    ;;
  qwen)
    args=(-p "$prompt" --yolo)
    [ "$model" != default ] && args+=(-m "$model")
    ;;
  claude)
    args=(-p "$prompt" --permission-mode acceptEdits --add-dir "$repo")
    [ "$model" != default ] && args+=(--model "$model")
    ;;
  *) echo "unsupported cli $cli" >&2; return 2 ;;
esac
command -v "$cli" >/dev/null || { echo "# $cli not installed" >>"$log"; return 127; }
local start=$(date +%s) code
echo "# $cli $model — $(date -Is)" >>"$log"
timeout "$((minutes + 5))m" "$cli" "${args[@]}" </dev/null >"$log.part" 2>&1
code=$?
cat "$log.part" >>"$log"
echo "# exit $code after $(( ($(date +%s) - start) / 60 )) min" >>"$log"
[ $code -ne 0 ] && [ ! -f "$dir/report.json" ] && grep -Eq "$QUOTA" "$log.part" && code=75  # quota: try the next one
rm -f "$log.part"
return $code
}

: >"$log"
for i in "${!chain[@]}"; do
  run_one "${chain[$i]%%:*}" "${chain[$i]#*:}"
  code=$?
  [ $code -eq 75 ] || [ $code -eq 127 ] || break
  next=${chain[$((i + 1))]:-}
  [ -n "$next" ] || { echo "# failover: no fallback left after ${chain[$i]}" >>"$log"; break; }
  echo "# failover: ${chain[$i]} -> $next ($([ $code -eq 75 ] && echo quota || echo 'not installed'))" >>"$log"
done
grep '^# failover' "$log"
tail -n 1 "$log"
[ -f "$dir/report.json" ] && echo "report: $dir/report.json" || echo "no report written"
