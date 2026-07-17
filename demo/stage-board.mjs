#!/usr/bin/env node
// Demo-only stage board for `herald curtain inspect`.
// tmux 3.6 replaces TAB in list-sessions -F output with '_', so the in-tree
// listArmed() always returns [] on this host. Rebuild the board with a
// session list + per-session show -v (no tabs). Never imported at runtime.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const { boardRowFromOpts, renderStageBoard } = await import(
  pathToFileURL(path.join(repoRoot, "lib/curtain/inspect.mjs")).href
);

const tmux = (args) => {
  try {
    return execFileSync("tmux", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const names = tmux(["list-sessions", "-F", "#{session_name}"])
  .split("\n")
  .filter(Boolean);
const now = Math.floor(Date.now() / 1000);
const rows = [];
for (const name of names) {
  if (tmux(["show", "-t", name, "-v", "@herald_armed"]) !== "1") continue;
  rows.push(
    boardRowFromOpts(
      name,
      (k) => tmux(["show", "-t", name, "-v", k]) || "",
      now,
    ),
  );
}
process.stdout.write(renderStageBoard(rows));
