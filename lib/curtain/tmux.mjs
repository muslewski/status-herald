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
};

// Run tmux, returning trimmed stdout, or null on any failure (tmux missing etc).
const run = (args) => {
  try {
    return execFileSync("tmux", args, { encoding: "utf8" }).trim();
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
