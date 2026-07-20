// Unified doctor: one health surface for `herald doctor` and `herald curtain doctor`.
// Banner + ordered checklist; fix-hint under every failure; exit via hard fails.
// Spec §5.5 — RC3 via @herald_settle_ts recency on covered sessions.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.mjs";
import { resolveStatusDir } from "../status/providers.mjs";
import {
  getClaudeSettingsPath,
  getGrokHooksPath,
  inspectWiring,
} from "./install.mjs";
import { parseLeases } from "./lease.mjs";
import { STATES } from "./state.mjs";

/**
 * @typedef {{
 *   name: string,
 *   ok: boolean,
 *   hard: boolean,
 *   detail: string,
 *   fixHint: string,
 * }} Check
 */

const VALID_STATES = new Set(Object.values(STATES));

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const reinstallHint = (label) =>
  label === "grok"
    ? "herald curtain install grok"
    : "herald curtain install";

/**
 * @param {{
 *   t?: { listArmed?: Function, getSessOpt?: Function },
 *   env?: NodeJS.ProcessEnv,
 *   fs?: typeof fs,
 *   nowSec?: number,
 *   tmuxOk?: boolean,
 *   inTmux?: boolean,
 *   settingsPaths?: { claude?: string, grok?: string },
 *   bars?: { tmux?: object, claude?: object } | null,
 *   loadBars?: () => { tmux?: object, claude?: object } | null,
 * }} deps
 * @returns {{ checks: Check[], ok: boolean, passed: number, total: number }}
 */
