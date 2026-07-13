import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig, merge } from "../lib/config.mjs";
import {
  modelBadgeLong,
  renderClaudeBarString,
  renderClaudeStatusline,
} from "../lib/status/claude-statusline.mjs";
import {
  REGISTRY,
  buildAccountSliderItem,
  buildContextItem,
  orderSegments,
  renderLine,
} from "../lib/status/segments.mjs";
import {
  ctxBucketTmux,
  stateGlyph,
  syncWindows,
  windowFor,
  writeCtxbar,
  writeModelAndState,
  writeSessionMeta,
} from "../lib/status/side-effects.mjs";
import { renderTmuxStatus } from "../lib/status/tmux-status.mjs";

// --- bars config (020 Task 1) ---

test("bars config section present in defaults and reproduces today's look", () => {
  const cfg = loadConfig(join(tmpdir(), "nope-herald-bars-xyz.json"));
  assert.ok(cfg.bars);
  assert.equal(cfg.bars.tmux.enabled, true);
  assert.equal(cfg.bars.claude.enabled, true);
  assert.equal(cfg.bars.claude.silentCapture, false);
  assert.equal(cfg.bars.segments.account5h.enabled, true);
  assert.equal(cfg.bars.segments.accountWeekly.enabled, true);
  assert.equal(cfg.bars.segments.model.enabled, false);
  assert.equal(cfg.bars.segments.context.enabled, true);
  assert.equal(cfg.bars.segments.state.enabled, true);
});

test("bars config partial override merges (per-segment)", () => {
  const merged = merge(DEFAULTS, {
    bars: {
      segments: {
        account5h: { enabled: false },
        accountWeekly: { enabled: false },
        model: { enabled: true },
      },
    },
  });
  assert.equal(merged.bars.segments.account5h.enabled, false);
  assert.equal(merged.bars.segments.model.enabled, true);
  assert.equal(merged.bars.segments.context.enabled, true);
});

// --- side-effects (020 Task 3) ---

test("writeCtxbar is idempotent and mirrors session scope", () => {
  const calls = [];
  const store = {};
  const exec = (args) => {
    calls.push(args);
    if (args[0] === "display-message") {
      // display-message -p -t target #{@ctxbar}
      const target = args[3];
      const fmt = args[4];
      if (fmt === "#{@ctxbar}") return store[`w:${target}:@ctxbar`] || "";
      return "";
    }
    if (args[0] === "show-options") {
      // show-options -t sess -v @ctxbar
      const sess = args[2];
      const opt = args[4];
      return store[`s:${sess}:${opt}`] || "";
    }
    if (args[0] === "set-option" && args[1] === "-w") {
      store[`w:${args[3]}:${args[4]}`] = args[5];
      return "";
    }
    if (args[0] === "set-option" && args[1] === "-t") {
      store[`s:${args[2]}:${args[3]}`] = args[4];
      return "";
    }
    return "";
  };
  writeCtxbar("%1", "BAR1", "sessA", exec);
  assert.equal(store["w:%1:@ctxbar"], "BAR1");
  assert.equal(store["s:sessA:@ctxbar"], "BAR1");
  const n = calls.length;
  writeCtxbar("%1", "BAR1", "sessA", exec); // identical → no new writes
  const writes = calls.slice(n).filter((a) => a[0] === "set-option");
  assert.equal(writes.length, 0, "idempotent: no rewrite when unchanged");
});

test("writeModelAndState skips unchanged values", () => {
  const store = {
    "w:%1:@model": "Opus",
    "w:%1:@state": "▶",
    "w:%1:@ctx": "green",
  };
  const writes = [];
  const exec = (args) => {
    if (args[0] === "display-message") {
      const fmt = args[4];
      const key = fmt.replace("#{", "").replace("}", "");
      return store[`w:%1:${key}`] || "";
    }
    if (args[0] === "set-option" && args[1] === "-w") {
      writes.push([args[4], args[5]]);
      store[`w:%1:${args[4]}`] = args[5];
    }
    return "";
  };
  writeModelAndState(
    "%1",
    { modelBadge: "Opus", glyph: "▶", color: "green" },
    exec,
  );
  assert.equal(writes.length, 0);
  writeModelAndState(
    "%1",
    { modelBadge: "Sonnet", glyph: "⏸", color: "orange" },
    exec,
  );
  assert.deepEqual(writes, [
    ["@model", "Sonnet"],
    ["@state", "⏸"],
    ["@ctx", "orange"],
  ]);
});

