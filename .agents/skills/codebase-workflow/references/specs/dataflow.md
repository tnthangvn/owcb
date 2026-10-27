# Dataflow spec (`type: "dataflow"`)

Semantic only: no `row`, `width`, sides, `via`, channels or label pins. `scripts/compilers/dataflow.mjs` assigns rows (and stages when omitted); routes stay automatic. Sample: `scripts/compilers/samples/dataflow.spec.json`.

```bash
node scripts/compile-spec.mjs <page>/spec.vi.json <page>/compiled/<id>.vi.html --lang vi --repo-root <repo>
node scripts/i18n.mjs check-pair <page>/spec.vi.json <page>/spec.en.json
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `"dataflow"` |
| `id` | no | page id (not rendered) |
| `title` | yes | diagram title |
| `views[]` | no | guided views, as in architecture |
| `stages[]` | yes | 2–5 `{id?, label}` left to right (custody or transformation steps: sources → transforms → stores/sinks) |
| `nodes[]` | yes | `{id, label, sublabel?, tag?, kind, stage?, detail?, icon?, sources?}` |
| `flows[]` | yes | `{from, to, label, variant?, id?}` — `label` is required (the data moved) |
| `cards[]` | no | `{dot?, title, items[]}`; dot ∈ cyan, emerald, violet, amber, rose, orange, slate |
| `detailsCard` | no | `{title?, dot?}` for the card collecting node `detail` text |

- `stage`: a stage `id` or index. Omitted → inferred from flow direction (longest path scaled onto the stages): sources land left, sinks right.
- `kind`: frontend, backend, database, cloud, security, messagebus, external. Use `database` for an evidenced store, `messagebus` for an event/topic/queue.
- `variant`: omitted = ordinary data, `emphasis` = primary path (kept straight), `security` = policy/PII, `dashed` = async/batch.
- Limits from the renderer: at most 5 nodes per stage (rows 0–4). Node label ≤ ~18 characters (6.2 px/unit in a 112 px node; a longer sublabel/tag widens the node up to 168 px). Sublabel/tag ≤ ~40 characters. Flow label ≤ ~17 characters between adjacent stages.

## What the compiler does

1. Validates the spec; throws on unknown ids, >5 nodes in a stage, missing flow labels, labels longer than a stage column.
2. Chooses rows per stage by deterministic local search over estimated crossings, flows whose automatic route would sweep through another node (along the source row through intermediate stages, then down the stage before the target), row changes (weighted on `emphasis`) and backward flows.
3. Probes the best row sets with `archify validate dataflow --json` (sources stripped) and keeps the first clean one.
4. Fallback: if a label is too wide for the automatic node width, it sets explicit `width` on those nodes (this turns off Archify's automatic showcase sizing for the page — shorten the label instead when you can).

`relax` tries the next-ranked row set, then spreads rows apart (every other row) when a stage uses ≤ 3 rows.

## Writing tips

- One stream per row reads best: a flow between adjacent stages never crosses a node. A flow that skips stages needs empty cells on its row — keep skips rare, or place the node in the stage it actually belongs to.
- More than ~20 nodes or 5 parallel streams → split the page.
