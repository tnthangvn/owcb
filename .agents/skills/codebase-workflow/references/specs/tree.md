# Tree spec (`type: "tree"`)

Semantic only: no coordinates, widths or routes. `scripts/compilers/tree.mjs` flattens it to an Archify tree candidate and picks the direction (`right` when it has more than 24 leaves or is 4+ levels deep, else `down`); the Archify renderer places 100-300 leaves without help.

```json
{
  "type": "tree",
  "title": "Screen map",
  "subtitle": "One sentence on what the links mean",
  "direction": "right",
  "root": { "id": "root", "label": "App", "sublabel": "132 screens", "children": [ { "id": "...", "label": "...", "children": [] } ] },
  "cards": [ { "dot": "cyan", "title": "How to read", "items": ["..."] } ]
}
```

| Field | Rules |
|---|---|
| `title` (required), `subtitle` | Reader text. |
| `direction` | Optional `down` or `right`; omit to let the compiler choose. |
| `root` (required) | One node. Everything else hangs under `children`. |
| node `id` | Optional; made unique and Archify-safe. |
| node `label` (required) | Short name; it wraps between words. |
| node `sublabel` | One short line (truncated at 120 characters). |
| node `tag` | Short chip word (Redirect, Tab, Unfinished...). The tree schema has no tag field, so it is written in front of the sublabel as `tag · sublabel`. |
| node `detail` | Used only as the sublabel when `sublabel` is absent (the tree schema has no detail field). |
| node `sources` | 1-3 `{path, line, end_line?}` (or `"path:line"` strings). Paths must be committed at the pinned revision; `compile-spec.mjs` needs `--repo-root` whenever any node has sources. |
| node `ref` | Not rendered. The inventory id this node represents (`page:web:/login`); the coverage check searches the spec for these. |
| node `children` | Ordered list of nodes. |
| `cards` | Optional Archify cards (`dot`, `title`, `items`). |

Rules: containment only (no calls or cross-branch links); never put the same node twice; do not invent nodes the source does not show.

Translation: keep ids, `ref`, `sources`, `dot`, structure identical; change only text keys (`title`, `subtitle`, `label`, `sublabel`, `tag`, `detail`, cards). `node scripts/i18n.mjs check-pair spec.vi.json spec.en.json` verifies it.

`relax` (layout only): flips direction, then widens gaps and `nodeMaxW`. It never drops a node.

## Generator

```bash
node scripts/gen-tree.mjs <inventory.json> --kind page|api [--group-by app|feature|controller]
     [--covers <id>... | --plan <plan.json> --page <id>] --lang vi|en --out spec.json
     [--dict vi-to-en.json] [--title ..] [--subtitle ..]
```

- `--kind page`: `page` items nested by route (a `/x#tab` or `/x/child` item sits under `/x` when `/x` is in the same group); grouped by `feature` (default, from `inventory.features`) or `app`. Tags come from the inventory notes: redirect, stub/unfinished, legacy, tab, dialog/drawer/panel, wizard step, section, outside the SPA.
- `--kind api`: endpoint leaves (`METHOD /path`, sublabel = short description, tag = the permission when it is a single `a:b` code); controllers come from `handler=` in the notes. `controller` (default) = controller -> endpoint, `feature` = feature -> controller -> endpoint.
- Selection: `--covers` takes item or feature ids; `--plan --page` takes the page's `covers`. Every selected item must land in the tree or the script fails.
- Sources: first 3 evidence entries that are tracked by git in `inventory.repo` (untracked/gitignored paths are dropped, per the committed-evidence rule).
- `--lang en`: feature titles, tags, root label, cards use English; inventory descriptions exist only in Vietnamese, so they are translated through `--dict` (an object `{ "vi text": "en text" }`). Strings with no entry are written to `<out>.untranslated.json` for a translator pass; rerun with the extended dict.