test("windowFor climbs ppid chain via injectable ppidOf", () => {
  const panes = new Map([[100, ["s:1", "@1"]]]);
  assert.deepEqual(
    windowFor(50, panes, (pid) => (pid === 50 ? 100 : null)),
    ["s:1", "@1"],
  );
  assert.equal(
    windowFor(99, panes, () => null),
    null,
  );
});

test("ctxBucketTmux and stateGlyph match Python bands/glyphs", () => {
  assert.equal(ctxBucketTmux(10), "green");
  assert.equal(ctxBucketTmux(35), "orange");
  assert.equal(ctxBucketTmux(70), "red");
  assert.equal(ctxBucketTmux(90), "colour201");
  assert.equal(stateGlyph("busy"), "▶");
  assert.equal(stateGlyph("idle"), "⏸");
});

test("syncWindows writes ctxbar at window and session via spy", () => {
  const store = {};
  const exec = (args) => {
    if (args[0] === "display-message") {
      const target = args[3];
      const fmt = args[4];
      if (fmt === "#{session_name}") return "mysess";
      if (fmt === "#{window_name}") return "mysess";
      const key = fmt.replace("#{", "").replace("}", "");
      return store[`w:${target}:${key}`] || "";
    }
    if (args[0] === "show-options") {
      return store[`s:${args[2]}:${args[4]}`] || "";
    }
    if (args[0] === "set-option" && args[1] === "-w") {
      store[`w:${args[3]}:${args[4]}`] = args[5];
      return "";
    }
    if (args[0] === "set-option" && args[1] === "-t") {
      store[`s:${args[2]}:${args[3]}`] = args[4];
      return "";
    }
    return "";
  };
  const panes = new Map([[10, ["mysess:0", "@w1"]]]);
  syncWindows(
    [{ sessionId: "sid1", pid: 10, ppid: 10, status: "busy", name: "mysess" }],
    {
      panes,
      ppidOf: () => null,
      exec,
      modelEnabled: true,
      getDataFor: () => ({
        context: { used: 351000, win: 1000000, pct: 35, messages: 5 },
        modelBadge: "Opus 🧠xhigh",
        ctxbarText: buildContextItem({
          used: 351000,
          win: 1000000,
          pct: 35,
          messages: 5,
        }).text,
        stateGlyph: "▶",
        color: "orange",
      }),
    },
  );
  assert.equal(store["w:mysess:0:@state"], "▶");
  assert.equal(store["w:mysess:0:@model"], "Opus 🧠xhigh");
  assert.equal(store["w:mysess:0:@ctx"], "orange");
  assert.ok(store["w:mysess:0:@ctxbar"]?.includes("35%"));
  assert.ok(store["s:mysess:@ctxbar"]?.includes("35%"), "session mirror");
});

