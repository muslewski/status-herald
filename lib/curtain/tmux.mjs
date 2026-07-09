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
