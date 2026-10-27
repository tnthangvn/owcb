# ERD spec (`type: "erd"`)

Semantic only: no `row`/`col`, widths, sides or routes. `scripts/compilers/erd.mjs` does the Archify table-first layout.

```json
{
  "type": "erd",
  "title": "Data: organisation",
  "subtitle": "...",
  "quality": "standard",
  "domains": [ { "id": "d_org", "tag": "Tenant & company" } ],
  "entities": [ {
    "id": "orders", "label": "orders", "domain": "d_org", "ref": "table:db:orders",
    "sources": [ { "path": "prisma/schema/01.prisma", "line": 6, "end_line": 32 } ],
    "attributes": [
      { "name": "id", "type": "uuid", "key": "pk" },
      { "name": "customer_id", "type": "uuid", "key": ["fk", "uk"], "references": "customers.id", "comment": "owner" }
    ]
  } ],
  "relationships": [ { "from": "orders", "to": "customers", "cardinality": "many-to-one", "optional": "to", "identifying": false } ],
  "views": [ { "id": "v1", "label": "Orders", "focus": ["orders", "customers"], "note": "..." } ],
  "cards": [ { "dot": "cyan", "title": "Note", "items": ["..."] } ]
}
```

| Field | Rules |
|---|---|
| `title` (required), `subtitle` | Reader text. |
| `quality` | Optional `standard`/`showcase`. Use `standard` above 8 tables or 50 columns (the generator does). `compile-spec.mjs` reads it unless `--quality` is given. |
| `domains[]` | `id` (language independent) and `tag` (reader text, short). Each domain becomes one solid rectangle of cells (a band). |
| `entities[]` | `id` (the table name, referenced everywhere), `label` (defaults to id), `domain`, `attributes` (required, every physical column), `sources` (1-3), `ref` (inventory id, not rendered). |
| attribute | `name`, `type` (SQL type), `key` (`pk`/`fk`/`uk` or a list), `references` (`"table.column"`, required with `fk`), `comment` (optional). |
| `relationships[]` | `from` (the FK side) -> `to`, `cardinality` = `one\|many`-to-`one\|many`, `optional` = `from\|to\|both` (lowers that end's minimum to zero), `identifying: false` = dashed, `label?`. Self edges are skipped (the FK stays a column); one line per entity pair. |
| `views[]` | Optional guided views; `focus` lists entity ids. |
| `cards[]` | Optional Archify cards. |

What the compiler does for you:
- **Layout.** Domains become rectangles; it orders domains, packs them in shelves of at most ~1500px, orders rows so related tables sit together, and tries several shapes (single column up to a rectangle) keeping the canvas short and relationships short. More than 13 columns or 13 rows is an error: split the page.
- **Widths.** Entity widths come from the longest `name + type` row using Archify's own text model (`erd/attribute-text-capacity` cannot fire); a column of tables shares one width.
- **Comments.** A `comment` is appended to the type as `type｜comment` only when it is at most 30 characters and the table stays under ~290px; otherwise it is left out (put long rules in a card).
- **Foreign keys outside the page.** An `fk` whose `references` names a table/column absent from `entities` loses its `fk` role (the column stays, with its other roles) and is listed in an automatic amber card ("Foreign keys to other pages").
- **Relax** (layout only): pins detouring same-column relationships to a side channel, widens gaps, re-sorts rows; it never drops a table, column, relationship or source.

Translation: ids, `key`, `references`, `type`, `cardinality`, `sources`, `ref` stay identical; text keys change (`title`, `subtitle`, `tag`, `label`, `note`, `items`, cards). The attribute `comment` is not in `i18n.mjs` TEXT_KEYS, so a translated comment would fail `check-pair` until `comment` is added there.

## Generator

```bash
node scripts/gen-erd.mjs --prisma <dir-or-file> [--tables <name>... | --plan <plan.json> --page <id> --inventory <inventory.json>]
     --lang vi|en --out spec.json [--domain-by file|feature] [--domain-map map.json] [--extra fragment.json] [--title ..] [--subtitle ..]
```

- Tables match by `@@map` name or model name; `--plan --page` takes the page's `table:` covers (feature ids expand through the inventory).
- Columns use the `@map` name; types come from `@db.*` (`uuid`, `varchar(50)`, `timestamp(6)`, `decimal(14,2)`...), enums use their DB name, Prisma scalars map to Postgres defaults. Relation list fields are not columns.
- Keys: `@id`/`@@id` -> pk, `@unique` -> uk, `@relation(fields, references)` -> fk with `references` = `target_table.target_column` (composite keys map position by position). `///` doc lines become `comment`.
- Relationships: one per table pair, `many-to-one` from the FK side (`one` when the FK is the pk or unique); an optional FK gets `optional: "to"` + `identifying: false`. Skipped self/duplicate edges add a "Reading the relationships" card.
- Sources: `{path, line, end_line}` of each model, read from `HEAD` of the schema's git repo (files not committed get no sources).
- Domains: one per prisma file by default (name = file stem, humanised). A single `schema.prisma` gives one domain, so pass `--domain-by feature --inventory <inventory.json>`: each table goes to the first inventory feature that lists it (label = the feature title in `--lang`). `--domain-map` maps table name or file stem to a label (`"text"` or `{"vi":..,"en":..}`); the domain id comes from the `vi` label/stem so vi and en specs stay structurally equal.
- `--extra` merges a JSON fragment (`cards`, `views`, `title`, `subtitle`...) into the spec; its cards come first.
