#!/usr/bin/env bash
# Print installed agent CLIs as JSON: name, path, version. Headless commands live in references/agents.md.
#   detect-agents.sh [--probe [agy-model...]]
# --probe sends agy a one-line prompt per model (default model when none is given) and adds
# "probe": {"<model>": "ok" | "quota: <reset>" | "error: <message>"}, so an exhausted quota shows up before dispatch.
set -u
probe=0
models=()
if [ "${1:-}" = --probe ]; then probe=1; shift; models=("$@"); fi
[ ${#models[@]} -eq 0 ] && models=(default)

probe_agy() {
  local model=$1 out code args=(-p "Reply with OK only." --dangerously-skip-permissions --print-timeout 1m)
  [ "$model" != default ] && args+=(--model "$model")
  out=$(cd /tmp && timeout 90 agy "${args[@]}" 2>&1); code=$?
  if [ $code -eq 0 ]; then echo ok
  elif grep -q 'RESOURCE_EXHAUSTED\|quota' <<<"$out"; then echo "quota: $(grep -o 'Resets in [0-9hms]*' <<<"$out" | head -n1)"
  else echo "error: $(tail -n1 <<<"$out" | tr -d '"\\' | cut -c1-120)"
  fi
}

first=1
printf '['
for name in claude agy gemini cursor-agent codex qwen opencode; do
  path=$(command -v "$name" 2>/dev/null) || continue
  # opencode may be a shell alias; only report real executables.
  [ -x "$path" ] || continue
  version=$(timeout 10 "$name" --version 2>/dev/null | head -n1 | tr -d '"\\')
  [ $first -eq 1 ] || printf ','
  first=0
  printf '\n  {"name":"%s","path":"%s","version":"%s"' "$name" "$path" "${version:-unknown}"
  if [ $probe -eq 1 ] && [ "$name" = agy ]; then
    printf ',"probe":{'
    sep=
    for m in "${models[@]}"; do printf '%s"%s":"%s"' "$sep" "$m" "$(probe_agy "$m")"; sep=,; done
    printf '}'
  fi
  printf '}'
done
printf '\n]\n'
