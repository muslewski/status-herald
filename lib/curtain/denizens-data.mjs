// Authored denizen art (Act II). Separated from logic so a look-pack/bestiary
// can grow without touching selection code. Each cel is a RECTANGULAR block of
// whitespace-safe rows (spaces = transparent; ink paints only into base-art
// whitespace).
//
// RECONCILE R1 (authoritative): full ≤ 5×12, compact ≤ 3×8.
// States (all required): working, done, needs, compacting, idle.
// Frames ≤ 8 per pose.

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

// fox — pointy ears, snout, bushy tail hints
const fox = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        f(["  /\\_/\\", " ( o.o )~", "  > ^ <", "   ~~~"]),
        f(["  /\\_/\\", " ( o.o)~ ", "  > ^ <", "  ~~~ "]),
      ],
      compact: [
        c([" /o.o\\~", "  >^<", "  ~~~"]),
        c([" /o.o~\\", "  >^<", " ~~~ "]),
      ],
    },
    done: {
      full: [
        f(["  /\\_/\\", " ( ^.^ )*", "  \\___/", "   * *"]),
        f(["  /\\_/\\", " ( ^.^)* ", "  \\___/", "  * * "]),
      ],
      compact: [
        c([" /^.^\\*", "  \\_/", "  * *"]),
        c([" /^.^*/", "  \\_/", " * * "]),
      ],
    },
    needs: {
      full: [
        f(["  /\\!_!\\", " ( o.o )?", "  > ! <", "   !!!"]),
        f(["  /\\!_!\\", " ( O.O )?", "  > ! <", "  ! ! "]),
      ],
      compact: [
        c([" /o.o\\?", "  >!<", "  !?!"]),
        c([" /O.O\\?", "  >!<", " !?! "]),
      ],
    },
    compacting: {
      full: [
        f(["  /\\z_z\\", " ( -.- ) ", "  > z <", "   zzz"]),
        f(["  /\\ z_z/", " ( -.-)z ", "  > z <", "  zzz "]),
      ],
      compact: [
        c([" /-.-\\z", "  >z<", "  zz "]),
        c([" /-.-z\\", "  >z<", " zz  "]),
      ],
    },
    idle: {
      full: [
        f(["  /\\___/", " ( -.- ) ", "  >   <", "   ^-^"]),
        f(["  /\\___/", " ( o.o ) ", "  >   <", "  ^-^ "]),
      ],
      compact: [
        c([" /-.-\\ ", "  > <", "  ^-^"]),
        c([" /o.o\\ ", "  > <", " ^-^ "]),
      ],
    },
  },
};

// cat — taller ears, (=^.^=) vibe, whiskers
const cat = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        f(["  /\\_/\\  ", " (=^.^=)/", "  (   ) ", "  |   | "]),
        f(["  /\\_/\\  ", " (=^.^=)\\", "  (   ) ", "  |   | "]),
      ],
      compact: [
        c(["/=^.^=/", " (   )", " |   |"]),
        c(["/=^.^=\\", " (   )", " |   |"]),
      ],
    },
    done: {
      full: [
        f(["  /\\_/\\  ", " (=^ω^=)*", "  (   ) ", "  | * | "]),
        f(["  /\\_/\\  ", "*(=^ω^=) ", "  (   ) ", "  | * | "]),
      ],
      compact: [
        c(["/=^ω^=*", " (   )", " | * |"]),
        c(["*=^ω^=\\", " (   )", " | * |"]),
      ],
    },
    needs: {
      full: [
        f(["  /\\_/\\  ", " (=o.o=)?", "  ( ! ) ", "  |!!!| "]),
        f(["  /\\_/\\  ", " (=O.O=)?", "  ( ! ) ", "  |! !| "]),
      ],
      compact: [
        c(["/=o.o=?", " ( ! )", " |!!!|"]),
        c(["/=O.O=?", " ( ! )", " |! !|"]),
      ],
    },
    compacting: {
      full: [
        f(["  /\\_/\\  ", " (=-.-=)z", "  (   ) ", "  |zzz| "]),
        f(["  /\\_/\\  ", "z(=-.-=) ", "  (   ) ", "  |zz | "]),
      ],
      compact: [
        c(["/=-.- =z", " (   )", " |zzz|"]),
        c(["z=-.-=\\", " (   )", " |zz |"]),
      ],
    },
    idle: {
      full: [
        f(["  /\\_/\\  ", " (=-.-=) ", "  (   ) ", "  |   | "]),
        f(["  /\\_/\\  ", " (=^.^=) ", "  (   ) ", "  |   | "]),
      ],
      compact: [
        c(["/=-.- = ", " (   )", " |   |"]),
        c(["/=^.^=  ", " (   )", " |   |"]),
      ],
    },
  },
};

// owl — round head, big eyes, perched.
// Full 12-wide axis is col 5 (center of ,___,, eyes o,o, perch -).
// Compact 8-wide axis is col 2 (center of ,___,, (o,o), perch -).
const owl = {
  tiers: { full: { ...FULL }, compact: { ...COMPACT } },
  poses: {
    working: {
      full: [
        //   012345678901
        f(["   ,___,    ", "  ( o,o )   ", "  /)   (\\   ", '    "-"     ']),
        f(["   ,___,    ", "  ( o,o )   ", "  (\\   /)   ", '    "-"     ']),
      ],
      compact: [
        // 01234567
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
        f(["   ,___,    ", "  ( -,- ) z ", "  (\\ z /)   ", '    "-"     ']),
      ],
      compact: [
        c([",___,   ", "(-,-)   ", " zzz    "]),
        c([",___,   ", "(-,-)z  ", "  zz    "]),
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
