# Quality gates

A run is deliverable only when all of these pass. Report failures plainly; never call a page done on a failed gate.

| Gate | How | Fails when |
|---|---|---|
| Archify | `node scripts/plan.mjs compile <project>` (spec → compiler → `archify finalize`) per page and language; explainers finalize their Markdown | non-zero exit (validate / deliver / check / browser-check) after the compiler's relax rounds |
| Translation shape | `node scripts/i18n.mjs check-pair <vi.json> <en.json>` | IDs, sources, geometry or enum values differ between languages |
| Manifest | `scripts/check-site.mjs` | schema violation, duplicate ids, unknown group |
| Files | `scripts/check-site.mjs` | a manifest file is missing, or a published `.html` is in no manifest (orphan; `src/` and `index.html` excluded) |
| Links | `scripts/check-site.mjs` | `file://`, absolute local paths (`/var/`, `/home/`, `C:\`), or a relative link to a missing file in any published HTML/manifest |
| Coverage | `scripts/check-site.mjs` | an inventory item is in no page `covers` (directly or via its feature) and not in `src/coverage-exclusions.json` |
| Secrets | `scripts/check-site.mjs` | private keys, JWTs, AWS keys, `password=`/`secret=`/`token=` with a literal value, URLs with `user:pass@` |

`check-site.mjs` exits non-zero on any error and prints one line per problem plus a coverage percentage per project.

Visual review is optional (Archify `visual-check`); claim "visually reviewed" only when screenshots were actually inspected.
