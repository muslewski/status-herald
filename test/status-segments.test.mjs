import assert from "node:assert/strict";
import { test } from "node:test";

import { tmuxColor, visibleWidth } from "../lib/render.mjs";

import {
  ROLES,
  gaugeRole,
  orderSegments,
  renderLine,
  roleColor,
} from "../lib/status/segments.mjs";

test("visibleWidth strips tmux markup (for status engine)", () => {
  assert.equal(visibleWidth("#[fg=colour46]hi#[default]"), 2);
});

test("tmuxColor wraps text with tmux fg and default reset", () => {
  assert.equal(tmuxColor("hi", "colour46"), "#[fg=colour46]hi#[default]");
});

test("roleColor tmux mode uses ROLES tmux color via tmuxColor", () => {
  assert.equal(roleColor("ok", "tmux")("x"), "#[fg=colour46]x#[default]");
});

test("roleColor ansi mode produces SGR via color helper", () => {
  const out = roleColor("dim", "ansi")("x");
  assert.ok(
    out.includes("\x1b[90m"),
    `expected ansi gray, got ${JSON.stringify(out)}`,
  );
});

test("roleColor plain is identity", () => {
  assert.equal(roleColor("ok", "plain")("x"), "x");
});

test("roleColor unknown role is identity (no throw)", () => {
  assert.equal(roleColor("bogus", "tmux")("hi"), "hi");
  assert.equal(roleColor("weird", "ansi")("hi"), "hi");
  assert.equal(roleColor(null, "plain")("hi"), "hi");
});

test("gaugeRole boundaries: <85 ok, [85,100) warn, [100,120) crit, >=120 over; non-finite ok", () => {
  assert.equal(gaugeRole(84), "ok");
  assert.equal(gaugeRole(85), "warn");
  assert.equal(gaugeRole(99), "warn");
  assert.equal(gaugeRole(100), "crit");
  assert.equal(gaugeRole(119), "crit");
  assert.equal(gaugeRole(120), "over");
  assert.equal(gaugeRole(Number.NaN), "ok");
  assert.equal(gaugeRole(Number.POSITIVE_INFINITY), "ok");
  assert.equal(gaugeRole(-5), "ok");
});

