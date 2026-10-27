# Compilers

One module per Archify type: `compilers/<type>.mjs`. `compile-spec.mjs` loads it by the spec's `type`.

```js
export const type = 'workflow';                 // Archify type passed to finalize (defaults to spec.type)
export function compile(spec, ctx) { ... }      // → Archify candidate object (no meta.output / locale / repository: the core sets them)
export function relax(candidate, diagnostics, attempt, spec, ctx) { ... }  // optional → a layout-only variant, or null to give up
```

- `ctx = { lang, archify, repoRoot, repository, quality }` (`archify` = absolute path of the Archify package, for `validate --layout-json` probes; `repoRoot` lets a probe keep `sources` when they change the layout).
- `relax` only runs after a failed finalize. Checks that need a passing receipt (e.g. crossing hints) belong inside `compile` (probe with `archify validate --layout-json`).
- `compile` validates the spec and throws `Error` with a readable message on bad input (unknown ids, missing lanes…).
- Layout (columns, rows, widths, routes, viewBox) is the compiler's job; the spec carries meaning only.
- `relax` may only change geometry or shorten/move text into `detail`/cards — never drop a node, edge, state, entity or source.
- Spec text fields use the names in `i18n.mjs` TEXT_KEYS (`label`, `sublabel`, `title`, `subtitle`, `detail`, `note`, `text`, `items`, `tag`, …), so `i18n.mjs check-pair spec.vi.json spec.en.json` validates a translation.
- Spec format per type: `../../references/specs/<type>.md`. Each compiler ships a sample spec in `samples/<type>.spec.json` that compiles and finalizes.
- New diagram type → add a compiler here (and `references/specs/<type>.md`) instead of authoring candidates by hand.
