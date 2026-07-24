# Curtain scroll → pet Implementation Plan

> **Autopilot run:** implement inline (tightly coupled shell + pure helpers). No execution-choice gate.

**Goal:** Non-scrollable curtain; wheel up/down cycles denizen prev/next.

**Architecture:** Pure roster helpers → session/CLI → card-loop SGR wheel decode.

**Tech Stack:** Node (status-herald), bash card loop, tmux session opts.

## Tasks

### Task 1: prevSpecies + cycleDenizen dir

**Files:** `lib/curtain/denizens.mjs`, `lib/curtain/session.mjs`, `lib/cli.mjs`, `test/card-chrome.test.mjs`, `test/session.test.mjs` (or card-chrome)

### Task 2: card-loop wheel

**Files:** `scripts/curtain-card-session.sh`, `test/curtain-card-session.test.mjs`

### Task 3: ship

CHANGELOG, refresh live cards, commit.
