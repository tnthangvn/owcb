# Sequence spec

`"type": "sequence"` → `scripts/compilers/sequence.mjs` → Archify sequence v1. Semantic only: no `y`, widths, viewBox or segment bounds. Sample: `scripts/compilers/samples/sequence.spec.json`.

```json
{ "type": "sequence", "title": "...", "subtitle": "...",
  "participants": [{ "id": "web", "kind": "frontend", "label": "Web app", "sublabel": "React", "sources": [{ "path": "apps/web/x.ts", "line": 10 }] }],
  "phases": [{ "label": "1. Request", "from": "open", "to": "get" }],
  "messages": [{ "id": "get", "from": "web", "to": "api", "label": "GET /x", "kind": "call", "tone": "main", "note": "..." }],
  "notes": [{ "message": "get", "text": "..." }],
  "activations": [{ "participant": "api", "from": "get", "to": "ok" }],
  "cards": [{ "title": "...", "items": ["..."], "dot": "rose" }] }
```

## Fields

| Field | Rules |
|---|---|
| `title`, `subtitle?` | reader text |
| `participants[]` | `id`, `kind` (frontend, backend, database, cloud, security, messagebus, external), `label` (keep ≤ ~16 chars, it is a narrow box), `sublabel?` (short), `sources` 1-3. Order = left to right |
| `messages[]` | in time order. `from`, `to`, `label`, `id?` (needed if a phase, note or activation refers to it), `kind?`, `tone?`, `note?` |
| `messages[].kind` | `call` (default, solid), `return` (quiet), `async` (dashed), `self` (internal step: only `from`) |
| `messages[].tone` | `main` (emphasis, the primary request path) or `security` (auth, policy). Ignored on return/async |
| `phases[]` | `label` + `from`/`to` (message id or 0-based index) or `ids: [...]`. Disjoint, in order. Optional |
| `notes[]` | extra note text for a message (`message` = id or index); joined to its `note` |
| `activations[]` | `participant`, `from`, `to` message ids; the bar spans those messages. Optional |
| `cards[]` | `title`, `items[]`, `dot?` ∈ cyan, emerald, violet, amber, rose, orange, slate (cycled when omitted) |

## What the compiler does

- Spacing: 30px per plain message; a note adds enough room for its estimated wrapped lines (notes wrap at about 100px); a new phase adds air for its title. Segments and activation bars are derived from the messages.
- `self` messages become text appended to the note of the nearest real message of that participant (Archify draws no self loops). The meaning and order are kept.
- Labels over ~44 text units are cut at a natural boundary; the remainder moves to the front of the note.
- `relax` reacts to `sequence/note-overlap` (pushes later messages down by the exact `requiredY`), `segment-label-overlap`, `segment-message-border-run`, 28px and label-overlap errors (shorter labels). Never drops a message, note or source.
- i18n: only `title`, `subtitle`, `label`, `sublabel`, `note`, `text`, `items` differ between languages; ids, kinds, tones, sources paths, phase refs stay identical.

## Authoring tips

Keep participants to 4-7. One note per message is easy to read; if a note needs 4+ lines, put it in a card. Put the main request path on `tone: main`. Do not invent a participant to avoid a self message.
