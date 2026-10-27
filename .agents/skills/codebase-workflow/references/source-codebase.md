# Source: codebase

The repository is **read-only**. Everything you write goes under `<project>/src/` in the site.

## 1. Freeze identity

```bash
git -C <repo> rev-parse HEAD
git -C <repo> remote get-url origin   # strip user:pass@ before recording
git -C <repo> status --short          # dirty paths: note them in the final reply
```

Archify `meta.repository`: `{ "url": <origin>, "revision": <40-char sha>, "link_mode": "local-only" }` unless the origin is a public GitHub/GitLab/Gitee HTTPS URL the human wants linked. Pages are published publicly, so internal origins stay `local-only`.

## 2. Inventory — enumerate, don't sample

The failure this phase exists to prevent: a previous run covered a handful of screens and missed most of `apps/web/pages`. Enumerate mechanically (find/grep/scripts), then read to describe.

Read project instructions first (`CLAUDE.md`, `AGENTS.md`, `README`, `docs/`), then list every:

| kind | What | Typical evidence |
|---|---|---|
| app | deployable app / service / package | `package.json`, `apps/*`, `libs/*`, compose services |
| page | every UI route/screen of every frontend | router config, `pages/`, `app/` dirs, route arrays |
| api | every endpoint: METHOD path, guard/roles | controllers, route files, OpenAPI |
| table | every model/table and its relations | Prisma schema, migrations, entities |
| state | status enums / state machines and where they change | enums, `status` columns, transition code |
| job | cron, queue consumers, schedulers | `@Cron`, queue processors, PM2 config |
| event | domain events, topics, realtime channels, webhooks | publishers/subscribers, channel names |
| role | roles/permissions and where enforced | guards, decorators, policy tables |
| integration | external systems; env var **names** only | config modules, `.env.example` |
| config | infra worth showing (gateway, compose, deploy) | compose, k8s, deploy scripts |

Evidence must be committed at the pinned revision (`git -C <repo> ls-files --error-unmatch <path>`): generated, vendored or gitignored files fail Archify's evidence check — cite the committed file that produces or declares them instead.

Then group items into **features** a user would recognise (Đăng nhập, Chấm công, Đơn nghỉ phép…), each with roles and a 1–2 sentence Vietnamese summary. Pure infrastructure goes to `feature:platform`.

Write `<project>/src/inventory.json`:

```json
{
  "repo": "/abs/path", "origin": "git@host:group/repo.git", "commit": "<sha>",
  "stack": { "summary": "...", "apps": ["web", "api"] },
  "items": [{ "id": "page:web:/attendance", "kind": "page", "name": "...", "app": "web",
              "evidence": ["apps/web/src/pages/attendance.tsx:12"], "summary_vi": "...", "roles": ["HR"] }],
  "features": [{ "id": "feature:attendance", "title_vi": "...", "title_en": "...", "roles": ["HR"],
                 "items": ["page:web:/attendance", "api:api:POST /attendance"], "summary_vi": "..." }]
}
```

and a readable `inventory.md` (counts per kind, features, uncertain items).

Large repo → this is a light-model task: hand the enumeration to a cheap worker with this file as its brief, then **verify counts yourself** (e.g. `find <app>/pages -name '*.tsx' | wc -l` vs page items) before planning.

## 3. Page plan

Default set for a product codebase (adjust to inventory and Q5):

| Page | Type | Audience | Covers |
|---|---|---|---|
| Tổng quan | explainer | both | all features, one line each, links to pages |
| Sơ đồ màn hình | tree | end-user | every `page` item, grouped by app/feature |
| One journey per feature (or per 2–3 small features) | workflow | end-user | the feature's pages + the user-visible outcome of its APIs |
| Kiến trúc hệ thống | architecture | dev | apps, integrations, config |
| Key request / auth / realtime flows | sequence | dev | the APIs, events and jobs of that flow |
| Dữ liệu | erd — ≤ ~15 tables per page, or ≤ ~25 relationships when one table is a hub (split by feature) | dev | every `table` item |
| Vòng đời trạng thái | lifecycle (one state machine per page, ≤ ~10 states) | both | each important `state` item |
| API theo module | tree or explainer | dev | every `api` item |

Coverage rule: a page's `covers` may list item ids or feature ids (a feature id covers all its items). Every item is covered or listed in `src/coverage-exclusions.json` (`[{ "id", "reason" }]`) — exclusions need a reason a human would accept (generated code, test fixture, dead route confirmed unused).

## 4. Evidence on pages

Workers follow Archify's [repository authoring](../../archify/references/repository-authoring.md): primary elements carry `sources` (path + lines at the pinned revision). End-user pages still cite the screen/route file behind each step, but show no code to the reader (see `audience.md`).
