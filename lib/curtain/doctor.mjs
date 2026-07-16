// Observability: herald doctor checks (injectable I/O; soft-fail where soft).
// Spec §5.5 — RC3 detection via @herald_settle_ts recency on covered sessions.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStatusDir } from "../status/providers.mjs";
import {
  getClaudeSettingsPath,
  getGrokHooksPath,
  inspectWiring,
} from "./install.mjs";
import { parseLeases } from "./lease.mjs";
import { STATES } from "./state.mjs";

/**
 * @typedef {{ name: string, ok: boolean, hard: boolean, detail: string }} Check
 */

const VALID_STATES = new Set(Object.values(STATES));

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * @param {{
 *   t?: { listArmed?: Function, getSessOpt?: Function },
 *   env?: NodeJS.ProcessEnv,
 *   fs?: typeof fs,
 *   nowSec?: number,
 *   tmuxOk?: boolean,
 *   settingsPaths?: { claude?: string, grok?: string },
 * }} deps
 * @returns {{ checks: Check[], ok: boolean }}
 */
export const runDoctor = (deps = {}) => {
  const env = deps.env || process.env;
  const fsys = deps.fs || fs;
  const nowSec = Number(deps.nowSec) || Math.floor(Date.now() / 1000);
  const t = deps.t || null;
  /** @type {Check[]} */
  const checks = [];

  const push = (name, ok, hard, detail) => {
    checks.push({ name, ok: !!ok, hard: !!hard, detail: String(detail || "") });
  };

  // (1) Hook configs reference absolute node + herald curtain hook
  const claudePath = deps.settingsPaths?.claude || getClaudeSettingsPath();
  const grokPath = deps.settingsPaths?.grok || getGrokHooksPath();
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
        );
        continue;
      }
      const ok = !w.bare && w.resolvable;
      push(
        `hooks:${label}`,
        ok,
        true,
        ok
          ? `${label} hook absolute + resolvable`
          : w.bare
            ? `${label} hook is bare name (PATH fragile)`
            : `${label} hook path missing on disk`,
      );
    } catch (e) {
      push(`hooks:${label}`, false, true, e?.message || "inspect failed");
    }
  }

  // (2) tmux reachable
  let tmuxOk = deps.tmuxOk;
  if (tmuxOk === undefined) {
    try {
      execFileSync("tmux", ["-V"], { timeout: 2000 });
      tmuxOk = true;
    } catch {
      tmuxOk = false;
    }
  }
  push("tmux", tmuxOk, true, tmuxOk ? "tmux reachable" : "tmux not available");

  // Armed sessions coherent (state ∈ STATES, leases parseable)
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
      );
      push(
        `session:${name}:leases`,
        true,
        false,
        `leases parseable (${leases.length} entries)`,
      );

      // (3) settle_ts recency for armed+covered (hard — RC3)
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
        );
      }
    }
  }

  // (4) agent-status dir + heartbeats (soft)
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
    );
  } catch (e) {
    push("agent-status", true, false, e?.message || "unreadable");
  }

  // (5) card-loop script resolves bin/herald absolutely
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
    push(
      "card-loop-bin",
      scriptOk && binOk && absOk,
      true,
      scriptOk && binOk && absOk
        ? "curtain-card-session.sh resolves $ROOT/bin/herald"
        : "card script or bin/herald missing / not absolute",
    );
  } catch (e) {
    push("card-loop-bin", false, true, e?.message || "check failed");
  }

  const hardFail = checks.some((c) => c.hard && !c.ok);
  return { checks, ok: !hardFail };
};
