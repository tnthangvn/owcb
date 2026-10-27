# Lifecycle spec

`"type": "lifecycle"` → `scripts/compilers/lifecycle.mjs` → Archify lifecycle v3. Semantic only: Archify places states and routes. Sample: `scripts/compilers/samples/lifecycle.spec.json`.

```json
{ "type": "lifecycle", "title": "...", "subtitle": "...",
  "states": [{ "id": "draft", "kind": "initial", "label": "Draft", "detail": "short note", "tag": "start", "sources": [{ "path": "src/a.ts", "line": 3 }] }],
  "transitions": [{ "from": "draft", "to": "active", "label": "submit", "note": "who/when", "tone": "main" }],
  "main": ["draft", "active", "done"],
  "cards": [{ "title": "...", "items": ["..."] }] }
```

## Fields

| Field | Rules |
|---|---|
| `title`, `subtitle?` | reader text |
| `states[]` | `id`, `label`, `kind`, `detail?` (becomes the sublabel, ≤ ~28 chars), `tag?`, `sources` 1-3 |
| `states[].kind` | `initial`, `normal`, `waiting`, `terminal` (neutral end), `error` (failure end). Also accepted: `decision`, `success`, `failure`, `neutral`, `external` |
| `transitions[]` | `from`, `to`, `label?` (≤ ~22 chars), `note?` (guard / actor, ≤ ~24 chars on the main row, ≤ ~40 elsewhere), `tone?`, `id?` |
| `transitions[].tone` | `main` (emphasis), `security` (permission / approval), `auto` (dashed: timer, worker, system) |
| `main?` | optional happy path (state ids, each pair needs a transition). Default: longest simple path from the first `initial` state, max 5 states, avoiding `error` states and stopping at the first ending |
| `cards[]` | `title`, `items[]`, `dot?` ∈ cyan, emerald, violet, amber, rose, orange, slate |

One page = one state machine. Archify puts every state not reachable from the main path — a second machine or a state without transitions — in the first lower row, to the right, so a page with several machines grows wide fast and no order can stack them; the compiler warns about it. Plan one page per machine (≤ ~10 states). A status value with no transition in the code is better explained in a card than drawn as an isolated state. Write guard and actor text in `note`; `guard` / `actor` are not text keys for `i18n.mjs check-pair`.

## What the compiler does

- `step` numbers (01, 02…) are added to main-path states. The first main state gets the initial marker.
- Long text never widens the main row: a `detail`, `note` or `label` over its budget moves to a generated card (state details, transition notes, full transition names), a shortened label (with "…") stays on the arrow.
- `lifecycle/too-wide`: Archify lays lower rows out in `states[]` order, so the compiler probes up to 12 orders (main path first, attached states breadth-first, each other machine as a chain, isolated states last, then seeded shuffles) and keeps the first that fits, else the narrowest. You do not need to try orders yourself.
- `relax` on any layout failure (`lifecycle/too-wide`, `label-unplaced`…) tightens those budgets in 3 steps (moving all main-row notes, then all notes, then details to cards) and shortens the auto main path. Nothing is dropped; an explicit `main` is never changed.
- i18n: `label`, `detail`, `tag`, `note`, `title`, `items` differ; ids, kinds, tones and sources must match.
