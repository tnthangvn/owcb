# Source: existing docs / Mermaid

The source path from Q2 holds markdown, HTML, images or Mermaid diagrams (including older generated pages, e.g. a project's `legacy/` folder).

1. List every document and every diagram block in it. Mermaid maps to Archify types per the Archify skill's "Mermaid input" section — read for meaning, author fresh JSON, never copy Mermaid styling.
2. Inventory items: one per diagram, one per documented flow/screen/table; `evidence` is `file:line`.
3. If docs disagree with each other (or with a codebase also given as source), the codebase wins; list the conflict in `src/inventory.md` and on the affected page as a card.
4. Links inside old docs that point to local absolute paths (`file:///var/...`) are a known defect — never carry them over.
5. Migrating an old generated page: keep it under `legacy/` and list it in the manifest group `legacy`, so nothing is lost while the new pages replace it.
