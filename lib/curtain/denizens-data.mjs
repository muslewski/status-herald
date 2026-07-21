// Authored denizen art (Act II). Separated from logic so a look-pack/bestiary
// can grow without touching selection code. Each cel is a RECTANGULAR block of
// whitespace-safe rows (spaces = transparent).
//
// RECONCILE R1 (authoritative): full ≤ 5×12, compact ≤ 3×8.
// States (all required): working, done, needs, compacting, idle.
// Frames ≤ 8 per pose.
//
// Alignment (full 12-wide): vertical center axis is **col 5**.
// Alignment (compact 8-wide): vertical center axis is **col 2**.
// Every ink row should share that midline (ears, face, body, feet).

/** Pad/truncate every line to cols; pad frame to rows with blank lines. */
const frame = (rows, cols, lines) => {
  const out = [];
  for (let i = 0; i < rows; i++) {
    const l = String(lines[i] ?? "");
    out.push((l + " ".repeat(cols)).slice(0, cols));
  }
  return out;
};

const FULL = { rows: 5, cols: 12 };
const COMPACT = { rows: 3, cols: 8 };
const f = (lines) => frame(FULL.rows, FULL.cols, lines);
const c = (lines) => frame(COMPACT.rows, COMPACT.cols, lines);

// ── fox ─────────────────────────────────────────────────────────────────────
// Pointy ears, bright eyes, bushy tip. Axis col 5 full / col 2 compact.
const fox = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        //   012345678901
        f(["   /\\_/\\    ", "  ( o.o )   ", "   > ^ <    ", "    ~~~     "]),
        f(["   /\\_/\\    ", "  ( o.o )   ", "   > ^ <    ", "   ~ ~ ~    "]),
      ],
      compact: [
        // 01234567
        c([" /\\_/\\  ", "( o.o ) ", "  ~~~   "]),
        c([" /\\_/\\  ", "( o.o ) ", " ~ ~ ~  "]),
      ],
    },
    done: {
      full: [
        f(["   /\\_/\\    ", "  ( ^.^ )   ", "   \\___/    ", "    * *     "]),
        f(["   /\\_/\\    ", "  ( ^.^ )   ", "   \\___/    ", "   *   *    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "( ^.^ ) ", "  * *   "]),
        c([" /\\_/\\  ", "( ^.^ ) ", " *   *  "]),
      ],
    },
    needs: {
      full: [
        f(["   /\\!_!\\   ", "  ( o.o )   ", "   > ! <    ", "    !!!     "]),
        f(["   /\\!_!\\   ", "  ( O.O )   ", "   > ! <    ", "   ! ! !    "]),
      ],
      compact: [
        // ears as /!\! short form to keep axis col 2
        c([" /\\_/\\  ", "( o.o ) ", "  !?!   "]),
        c([" /\\_/\\  ", "( O.O ) ", " ! ? !  "]),
      ],
    },
    compacting: {
      full: [
        f(["   /\\_/\\    ", "  ( -.- )   ", "   > z <    ", "    zzz     "]),
        f(["   /\\_/\\    ", "  ( -.- )   ", "   > z <    ", "   z z z    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "( -.- ) ", "  zzz   "]),
        c([" /\\_/\\  ", "( -.- ) ", " z z z  "]),
      ],
    },
    idle: {
      full: [
        f(["   /\\_/\\    ", "  ( -.- )   ", "   >   <    ", "    ^-^     "]),
        f(["   /\\_/\\    ", "  ( o.o )   ", "   >   <    ", "    ^-^     "]),
      ],
      compact: [
        c([" /\\_/\\  ", "( -.- ) ", "  ^-^   "]),
        c([" /\\_/\\  ", "( o.o ) ", "  ^-^   "]),
      ],
    },
  },
};

// ── cat ─────────────────────────────────────────────────────────────────────
// Tall ears, (=^.^=) face, straight legs. Axis col 5 full / col 2 compact.
const cat = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        f(["   /\\_/\\    ", "  (=^.^=)   ", "   (   )    ", "   |   |    "]),
        f(["   /\\_/\\    ", "  (=^.^=)   ", "   (   )    ", "   /   \\    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "(=^.^=) ", " |   |  "]),
        c([" /\\_/\\  ", "(=^.^=) ", " /   \\  "]),
      ],
    },
    done: {
      full: [
        f(["   /\\_/\\    ", "  (=^ω^=)   ", "   (   )    ", "   | * |    "]),
        f(["   /\\_/\\    ", "  (=^ω^=)   ", "   ( * )    ", "   |   |    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "(=^ω^=) ", " | * |  "]),
        c([" /\\_/\\  ", "(=^ω^=) ", " |   |  "]),
      ],
    },
    needs: {
      full: [
        f(["   /\\_/\\    ", "  (=o.o=)   ", "   ( ! )    ", "   |!!!|    "]),
        f(["   /\\_/\\    ", "  (=O.O=)   ", "   ( ! )    ", "   |! !|    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "(=o.o=) ", " |!!!|  "]),
        c([" /\\_/\\  ", "(=O.O=) ", " |! !|  "]),
      ],
    },
    compacting: {
      full: [
        f(["   /\\_/\\    ", "  (=-.-=)   ", "   (   )    ", "   |zzz|    "]),
        f(["   /\\_/\\    ", "  (=-.-=)   ", "   ( z )    ", "   |zz |    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "(=-.-=) ", " |zzz|  "]),
        c([" /\\_/\\  ", "(=-.-=) ", " |zz |  "]),
      ],
    },
    idle: {
      full: [
        f(["   /\\_/\\    ", "  (=-.-=)   ", "   (   )    ", "   |   |    "]),
        f(["   /\\_/\\    ", "  (=^.^=)   ", "   (   )    ", "   |   |    "]),
      ],
      compact: [
        c([" /\\_/\\  ", "(=-.-=) ", " |   |  "]),
        c([" /\\_/\\  ", "(=^.^=) ", " |   |  "]),
      ],
    },
  },
};

// ── owl ─────────────────────────────────────────────────────────────────────
// Round head, big eyes, perched. Axis col 5 full / col 2 compact.
const owl = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        f(["   ,___,    ", "  ( o,o )   ", "  /)   (\\   ", '    "-"     ']),
        f(["   ,___,    ", "  ( o,o )   ", "  (\\   /)   ", '    "-"     ']),
      ],
      compact: [
        c([",___,   ", "(o,o)   ", ' "-"    ']),
        c([",___,   ", "(o,o)   ", '  "-"   ']),
      ],
    },
    done: {
      full: [
        f(["   ,___,    ", "  ( ^,^ )   ", "  /) * (\\   ", '    "-"     ']),
        f(["   ,___,    ", "  ( ^,^ )   ", "  (\\ * /)   ", '    "-"     ']),
      ],
      compact: [
        c([",___,   ", "(^,^)   ", " *-*    "]),
        c([",___,   ", "(^,^)   ", "  *-*   "]),
      ],
    },
    needs: {
      full: [
        f(["   ,!_!,    ", "  ( o,o )   ", "  /) ? (\\   ", '    "!"     ']),
        f(["   ,!_!,    ", "  ( O,O )   ", "  (\\ ? /)   ", '    "!"     ']),
      ],
      compact: [
        c([",!_!,   ", "(o,o)   ", " ?!?    "]),
        c([",!_!,   ", "(O,O)   ", "  ?!?   "]),
      ],
    },
    compacting: {
      full: [
        f(["   ,___,    ", "  ( -,- )   ", "  /) z (\\   ", '    "-"     ']),
        f(["   ,___,    ", "  ( -,- )   ", "  (\\ z /)   ", '    "-"     ']),
      ],
      compact: [
        c([",___,   ", "(-,-)   ", " zzz    "]),
        c([",___,   ", "(-,-)   ", "  zz    "]),
      ],
    },
    idle: {
      full: [
        f(["   ,___,    ", "  ( -,- )   ", "  /)   (\\   ", '    "-"     ']),
        f(["   ,___,    ", "  ( o,o )   ", "  /)   (\\   ", '    "-"     ']),
      ],
      compact: [
        c([",___,   ", "(-,-)   ", ' "-"    ']),
        c([",___,   ", "(o,o)   ", ' "-"    ']),
      ],
    },
  },
};

export const DENIZENS = { fox, cat, owl };
