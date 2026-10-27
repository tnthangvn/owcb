# Audience

Past feedback that shaped this file: "nó đang thiên về dev quá nhiều, viết cho end user xem" — pages for end users were full of guards, JWKS and controllers.

## End-user / BA pages (`audience: "end-user"`)

- Speak in screens and actions: "Mở màn hình Chấm công → bấm Quét khuôn mặt → thấy dòng giờ vào". Lanes are people/roles and screens, not services.
- One journey per page; the happy path on the main line; what the user sees on failure beside it.
- Keep step labels short: `label` ≤ 24 characters, `sublabel` ≤ 28. Put the rest in `detail`, which the compiler moves into a card. Long labels made Archify's 1240px canvas overflow on several pages in earlier runs.
- Node labels are verbs + screen names. No class names, HTTP methods, table names, env vars, tokens. Technical names may appear only in `sources` (which the viewer shows as evidence, not prose).
- Roles: show who can and cannot do the step (e.g. HR Manager vs Nhân viên) — permission is a user-visible fact.
- Every step still cites the screen/route file that implements it.

## Dev pages (`audience: "dev"`)

- Components, calls, guards, stores, queues, env var **names**, code-backed cards.
- Never secret values; mask anything that looks like a key, password or token (`***`).

## Both (`audience: "both"`)

Make two pages per topic (one end-user, one dev) rather than one page that tries to serve both. The project index groups them so a reader picks a lens; the overview explainer links both.
