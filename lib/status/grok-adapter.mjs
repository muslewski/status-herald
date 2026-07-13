// Grok process detection via /proc tree walk (PPid from status file, cmdline argv).
// Zero side effects. Graceful on any error / non-linux.

import fs from "node:fs";

export function readProcStatusPpid(pid) {
  if (!pid) return null;
  try {
    const txt = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = txt.match(/^PPid:\s*(\d+)/m);
    return m ? Number.parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

export function climbProcTree(startPid, maxDepth = 4) {
  const pids = [startPid];
  let cur = startPid;
  for (let i = 0; i < maxDepth; i++) {
    const pp = readProcStatusPpid(cur);
    if (pp == null || pp === cur || pp <= 0) break;
    pids.push(pp);
    cur = pp;
  }
  return pids;
}

function readCmdline(pid) {
  try {
    const buf = fs.readFileSync(`/proc/${pid}/cmdline`);
    return buf.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

export function isGrokProcess(pid) {
  const argv = readCmdline(pid);
  if (!argv.length) return false;
  const joined = argv.join(" ").toLowerCase();
  return joined.includes("grok") || argv[0].toLowerCase().endsWith("grok");
}

function extractEffort(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--effort" || argv[i] === "-e") {
      return (argv[i + 1] || "").trim() || null;
    }
    const m = argv[i].match(/^--effort[=:](.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

export function detectGrok(panePid) {
  if (!panePid) return { isGrok: false };
  const tree = climbProcTree(panePid, 4);
  for (const pid of tree) {
    if (isGrokProcess(pid)) {
      const argv = readCmdline(pid);
      const effort = extractEffort(argv) || "";
      const label = effort ? `Grok ${effort}` : "Grok";
      return { isGrok: true, effort: effort || undefined, label };
    }
  }
  return { isGrok: false };
}
