# Packaging

## Layout

```
<site-root>/
  index.html            generated — lists every project
  .nojekyll             generated — GitHub Pages serves folders as-is
  <project>/
    index.html          generated — sidemap of the project
    manifest.json       the only file that describes pages (orchestrator writes it)
    overview.vi.html    overview.en.html
    journeys/           index.html (generated when > 1 page) + <slug>.vi.html / .en.html
    architecture/  data/  states/  api/   (folders per manifest group; names are free)
    legacy/             older pages kept for reference
    src/                inventory, plan, page specs (`pages/<id>/spec.<lang>.json` — the source of truth), staged output, receipts, reports (not linked from the index)
```

Page files are what Archify writes; put each output at its final path (`--out-dir` keeps review evidence in `src/pages/<id>/`).

## Manifest

Schema: `schemas/manifest.schema.json`. Text fields are `{ "vi": "...", "en": "..." }`.

```json
{
  "version": 1,
  "project": "shop",
  "title": { "vi": "Shop — Kiến trúc & luồng nghiệp vụ", "en": "Shop — Architecture & workflows" },
  "summary": { "vi": "...", "en": "..." },
  "languages": ["vi", "en"],
  "source": { "kind": "codebase", "repo": "shop-platform", "commit": "<sha>" },
  "generatedAt": "2026-10-27T15:00:00+07:00",
  "generator": { "skill": "codebase-workflow@1.0", "orchestrator": "claude-opus-5-5", "archify": "3.2.0" },
  "groups": [{ "id": "journeys", "title": { "vi": "Hành trình người dùng", "en": "User journeys" } }],
  "pages": [{
    "id": "login-sso",
    "group": "journeys",
    "title": { "vi": "Đăng nhập SSO", "en": "SSO sign-in" },
    "summary": { "vi": "Các bước từ màn hình đăng nhập đến đúng màn hình theo vai trò", "en": "..." },
    "type": "workflow",
    "audience": "end-user",
    "files": { "vi": "journeys/login-sso.vi.html", "en": "journeys/login-sso.en.html" },
    "covers": ["feature:auth", "page:web:/login"]
  }]
}
```

- `source.repo` is the repository's folder name or public URL — never a local absolute path (the manifest is published).
- Group order = array order; page order inside a group = array order.
- `type`: an Archify type, `explainer`, or `legacy`. `audience`: `end-user`, `dev`, `both`.

## Who writes what

| File | Writer |
|---|---|
| `manifest.json` | orchestrator only (merge worker results) |
| any `index.html`, `.nojekyll` | `scripts/build-site.mjs` only — never an agent |
| page HTML + `src/pages/<id>/` | the worker assigned that page |
| `src/inventory.*`, `src/coverage-exclusions.json`, `src/run-report.json` | orchestrator (may delegate inventory to a light worker) |

## Site tooling

On the first run in a site root, copy `templates/site/Makefile` to the root (paths assume the skill at `.agents/skills/codebase-workflow`) and append `templates/site/gitignore.snippet` to `.gitignore`. Then `make site P=<project>` = compile + build + check, `make serve` previews, `make clean` deletes what failed runs left behind (failed or unfinished `review-*` folders, stale or failed candidate attempts, pending receipts) and passing review folders replaced by a newer pass of the same page and language (`KEEP=all` keeps every pass); `make clean-all` wipes all regenerable work files (`review-*`, `build-*/`, `compiled/`, `out/`, `receipts/`, `worker.log`). Specs, plans, inventories, reports, generator inputs and published pages are kept and committed.

## Build

```bash
node <skill>/scripts/build-site.mjs <site-root>
```

Also injects a **breadcrumb bar** at the top of every published page listed in the manifest (between `<!--cw-crumb-->` markers, so rebuilding replaces it): `Project › Group › Page`, linking to `<project>/index.html?lang=<lang>` and to the folder index (or the group anchor) — plus links to the same page in the other languages. The staged Archify output under `src/pages/<id>/out/` stays untouched; only the published copy carries the breadcrumb. The index honours `?lang=` over the viewer's remembered language.

Renders from `templates/site/` (layout, CSS and JS inlined into every index, so each index works alone from `file://`). Changing the look = edit the template and rebuild; no page is regenerated.