test("writeSessionMeta atomic shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-meta-"));
  try {
    writeSessionMeta("abc", "Opus 4.8", "xhigh", dir);
    const raw = readFileSync(join(dir, "abc.json"), "utf8");
    assert.deepEqual(JSON.parse(raw), { model: "Opus 4.8", effort: "xhigh" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- tmux-status surface (020 Task 4) ---

test("renderTmuxStatus returns account gauges when enabled; respects skipSideEffects", async () => {
  const out = await renderTmuxStatus({
    skipSideEffects: true,
    snapshotPath: "test/fixtures/token-forecast-snapshot.json",
    now: 1783950000,
    config: DEFAULTS,
    clockText: "12:00",
  });
  assert.ok(out.length > 0, "expected account gauges stdout");
  // tmux-colored segments for 5h + weekly
  assert.match(out, /🕐/);
  assert.match(out, /📅/);
  // model off by default → no Opus in account-only stdout path
});

test("renderTmuxStatus empty when tmux bars disabled", async () => {
  const cfg = merge(DEFAULTS, { bars: { tmux: { enabled: false } } });
  const out = await renderTmuxStatus({
    skipSideEffects: true,
    config: cfg,
    snapshotPath: "test/fixtures/token-forecast-snapshot.json",
    now: 1783950000,
  });
  assert.equal(out, "");
});

test("renderTmuxStatus fail-open on bad snapshot path", async () => {
  const out = await renderTmuxStatus({
    skipSideEffects: true,
    snapshotPath: join(tmpdir(), "no-such-snap-xyz.json"),
    config: merge(DEFAULTS, {
      bars: {
        segments: {
          account5h: { enabled: false },
          accountWeekly: { enabled: false },
          clock: { enabled: false },
          notify: { enabled: false },
        },
      },
    }),
  });
  assert.equal(out, "");
});

// --- claude-statusline (020 Task 5) ---

test("modelBadgeLong formats display + window + effort", () => {
  assert.equal(
    modelBadgeLong(
      { display_name: "Opus 4.8" },
      { context_window_size: 1000000 },
      { level: "xhigh" },
    ),
    "Opus 4.8 (1M) 🧠xhigh",
  );
});

test("renderClaudeBarString idle uses wait bg and your turn chip", () => {
  const s = renderClaudeBarString({
    status: "idle",
    elapsedSecs: 12,
    modelNm: "Opus 🧠xhigh",
    notifyIcon: "🌙",
    columns: 0,
  });
  assert.match(s, /your turn/);
  assert.match(s, /12s/);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC for WAIT_BG assert
  assert.match(s, /\x1b\[48;5;94m/);
});

test("renderClaudeStatusline writes sidecar, feeds, silent returns empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-claude-bar-"));
  try {
    const fed = null;
    // monkey via opts.feedCommand empty; we check write only
    const out = await renderClaudeStatusline(
      {
        session_id: "sid-xyz",
        model: { display_name: "Opus 4.8" },
        effort: { level: "xhigh" },
      },
      {
        metaDir: dir,
        feedCommand: "",
        silent: true,
        notifyIcon: "🌙",
      },
    );
    assert.equal(out, "");
    const meta = JSON.parse(readFileSync(join(dir, "sid-xyz.json"), "utf8"));
    assert.equal(meta.model, "Opus 4.8");
    assert.equal(meta.effort, "xhigh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderClaudeStatusline silentCapture still writes meta", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-claude-bar-"));
  try {
    const cfg = merge(DEFAULTS, {
      bars: { claude: { enabled: true, silentCapture: true } },
    });
    const out = await renderClaudeStatusline(
      {
        session_id: "sid-silent",
        model: { display_name: "Sonnet" },
        effort: { level: "high" },
      },
      { metaDir: dir, config: cfg, feedCommand: "", notifyIcon: "☀️" },
    );
    assert.equal(out, "");
    const meta = JSON.parse(readFileSync(join(dir, "sid-silent.json"), "utf8"));
    assert.equal(meta.model, "Sonnet");
    assert.equal(meta.effort, "high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderClaudeStatusline busy render includes working chip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-claude-bar-"));
  try {
    const out = await renderClaudeStatusline(
      {
        session_id: "sid-busy",
        model: { display_name: "Opus 4.8" },
        effort: { level: "xhigh" },
      },
      {
        metaDir: dir,
        feedCommand: "",
        notifyIcon: "🌙",
        columns: 80,
        findSession: async () => ({
          status: "busy",
          lastActivity: Date.now() - 5000,
        }),
      },
    );
    assert.match(out, /working/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC for WORK_BG assert
    assert.match(out, /\x1b\[48;5;54m/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- registry parity with bars config ---

test("orderSegments on REGISTRY with DEFAULTS.bars.segments keeps context before accounts", () => {
  const ordered = orderSegments(REGISTRY, {
    segments: DEFAULTS.bars.segments,
  });
  const ids = ordered.map((s) => s.id);
  assert.ok(ids.indexOf("context") < ids.indexOf("account5h"));
  assert.ok(ids.includes("context"));
  assert.ok(!ids.includes("model")); // disabled by default
});
