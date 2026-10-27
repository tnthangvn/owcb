# Architecture spec (`type: "architecture"`)

Semantic only: no `pos`, `size`, `row`/`col`, `fromSide`/`toSide`, `via` or label pins. `scripts/compilers/architecture.mjs` places, sizes and pads everything; routes stay automatic. Sample: `scripts/compilers/samples/architecture.spec.json`.

```bash
node scripts/compile-spec.mjs <page>/spec.vi.json <page>/compiled/<id>.vi.html --lang vi --repo-root <repo>
node scripts/i18n.mjs check-pair <page>/spec.vi.json <page>/spec.en.json
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `"architecture"` |
| `id` | no | page id (not rendered) |
| `title` | yes | diagram title |
| `subtitle` | no | only when the user asked for one |
| `views[]` | no | Archify guided views `{id, label (≤48), focus: [component ids], note? (≤140)}`, max 5 |
| `components[]` | yes | `{id, label, sublabel?, tag?, kind, boundary?, detail?, icon?, sources?}` |
| `boundaries[]` | no | `{id, label, kind: "region" \| "security-group", parent?}` — `parent` nests a boundary in another |
| `connections[]` | no | `{from, to, label?, protocol?, variant?, id?}` |
| `cards[]` | no | `{dot?, title, items[]}`; dot ∈ cyan, emerald, violet, amber, rose, orange, slate |
| `detailsCard` | no | `{title?, dot?}` for the card that collects component `detail` text |

- `kind` (alias `type`): frontend, backend, database, cloud, security, messagebus, external.
- `boundary`: the innermost boundary the component belongs to; outer boundaries include it automatically. A boundary must have members. External actors get no boundary.
- `sources`: 1–3 `{path, line?, end_line?, label? (≤48)}`, repository-relative, committed files only (`git ls-files`).
- `detail`: longer reader text; rendered as `"<label>: <detail>"` in a details card (Archify has no per-node detail field).
- `variant`: `emphasis` marks the main path (the compiler keeps it on one row, left to right), `security` for auth/policy, `dashed` for async, omitted = ordinary call.
- `protocol`: appended to the label as `label · protocol`; it is not translated, so keep it identical across languages.
- Text keys (`label`, `sublabel`, `tag`, `title`, `detail`, `note`, `items`) may differ between `spec.vi.json` and `spec.en.json`; everything else must match.

Do not put `lang`, `meta.output`, `locale` or `repository` in the spec — `compile-spec.mjs` sets them.

## What the compiler does

1. Validates ids, kinds, references, source counts and boundary nesting; throws a readable error list.
2. Assigns grid cells: longest-path columns from connection direction (cycles broken at the edge returning to the DFS stack; external actors start the DFS), then a deterministic local search (single moves, swaps, boundary-block and leaf-follower shifts, row/column swaps) minimising estimated crossings, edges through nodes, bends, back edges, main-path row changes, and boundary impurity (no non-member inside a boundary's member rectangle; sibling boundaries never overlap).
3. Probes the best layouts with `archify validate architecture --layout-json` (sources stripped) and counts real routed crossings, including touching and collinear overlaps; then moves endpoints of remaining crossings and re-probes (bounded). The layout with a valid probe and the fewest crossings wins.
4. Sizes boxes from text (label 6.6 px/unit, sublabel 5.4 px/unit at 9 px), sizes column gaps from the widest label crossing them and the boundary frames in them, row gaps from frame titles; boundary `pad` grows with nesting depth.

`relax` (after a failed finalize) only changes geometry: widens overflowing boxes from diagnostic evidence, switches to the next-ranked layout on boundary/through-node/crossing errors, or scales gaps by 1.25 (up to 2.5×).

## Writing tips

- Mark the reader's main path with `variant: "emphasis"` on every hop; it is the strongest layout hint.
- Labels ≤ ~20 characters, sublabels ≤ ~28; put the rest in `detail` or cards.
- A hub with many connections is fine; the compiler spreads its neighbours. Split the page if more than ~16 components compete for one question.
