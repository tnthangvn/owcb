# Interview

Ask in the human's language (Vietnamese by default). Every question is a list of options; the last option is always **"Khác — tự nhập"**, which takes free text. Put the recommended option first and mark it "(Đề xuất)". With a structured question tool, ask up to 4 related questions per call; its built-in "Other" counts as the "Khác" option. Without one, print numbered options and accept a number or free text.

Skip a question when the human already answered it in the request. Never ask what preflight or the source can tell you.

## Q1 — Nguồn

| Option | Then |
|---|---|
| Codebase có sẵn (Đề xuất khi có repo) | Q2 required → `source-codebase.md` |
| Ý tưởng (chưa có code) | Q2 required (folder chứa mô tả, hoặc repo để đối chiếu) → `source-idea.md` |
| Plan / PRD / spec | Q2 required → `source-plan.md` |
| Tài liệu có sẵn / Mermaid | Q2 required → `source-docs.md` |
| Kết hợp (chọn nhiều) | Q2 once per source |

## Q2 — Path nguồn (asked whenever Q1 involves a codebase, idea, plan or docs)

Options: up to 3 recent paths you can see (from the conversation, the site's existing `manifest.json` `source.repo` values, or the current working directory), then "Khác — nhập path".

Validate before moving on: the path exists; for a codebase it is a git repository (`git -C <path> rev-parse HEAD`). Invalid → say why and ask again. Record `git remote get-url origin` with credentials stripped and the full HEAD sha.

## Q3 — Người đọc

1. Cả hai — có nút chuyển "Người dùng / Kỹ thuật" (Đề xuất)
2. End-user / BA — hành trình trên màn hình, không có code
3. Dev — kiến trúc, API, dữ liệu, code excerpt
4. Khác

## Q4 — Phạm vi

1. Toàn bộ codebase (Đề xuất)
2. Chọn module / app (follow-up: list detected apps/modules as multi-select options)
3. Một luồng cụ thể (follow-up: free text or detected features)
4. Khác

## Q5 — Loại page

1. Tự chọn theo inventory (Đề xuất) — the orchestrator picks from the Archify type router
2. Chọn tay (multi-select): overview, hành trình người dùng (workflow), kiến trúc (architecture), sequence, ERD, vòng đời trạng thái (lifecycle), dataflow, sơ đồ page/module (tree)
3. Khác

## Q6 — Agent làm worker

List only CLIs that `scripts/detect-agents.sh` found, plus "Tự phân theo độ khó (Đề xuất)" and "Chỉ dùng agent hiện tại". Multi-select allowed. The invoking agent always orchestrates; this question only picks workers.

## Q7 — Ngôn ngữ vẽ

1. Song ngữ vi + en (Đề xuất, mặc định)
2. Chỉ tiếng Việt
3. Chỉ tiếng Anh
4. Khác (any language tag; needs a catalog — see `i18n.md`)

## Q8 — Thư mục đích

1. `<site-root>/<project-slug>/` (Đề xuất; slug from the repo folder name, e.g. `customer-order-service` → ask whether to shorten to `orders`)
2. Khác — nhập path

If the folder already holds generated pages, ask: cập nhật phần thay đổi (Đề xuất) / gen lại toàn bộ (old files move to `legacy/`) / Khác.

## After the interview

Echo the answers as a 5–8 line summary and continue without asking for another confirmation; the page-plan confirmation in Phase 3 is the next stop.
