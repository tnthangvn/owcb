# Source: plan / PRD / spec

The source path from Q2 is a plan, PRD, SRS or task breakdown (markdown, docx, pdf exported to text).

1. Extract: actors/roles, functional requirements (keep their IDs, e.g. `FR-12`), screens, business rules, statuses, data entities, non-functional constraints, milestones.
2. Inventory items use kinds `requirement`, `page`, `rule`, `state`, `table`, `milestone` in addition to the codebase kinds; `evidence` is `file:line` (or `file#section`) in the plan.
3. If the plan sits beside a codebase, offer (option question) to cross-check: requirements without code → "chưa làm"; code without requirement → "ngoài plan". Show that as a status column/card, not as a guess.
4. Page plan: overview explainer (scope + status), one workflow per epic/journey, lifecycle per status set, ERD when entities have fields, timeline when the plan has dated milestones.
5. Requirement IDs must appear on the page that covers them so a BA can trace them.