test("orderSegments enables via config, reorders by effective order, drops disabled", () => {
  const registry = {
    a: { enabled: true, order: 2 },
    b: { enabled: false, order: 1 },
    c: { enabled: true, order: 0 },
  };
  // flip b on, bump a later
  let out = orderSegments(registry, {
    segments: { b: { enabled: true }, a: { order: 5 } },
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["c", "b", "a"],
  );

  // config disabling c drops c (a remains enabled in base; b remains disabled)
  out = orderSegments(registry, { segments: { c: { enabled: false } } });
  assert.deepEqual(
    out.map((s) => s.id),
    ["a"],
  );
});

test("orderSegments shallow merges including priority, returns objects with id", () => {
  const registry = {
    x: { enabled: true, order: 10, priority: 3, foo: "bar" },
  };
  const out = orderSegments(registry, {
    segments: { x: { order: 0, priority: 99 } },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "x");
  assert.equal(out[0].enabled, true);
  assert.equal(out[0].order, 0);
  assert.equal(out[0].priority, 99);
  assert.equal(out[0].foo, "bar"); // from base
});

test("renderLine unlimited width returns all full texts joined (plain)", () => {
  const items = [
    { id: "a", text: "longone", role: "ok", priority: 10 },
    { id: "b", text: "short", role: "warn", priority: 5 },
  ];
  const out = renderLine(items, { mode: "plain", width: null, sep: "  " });
  assert.equal(out, "longone  short");
});

test("renderLine when fits within width uses full texts", () => {
  const items = [
    { id: "x", text: "abc", role: "ok", priority: 1 },
    { id: "y", text: "def", role: "ok", priority: 2 },
  ];
  const out = renderLine(items, { mode: "plain", width: 20, sep: "  " });
  assert.equal(out, "abc  def");
  assert.ok(visibleWidth(out) <= 20);
});

test("renderLine shorten uses short of lowest-priority item first", () => {
  const items = [
    { id: "hi", text: "HIGHPRI", short: "HI", role: "ok", priority: 100 },
    {
      id: "lo",
      text: "LOWPRIORITYLONG",
      short: "LO",
      role: "warn",
      priority: 1,
    },
  ];
  // width fits "HIGHPRI  LO" (7+2+2=11) but not full "HIGHPRI  LOWPRIORITYLONG"
  const out = renderLine(items, { mode: "plain", width: 12, sep: "  " });
  assert.equal(out, "HIGHPRI  LO");
});

test("renderLine drops lowest-priority items (rightmost on ties) until fits or 1 left", () => {
  const items = [
    { id: "p1", text: "A", role: "ok", priority: 10 },
    { id: "p2", text: "B", role: "ok", priority: 1 },
    { id: "p3", text: "C", role: "ok", priority: 1 },
  ];
  // very narrow: only highest (p1 prio10) should survive
  const out = renderLine(items, { mode: "plain", width: 1, sep: "  " });
  assert.equal(out, "A");
});

test("renderLine multi-drop tie-breaks rightmost-lowest first (deterministic)", () => {
  // Weak old fixture (X/Y/Z width=1) only asserted final sole survivor "X", which is
  // identical whether B or C drops first — false confidence on rightmost order.
  // Strong fixture: intermediate survivor string differs by which low-pri is dropped.
  // Full "AAA  B  C" = 9; "AAA  B" = "AAA  C" = 6. Width 6 fits only after one drop.
  // Rightmost-lowest first → drop C → "AAA  B". Leftmost-first wrong order → "AAA  C".
  const items = [
    { id: "a", text: "AAA", role: "ok", priority: 5 },
    { id: "b", text: "B", role: "ok", priority: 1 },
    { id: "c", text: "C", role: "ok", priority: 1 },
  ];
  const out = renderLine(items, { mode: "plain", width: 6, sep: "  " });
  assert.equal(out, "AAA  B");
  assert.notEqual(
    out,
    "AAA  C",
    "must drop rightmost low-pri (c), not leftmost (b)",
  );
});

test("ROLES table matches plan 018 semantic palette", () => {
  assert.deepEqual(ROLES, {
    ok: { ansi: 32, tmux: "colour46" },
    notice: { ansi: 36, tmux: "colour51" },
    warn: { ansi: 33, tmux: "colour226" },
    crit: { ansi: 31, tmux: "colour196" },
    over: { ansi: 91, tmux: "colour201" },
    accent: { ansi: 93, tmux: "colour214" },
    dim: { ansi: 90, tmux: "colour244" },
  });
});

test("renderLine width decisions are on plain text even in tmux mode; result markup width ok", () => {
  const items = [
    { id: "a", text: "foo", short: "f", role: "ok", priority: 10 },
    { id: "b", text: "barbarbar", short: "b", role: "warn", priority: 1 },
  ];
  const plainOut = renderLine(items, { mode: "plain", width: 5, sep: " " });
  const tmuxOut = renderLine(items, { mode: "tmux", width: 5, sep: " " });
  // drop decisions should match: b shortens or drops; here width=5 forces use short on b? "foo b" =5
  assert.equal(plainOut, "foo b");
  // tmux output has markup but its visible width must be <=5 and equal plain decision
  assert.equal(visibleWidth(tmuxOut), visibleWidth(plainOut));
  assert.ok(visibleWidth(tmuxOut) <= 5);
  // and contains the tmux markup for roles
  assert.match(tmuxOut, /#\[fg=colour46\]foo#\[/);
  assert.match(tmuxOut, /#\[fg=colour226\]b#\[/);
});

// --- Plan 020 segment builders + registry ---

import {
  REGISTRY,
  buildAccountSliderItem,
  buildContextItem,
  buildModelItem,
  buildSageItem,
  buildStateItem,
  formatCtxbarForTmux,
} from "../lib/status/segments.mjs";

test("buildContextItem parity plain core (emoji band, bar8, pct, used/win, msgs)", () => {
  const item = buildContextItem({
    used: 351000,
    win: 1000000,
    pct: 35,
    messages: 5,
  });
  assert.equal(item.id, "context");
  assert.equal(item.role, gaugeRole(35));
  assert.equal(item.priority, 100);
  // 351000 // 100000 = 3 → 😐; filled = round(0.35*8)=3
  assert.equal(item.text, "😐 ███░░░░░ 35% 351k/1M 💬 5");
  assert.equal(item.short, "😐 35%");
  // Plain text (no ANSI/tmux markup); emoji count as wide in visibleWidth.
  assert.equal(item.text.includes("#[fg="), false);
  assert.ok(visibleWidth(item.text) >= 20);
});

test("formatCtxbarForTmux embeds ctx_bucket color + 💬 message count", () => {
  const s = formatCtxbarForTmux({
    used: 375752,
    win: 500000,
    pct: 75,
    messages: 25,
  });
  // 375752 // 100000 = 3 → 😐; filled = round(0.75*8)=6; pct>50 → red
  assert.equal(s, "😐 #[fg=red]██████░░ 75% 375k/500k 💬 25#[default]");
});

test("buildContextItem shows 500k window label for Grok", () => {
  const item = buildContextItem({
    used: 120000,
    win: 500000,
    pct: 24,
    messages: 7,
  });
  assert.match(item.text, /120k\/500k/);
  assert.match(item.text, /💬 7/);
});

test("buildAccountSliderItem 5h from used+cap (Python _slider plain core)", () => {
  // 2.7M / 57.0M ≈ 4.74% → empty bar, notice (cyan) role
  const item = buildAccountSliderItem("account5h", {
    used: 2700000,
    cap: 57000000,
  });
  assert.equal(item.id, "account5h");
  assert.equal(item.role, "notice");
  assert.equal(item.text, "🕐 ░░░░░░░░ 2.7M/57.0M");
  assert.equal(item.short, "🕐 2.7M");
  assert.equal(item.priority, 30);
});

test("buildAccountSliderItem weekly from usedPercentage + cap", () => {
  const item = buildAccountSliderItem("accountWeekly", {
    usedPercentage: 50,
    cap: 270000000,
  });
  assert.equal(item.id, "accountWeekly");
  assert.equal(item.role, "ok"); // 50% → ok (green band)
  assert.equal(item.priority, 20);
  // used = round(0.5 * 270M) = 135000000 → 135.0M
  assert.equal(item.text, "📅 ████░░░░ 135.0M/270.0M");
});

test("buildModelItem / buildStateItem null on empty", () => {
  assert.equal(buildModelItem(""), null);
  assert.equal(buildStateItem(""), null);
  assert.deepEqual(buildModelItem("Opus 🧠xhigh"), {
    id: "model",
    text: "Opus 🧠xhigh",
    role: "accent",
    priority: 60,
  });
  assert.deepEqual(buildStateItem("▶"), {
    id: "state",
    text: "▶",
    role: "dim",
    priority: 90,
  });
});

test("buildStateItem: WORKING gets accent (amber colour214), else dim", () => {
  assert.deepEqual(buildStateItem("●", "working"), {
    id: "state",
    text: "●",
    role: "accent",
    priority: 90,
  });
  // back-compat: no state / non-working → dim (unchanged)
  assert.deepEqual(buildStateItem("▶"), {
    id: "state",
    text: "▶",
    role: "dim",
    priority: 90,
  });
  assert.equal(buildStateItem("⏸", "idle").role, "dim");
  assert.equal(ROLES.accent.tmux, "colour214"); // amber == wash working hue
});

test("REGISTRY + orderSegments respects bars.segments enabled/order/priority", () => {
  const ordered = orderSegments(REGISTRY, {
    segments: {
      model: { enabled: true },
      account5h: { enabled: false },
      clock: { enabled: false },
      notify: { enabled: false },
    },
  });
  const ids = ordered.map((s) => s.id);
  assert.ok(ids.includes("context"));
  assert.ok(ids.includes("model"));
  assert.ok(ids.includes("state"));
  assert.ok(!ids.includes("account5h"));
  // order: context 10, state 15, model 20, accountWeekly 60
  assert.deepEqual(
    ids.filter((id) =>
      ["context", "state", "model", "accountWeekly"].includes(id),
    ),
    ["context", "state", "model", "accountWeekly"],
  );
});

test("REGISTRY render fns produce items from compute-shaped ctx", () => {
  const ctx = {
    session: {
      context: { used: 351000, win: 1000000, pct: 35, messages: 5 },
      modelBadge: "Opus 🧠xhigh",
      stateGlyph: "▶",
    },
    account: {
      fiveHour: { usedPercentage: 12.3 },
      weekly: { usedPercentage: 45 },
      caps: { fiveHourCap: 57000000, weeklyCap: 270000000 },
    },
    clockText: "14:30",
    notifyIcon: "🌙",
  };
  const ctxItem = REGISTRY.context.render(ctx);
  assert.equal(ctxItem.text, "😐 ███░░░░░ 35% 351k/1M 💬 5");
  assert.equal(REGISTRY.model.render(ctx).text, "Opus 🧠xhigh");
  assert.equal(REGISTRY.state.render(ctx).text, "▶");
  assert.equal(REGISTRY.clock.render(ctx).text, "14:30");
  assert.equal(REGISTRY.notify.render(ctx).text, "🌙");
  const a5 = REGISTRY.account5h.render(ctx);
  assert.equal(a5.id, "account5h");
  assert.match(a5.text, /^🕐 /);
  assert.match(a5.text, /57\.0M$/);
});

test("buildSageItem and sage registry soft-fail when absent", () => {
  assert.equal(buildSageItem(""), null);
  assert.equal(buildSageItem("alpha").text, "zone alpha");
  assert.equal(REGISTRY.sage.enabled, false);
  assert.equal(REGISTRY.sage.render({}), null);
});

test("token-forecast naming is gone (D3)", async () => {
  const { execSync } = await import("node:child_process");
  const hits = execSync("grep -rl token-forecast lib/ || true", {
    encoding: "utf8",
  }).trim();
  assert.equal(hits, "");
});
