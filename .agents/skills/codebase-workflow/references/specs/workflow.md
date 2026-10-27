# Workflow spec

`"type": "workflow"` → `scripts/compilers/workflow.mjs` → Archify workflow v2 (readable). Semantic only: no `col`, `yOffset`, widths, sides, routes, `via` or viewBox — the compiler decides all of them. Sample: `scripts/compilers/samples/workflow.spec.json`.

```json
{ "type": "workflow", "title": "Leave request and approval", "subtitle": "optional",
  "lanes": [{ "id": "employee", "label": "Employee" }, { "id": "problems", "label": "Rejected", "variant": "exception" }],
  "steps": [
    { "id": "fill", "label": "Fill the form", "sublabel": "dates, type, reason", "lane": "employee",
      "kind": "step", "tag": "HR only", "detail": "Half days allowed; files up to 5 MB.",
      "sources": [{ "path": "apps/web/src/leave/Form.tsx", "line": 12, "end_line": 40 }] },
    { "id": "review", "label": "Review request", "lane": "manager", "kind": "decision" }
  ],
  "edges": [{ "from": "fill", "to": "review", "label": "send", "variant": "emphasis" },
            { "from": "review", "to": "reject", "label": "no", "variant": "security", "role": "error" }],
  "phases": [{ "id": "ask", "label": "1. Ask", "steps": ["fill"] }],
  "groups": [{ "id": "form", "label": "Request form", "steps": ["fill", "submit"] }],
  "mainPath": ["fill", "review", "approve"],
  "cards": [{ "title": "Who can approve", "items": ["Line manager", "HR when none is set"], "dot": "cyan" }],
  "legend": [{ "kind": "frontend", "label": "Screen or action" }] }
```

Do not put `lang` in the spec (it would break `i18n.mjs check-pair`); pass `--lang` to `compile-spec.mjs`.

## Fields

| Field | Rules |
|---|---|
| `title`, `subtitle?` | reader text. Leave `subtitle` out unless asked |
| `lanes[]` | `id`, `label`, `variant?: "exception"` (rejections, failures, waits). Order = top to bottom. A lane is a person/role or a screen area, not a layout trick |
| `steps[]` | `id`, `label`, `lane`, `sublabel?`, `kind?`, `tag?`, `icon?`, `detail?`, `sources` (1–3 `{path, line?, end_line?}`, repo-relative, committed files only). Spec order is a tie-breaker only |
| `steps[].kind` | `step` (default) · `screen` · `action` · `start` · `end` · `result` · `system` · `decision` · `approval` · `error` · `external` · `store` · `async` · `scheduled`, or a raw Archify type (`frontend`, `backend`, `security`, `messagebus`, `external`, `database`, `cloud`). Sets colour, legend group and a default icon |
| text budget | `label` ≤ ~24 chars, `sublabel` ≤ ~28, `tag` ≤ ~16 reads best. Longer text is not an error: the compiler cuts at a natural boundary and moves the full text into a generated "Step details" card; `detail` always goes there |
| `edges[]` | `from`, `to`, `label?` (keep it: action, condition, protocol), `variant?` (`default`, `emphasis` = happy path, `security` = denial/permission, `dashed` = async/optional), `role?` (`main`, `branch`, `async`, `return`, `error`). Loops back to an earlier step are fine — they become `role: "return"` |
| `phases[]?` | `id`, `label`, `variant?`, `steps[]` — story beats in order (Ask → Decide → After). A step is in at most one phase. Columns are reserved so phases never overlap; an empty or squeezed phase merges its label into the previous one. Independent flows (no edge between them) whose phases cannot fit side by side run in parallel and share one phase band whose label lists the phases in row order (top flow first) — to keep one band per phase, split the flows into separate pages |
| `groups[]?` | `id`, `label`, `variant?`, `steps[]` — all in one lane. Only when the grouping means something |
| `mainPath[]?` | the happy path, consecutive ids must have an edge. Omitted → derived (longest forward path, preferring `emphasis`/`main` edges) |
| `cards[]` | `title`, `items[]`, `dot?` ∈ cyan, emerald, violet, amber, rose, orange, slate (cycled when omitted). Never print inventory ids here |
| `legend[]?` | `{kind, label}` renames a colour group for readers (e.g. `frontend` → "Screen or action") |

## What the compiler does

- Columns `0..5` by longest-path layering on the step graph after cutting back edges (DFS, `mainPath` first). An edge inside one lane moves one column right; an edge to another lane may stay in the same column (vertical drop), unless a step in a lane between them sits in that column. Phases reserve their own column band. Inside a lane, steps chained by same-lane edges keep one row; overlapping chains (and, in parallel mode, each independent flow) get their own row. Parallel flows start a column apart when they would cross and never drop vertically in one column.
- Cell collisions: the next free cell to the right (at most one column) is used, otherwise steps stack in the cell with symmetric `yOffset`s. Cells crossed by a vertical edge are avoided. Side roots are pulled next to their first successor.
- It runs Archify `validate` in-process (no browser, no evidence) and does a small best-first search over layout-only variants until it passes: shorter text (5 levels), spreading a cross-lane edge one column, a route preset (`bottom-channel`, `up-channel`, `drop`) on a diagnosed edge whose endpoints are in different columns, shifting a parallel flow, nudging an endpoint right, larger stack gap.
- `relax` (after a failed `finalize`) uses the same search from the rejected layout: text/canvas/viewport/readability codes → shorter text; `ambiguous-corridor`, `proper-crossing`, label clearance → spread/route/nudge on the named edges; `route-preset-conflict`, `explicit-pin-conflict`, `solver-budget-exhausted` → drop the preset on that edge (then its siblings, then all) and never propose that edge/preset again (a conflicting probe scores worse than any complete layout); `delivery/*` lock races → retry unchanged; `repository-evidence/*` → give up (fix the sources). Never drops a step, edge, label or source.
- i18n: only `title`, `subtitle`, `label`, `sublabel`, `tag`, `detail`, `items` differ between languages; ids, lanes, kinds, variants, roles, phase/group step lists, `mainPath`, sources stay identical (`i18n.mjs check-pair spec.vi.json spec.en.json`).

## Authoring tips

- One journey per page; 8–25 steps, 3–8 lanes. Only six columns exist: a single lane chain longer than ~6 steps gets stacked at the right edge. Spread a long journey across the roles/screens that really own the steps, or split the page.
- Put the happy path on `variant: "emphasis"` edges; branch failures to an `exception` lane with `role: "error"`.
- Request and approval in different lanes land in the same column — that is intended.
- Compile both languages of a page one after the other: Archify locks the output folder, so parallel runs into the same `compiled/` folder fail with `delivery/concurrent-attempt` (the compiler retries once, but it costs an attempt).
