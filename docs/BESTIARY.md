---
title: "Bestiary"
description: "HERALD denizens — per-session ASCII creatures (fox, cat, owl), poses by state, and config."
section: concepts
order: 20
---

# HERALD Bestiary

When the curtain drops, you don’t just get a timer — you get a **denizen**.  
A little creature that shares the stage with your session: same card, same state, same panic when something needs you.

They are pure ASCII. They animate. They are assigned **per tmux session** so a fleet grid looks like a living cast, not a wall of identical icons.

> **Signature surface.** This page is the public face of curtain denizens. Install and arm: [Getting started](./getting-started.md). Fleet siblings (optional gauges, COMPACTING contract): [Works with](./works-with.md).

---

## Who lives backstage

Each species is locked to a session by a stable hash of the session name  
(override with config if you want a permanent familiar).

### Fox

```
   /\_/\
  ( o.o )
   > ^ <
    ~~~
```

Quick, nosy, always in the wings. Good for sessions that dig and dash — research tabs, short executors, anything that sniffs a trail and moves on.

| State | Mood |
|-------|------|
| WORKING | Bright eyes, bushy tip flicking |
| DONE | Soft smile, little stars |
| NEEDS YOU | Alarm ears, triple bang |
| COMPACTING | zzz in the fur |
| idle | Dozing until the next cue |

COMPACTING is a **distinct card face** (never DONE): hooks map `PreCompact` → compacting so the denizen naps while the agent rewrites context. That vocabulary lines up with [agentic-sage](https://github.com/muslewski/agentic-sage) on the observational compact path — see [interop](./interop-status-herald.md). Herald still answers **per-pane UI**; sage answers fleet hotness.

---

### Cat

```
   /\_/\
  (=^.^=)
   (   )
   |   |
```

Composed. Judgmental. The house cat of the fleet — sits dead center and watches you ship. Perfect for long advisor sessions that should look calm even when the world is on fire.

| State | Mood |
|-------|------|
| WORKING | Classic `=^.^=` stare |
| DONE | ω smile, a single spark |
| NEEDS YOU | Wide eyes, vertical panic |
| COMPACTING | Mid-nap |
| idle | Half-lidded, unimpressed |

---

### Owl

```
   ,___,
  ( o,o )
  /)   (\
    "-"
```

Night watch. Big eyes, tight perch. Feels right on late sessions, docs, and anything that should *look* like it’s thinking carefully.

| State | Mood |
|-------|------|
| WORKING | Wings shift, perched firm |
| DONE | Soft stars between the wings |
| NEEDS YOU | Crest up, big “?!” energy |
| COMPACTING | Tiny z’s |
| idle | Blinks between naps |

---

## How assignment works

1. Session name → deterministic species (`fox` / `cat` / `owl`).  
2. Same session always gets the same creature after restarts.  
3. Different panes in a grid spread across the roster so the wall doesn’t look cloned.  
4. Classic theme stays text-only (no denizens) for the old pure look.

Force a species (optional):

```jsonc
// herald config — curtain.animation.denizens
{
  "enabled": true,
  "species": "owl"   // or "fox" | "cat" | "auto"
}
```

### Chrome (click / keys)

**Primary: status bar** (always visible while armed; installed on `arm` / `arm-all`):

| Control | Where | What it does |
|---------|--------|----------------|
| **Click status** | `MouseDown1Status` | **Toggle** pause ↔ resume for this session |
| **Click status-right** | menu | × off / ▶ on / ↻ pet |
| **▶ curtain** glyph | status-right while paused | Re-enable affordance; click status to resume |
| **× off / ↻ pet** | card dock (when on `_curtain`) or keys `x`/`o`, `a`/`p` | Same pause / pet |

Instant tab-open selects the live pane, so card buttons are secondary — status click works after open.

CLI: `herald curtain pause` / `resume` / `pet` / `status-click` / `status-menu`. Needs `mouse on`.


---

## Stage rules (so they look right)

- Creature **is** the hero art on non-classic themes (replaces the old mallet/anvil when denizens are on).  
- Subtle motes stay in the background.  
- Card still shows **tmux session name**, timer, and subagent count under the pose.  
- Full art is centered on one vertical axis (ears → eyes → feet). Compact panes get a 3-line form.

Denizens live on the **card**. Account **gauges** on the tmux bottom bar (and Claude statusline) are separate: they read **[token-oracle](https://github.com/muslewski/token-oracle)**’s `forecast.json` when present — blank without it, never an error. See [Works with](./works-with.md) and [Getting started](./getting-started.md#bars-and-gauges-optional-siblings).

---

## Roadmap (not promises — just the hype board)

Ideas people keep asking for:

- More species (raven, moth, little dragon — still ASCII-only)  
- Seasonal hats that never break the centerline  
- Per-repo “house animal” via theme binding  

PRs welcome if the art stays ≤5×12 full / 3×8 compact and every state has a pose. See `lib/curtain/denizens-data.mjs`.

---

*The curtain is the stage. The denizen is the company. You still have to hit the keys.*