export const runDoctor = (deps = {}) => {
  const env = deps.env || process.env;
  const fsys = deps.fs || fs;
  const nowSec = Number(deps.nowSec) || Math.floor(Date.now() / 1000);
  const t = deps.t || null;
  /** @type {Check[]} */
  const checks = [];

  const push = (name, ok, hard, detail, fixHint = "") => {
    checks.push({
      name,
      ok: !!ok,
      hard: !!hard,
      detail: String(detail || ""),
      fixHint: ok ? "" : String(fixHint || ""),
    });
  };

  // (1) Per-host hook wiring — absolute, resolvable, current (not stale)
  const claudePath = deps.settingsPaths?.claude || getClaudeSettingsPath();
  const grokPath = deps.settingsPaths?.grok || getGrokHooksPath();
  let anyHostPresent = false;
  let anyHostOk = false;
  for (const [label, p] of [
    ["claude", claudePath],
    ["grok", grokPath],
  ]) {
    try {
      const w = inspectWiring(p);
      if (!w.present) {
        push(
          `hooks:${label}`,
          true,
          false,
          `${label} config absent (ok if other host wired)`,
          "",
        );
        continue;
      }
      anyHostPresent = true;
      // current===false → stale absolute from another node/repo (curtain doctor).
      // Missing `current` treated as ok when bare/resolvable pass.
      const currentOk = w.current !== false;
      const pass = !w.bare && w.resolvable && currentOk;
      if (pass) anyHostOk = true;
      let detail = `${label} hook absolute + resolvable`;
      let hint = "";
      if (w.bare) {
        detail = `${label} hook is bare name (PATH fragile)`;
        hint = reinstallHint(label);
      } else if (!w.resolvable) {
        detail = `${label} hook path missing on disk`;
        hint = reinstallHint(label);
      } else if (!currentOk) {
        detail = `${label} hook is stale (different node/repo)`;
        hint = reinstallHint(label);
      }
      push(`hooks:${label}`, pass, true, detail, hint);
    } catch (e) {
      push(
        `hooks:${label}`,
        false,
        true,
        e?.message || "inspect failed",
        reinstallHint(label),
      );
    }
  }

  // Aggregate: at least one host must be wired and healthy (merged from curtain doctor)
  push(
    "hooks-wired",
    anyHostOk,
    true,
    anyHostOk
      ? "claude compat or grok native hooks healthy"
      : anyHostPresent
        ? "hooks present but unhealthy — reinstall"
        : "no herald hooks wired",
    anyHostOk
      ? ""
      : "herald curtain install   # and/or: herald curtain install grok",
  );

  // (2) tmux binary reachable
  let tmuxOk = deps.tmuxOk;
  if (tmuxOk === undefined) {
    try {
      execFileSync("tmux", ["-V"], { timeout: 2000 });
      tmuxOk = true;
    } catch {
      tmuxOk = false;
    }
  }
  push(
    "tmux",
    tmuxOk,
    true,
    tmuxOk ? "tmux reachable" : "tmux not available",
    tmuxOk ? "" : "install tmux and ensure it is on PATH",
  );

  // Inside tmux — soft (doctor is often run from a shell outside panes)
  let inTmux = deps.inTmux;
  if (inTmux === undefined) {
    try {
      inTmux = !!env.TMUX;
    } catch {
      inTmux = false;
    }
  }
  push(
    "inside-tmux",
    inTmux,
    false,
    inTmux ? "TMUX set" : "not inside tmux (ok for install/doctor)",
    inTmux ? "" : "run from a tmux pane to exercise cover/status",
  );

  // Bars config (soft — from curtain doctor)
  try {
    const bars =
      deps.bars !== undefined
        ? deps.bars
        : typeof deps.loadBars === "function"
          ? deps.loadBars()
          : loadConfig().bars;
    const present = !!bars?.tmux && !!bars?.claude;
    push(
      "bars-config",
      present,
      false,
      present ? "bars.tmux + bars.claude present" : "bars config incomplete",
      present ? "" : "check ~/.config/status-herald/config.json bars section",
    );
  } catch (e) {
    push(
      "bars-config",
      false,
      false,
      e?.message || "bars unreadable",
      "herald config  # inspect effective JSON",
    );
  }

  // Armed sessions: state ∈ STATES, leases parseable, settle RC3 on covered
  if (t && typeof t.listArmed === "function") {
    const armed = t.listArmed() || [];
    for (const s of armed) {
      const name = s.name || s;
      const state =
        (typeof t.getSessOpt === "function" &&
          t.getSessOpt(name, "@herald_state")) ||
        "";
      const leasesStr =
        (typeof t.getSessOpt === "function" &&
          t.getSessOpt(name, "@herald_leases")) ||
        "";
      const stateOk = !state || VALID_STATES.has(state);
      const leases = parseLeases(leasesStr);
      push(
        `session:${name}:state`,
        stateOk,
        false,
        stateOk ? `state=${state || "idle"}` : `invalid state=${state}`,
        stateOk
          ? ""
          : `herald curtain event done  # or disarm && arm session ${name}`,
      );
      push(
        `session:${name}:leases`,
        true,
        false,
        `leases parseable (${leases.length} entries)`,
        "",
      );

      // settle_ts recency for armed+covered (hard — RC3 first-class)
      const covered =
        typeof t.getSessOpt === "function" &&
        t.getSessOpt(name, "@herald_covered") === "1";
      if (covered) {
        const settleTs =
          Number(
            typeof t.getSessOpt === "function" &&
              t.getSessOpt(name, "@herald_settle_ts"),
          ) || 0;
        const age = settleTs > 0 ? nowSec - settleTs : Number.POSITIVE_INFINITY;
        const ok = settleTs > 0 && age < 120;
        push(
          `session:${name}:settle_ts`,
          ok,
          true,
          ok
            ? `settle tick ${age}s ago`
            : settleTs
              ? `settle stale (${age}s) — card loop may be dead (RC3)`
              : "no settle stamp — card loop may not be ticking",
          ok
            ? ""
            : `herald curtain refresh  # or: disarm && arm ${name}`,
        );
      }
    }
  }

  // agent-status dir + heartbeats (soft)
  try {
    const dir = resolveStatusDir(env);
    let n = 0;
    try {
      const pdir = path.join(dir, "providers");
      if (fsys.existsSync(pdir)) {
        n = fsys.readdirSync(pdir).filter((f) => f.endsWith(".json")).length;
      }
    } catch {
      n = 0;
    }
    push(
      "agent-status",
      true,
      false,
      `dir=${dir} provider-files≈${n} (informational)`,
      "",
    );
  } catch (e) {
    push(
      "agent-status",
      true,
      false,
      e?.message || "unreadable",
      "",
    );
  }

  // card-loop script resolves bin/herald absolutely (card loop alive prerequisite)
  try {
    const script = path.join(ROOT, "scripts", "curtain-card-session.sh");
    const bin = path.join(ROOT, "bin", "herald");
    const scriptOk = fsys.existsSync(script);
    const binOk = fsys.existsSync(bin);
    let absOk = false;
    if (scriptOk) {
      const body = fsys.readFileSync(script, "utf8");
      absOk = body.includes("ROOT=") && body.includes("bin/herald");
    }
    const pass = scriptOk && binOk && absOk;
    push(
      "card-loop-bin",
      pass,
      true,
      pass
        ? "curtain-card-session.sh resolves $ROOT/bin/herald"
        : "card script or bin/herald missing / not absolute",
      pass
        ? ""
        : "reinstall status-herald from checkout; herald curtain refresh",
    );
  } catch (e) {
    push(
      "card-loop-bin",
      false,
      true,
      e?.message || "check failed",
      "reinstall status-herald from checkout",
    );
  }

  const hardFail = checks.some((c) => c.hard && !c.ok);
  const passed = checks.filter((c) => c.ok).length;
  return {
    checks,
    ok: !hardFail,
    passed,
    total: checks.length,
  };
};

/**
 * Gauge fill for banner: n filled blocks of width w.
 * @param {number} pct 0–100
 * @param {number} [w=8]
 */
const gauge = (pct, w = 8) => {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const f = Math.round((w * p) / 100);
  return `${"█".repeat(f)}${"░".repeat(w - f)}`;
};

/**
 * Pure report text: banner + checklist; fix-hint line under every failure.
 * @param {{ checks: Check[], ok?: boolean, passed?: number, total?: number }} result
 * @returns {string}
 */
export const formatDoctorReport = (result) => {
  const checks = result.checks || [];
  const total = result.total ?? checks.length;
  const passed =
    result.passed ?? checks.filter((c) => c.ok).length;
  const pct = total > 0 ? Math.round((100 * passed) / total) : 100;
  const lines = [
    `╔ doctor · ${passed}/${total} ${gauge(pct)} ${pct}% ╗`,
  ];
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    const detail = c.detail ? ` — ${c.detail}` : "";
    lines.push(`  ${mark} ${c.name}${detail}`);
    if (!c.ok && c.fixHint) {
      lines.push(`    → ${c.fixHint}`);
    }
  }
  if (result.ok === false) {
    lines.push("  next: fix ✗ items above, then re-run herald doctor");
  }
  return `${lines.join("\n")}\n`;
};
