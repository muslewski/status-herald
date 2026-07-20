import { execFileSync } from "node:child_process";

export const buildArgs = {
  getOpt: (pane, name) => ["show", "-p", "-t", pane, "-v", name],
  setOpt: (pane, name, value) => ["set", "-p", "-t", pane, name, String(value)],
  windowName: (pane) => ["display", "-p", "-t", pane, "#{window_name}"],
  swapPanes: (src, dst) => ["swap-pane", "-s", src, "-t", dst],
  selectPane: (pane) => ["select-pane", "-t", pane],
  focus: (pane) => [
    "display",
    "-p",
    "-t",
    pane,
    "#{pane_active},#{window_active},#{session_attached}",
  ],
  getSessOpt: (sess, name) => ["show", "-t", sess, "-v", name],
  setSessOpt: (sess, name, value) => ["set", "-t", sess, name, String(value)],
  unsetSessOpt: (sess, name) => ["set", "-u", "-t", sess, name],
  sessionOf: (pane) => ["display", "-p", "-t", pane, "#{session_name}"],
  activeWindowId: (sess) => ["display", "-p", "-t", sess, "#{window_id}"],
  selectWindow: (target) => ["select-window", "-t", target],
  newCardWindow: (sess, name, loop) => [
    "new-window",
    "-d",
    "-n",
    name,
    "-t",
    `${sess}:`,
    "bash",
    loop,
  ],
  killWindow: (target) => ["kill-window", "-t", target],
  listSessions: () => ["list-sessions", "-F", "#{session_name}"],
  // Everything focus() needs per session in ONE call. list-sessions evaluates
  // its format in each session's active-window context, so #{window_id} is the
  // active window (the card when covered); @herald_live_win names the real one.
  snapshot: () => [
    "list-sessions",
    "-F",
    [
      "#{session_name}",
      "#{@herald_armed}",
      "#{@herald_covered}",
      "#{@herald_state}",
      "#{@herald_live_win}",
      "#{window_id}",
      "#{@herald_paused}",
    ].join("\t"),
  ],
  // Every window's id -> name across all sessions in ONE call, so a covered
  // session's live-window NAME is resolvable without a per-session lookup.
  windowMap: () => ["list-windows", "-a", "-F", "#{window_id}\t#{window_name}"],
};

// Run tmux, returning trimmed stdout, or null on any failure (tmux missing etc).
const run = (args) => {
  try {
    // stderr ignored: these run as Claude Code hooks, and reading an unset
    // user option ("invalid option: @herald_armed") must not reach the host.
    return execFileSync("tmux", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

export const parseFocus = (line) => {
  if (!line) return false;
  const [pa, wa, sa] = line.split(",");
  return pa === "1" && wa === "1" && Number(sa) > 0;
};

export const getOpt = (pane, name) => run(buildArgs.getOpt(pane, name)) || "";
export const setOpt = (pane, name, value) => {
  run(buildArgs.setOpt(pane, name, value));
};
export const windowNameOf = (pane) => run(buildArgs.windowName(pane));
export const swapPanes = (src, dst) => {
  run(buildArgs.swapPanes(src, dst));
};
export const selectPane = (pane) => {
  run(buildArgs.selectPane(pane));
};
export const isFocused = (pane) => parseFocus(run(buildArgs.focus(pane)));

export const getSessOpt = (sess, name) =>
  run(buildArgs.getSessOpt(sess, name)) || "";
export const setSessOpt = (sess, name, value) => {
  run(buildArgs.setSessOpt(sess, name, value));
};
export const unsetSessOpt = (sess, name) => {
  run(buildArgs.unsetSessOpt(sess, name));
};
export const sessionOf = (pane) => run(buildArgs.sessionOf(pane)) || "";
export const activeWindowId = (sess) =>
  run(buildArgs.activeWindowId(sess)) || "";
export const selectWindow = (target) => {
  run(buildArgs.selectWindow(target));
};
export const newCardWindow = (sess, name, loop) => {
  run(buildArgs.newCardWindow(sess, name, loop));
};
export const killWindow = (target) => {
  run(buildArgs.killWindow(target));
};
export const listSessions = () => {
  const raw = run(buildArgs.listSessions());
  return raw ? raw.split("\n").filter(Boolean) : [];
};

// Parse the batched snapshot: one row per session, keep only armed ones. Fields
// are tab-separated (session/window names may hold spaces, never tabs).
export const parseSnapshot = (raw) => {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p[1] === "1")
    .map((p) => ({
      name: p[0],
      covered: p[2] === "1",
      state: p[3] || "",
      liveWin: p[4] || "",
      activeWin: p[5] || "",
      // Missing/empty = not paused (back-compat with 6-field snapshots).
      paused: p[6] === "1",
    }));
};

// Parse the window id->name map. Name is everything after the first tab, so a
// window name containing spaces (or an unexpected tab) survives intact.
export const parseWindowMap = (raw) => {
  const map = {};
  if (!raw) return map;
  for (const line of raw.split("\n")) {
    const i = line.indexOf("\t");
    if (i < 0) continue;
    map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
};

// One tmux call: armed sessions with their curtain state + active window.
export const snapshotArmed = () => parseSnapshot(run(buildArgs.snapshot()));

// One tmux call: every window id -> name across all sessions.
export const windowNames = () => parseWindowMap(run(buildArgs.windowMap()));

// One call: every session with @herald_armed=1 plus its stored live-window id.
export const listArmed = () => {
  const raw = run([
    "list-sessions",
    "-F",
    "#{session_name}\t#{@herald_armed}\t#{@herald_live_win}",
  ]);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p[1] === "1")
    .map((p) => ({ name: p[0], liveWin: p[2] || "" }));
};
