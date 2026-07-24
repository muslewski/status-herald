# Status chrome click — implementation plan

> **For agentic workers:** implemented 2026-07-24 with design
> `status-herald-mind/specs/2026-07-24-status-chrome-click-design.md`.

**Goal:** Clickable status-bar pause/resume + paused ▶ glyph; no interval delay.

**Done:**

- [x] `lib/curtain/status-chrome.mjs` — resolve, slot, binds, menu args
- [x] `pause`/`resume`/`disarm`/`arm` wiring
- [x] CLI `status-click` + `status-menu`
- [x] `scripts/status-chrome-menu.sh` compat
- [x] Tests `test/status-chrome.test.mjs`
- [x] Docs BESTIARY / README / CHANGELOG
