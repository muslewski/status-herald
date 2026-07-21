# HERALD Bestiary

When the curtain drops, you don’t just get a timer — you get a **denizen**.  
A little creature that shares the stage with your session: same card, same state, same panic when something needs you.

They are pure ASCII. They animate. They are assigned **per tmux session** so a fleet grid looks like a living cast, not a wall of identical icons.

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

---

## Stage rules (so they look right)

- Creature **is** the hero art on non-classic themes (replaces the old mallet/anvil when denizens are on).  
- Subtle motes stay in the background.  
- Card still shows **tmux session name**, timer, and subagent count under the pose.  
- Full art is centered on one vertical axis (ears → eyes → feet). Compact panes get a 3-line form.

---

## Roadmap (not promises — just the hype board)

Ideas people keep asking for:

- More species (raven, moth, little dragon — still ASCII-only)  
- Seasonal hats that never break the centerline  
- Per-repo “house animal” via theme binding  

PRs welcome if the art stays ≤5×12 full / 3×8 compact and every state has a pose. See `lib/curtain/denizens-data.mjs`.

---

*The curtain is the stage. The denizen is the company. You still have to hit the keys.*
