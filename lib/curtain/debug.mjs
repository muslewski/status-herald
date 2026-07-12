import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// A stable, XDG-respecting state dir for capture logs and the capture sentinel.
export const stateDir = () =>
  join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "status-herald",
  );

export const captureLogPath = () => join(stateDir(), "hook-debug.log");
export const captureSentinel = () => join(stateDir(), "capture.on");

// Capture is on when HERALD_CURTAIN_DEBUG is set OR a sentinel file exists. The
// sentinel matters because it can be toggled for sessions that are ALREADY
// running: their hooks inherit a fixed env, so an env-only switch could never
// capture them, but a file check happens fresh on every hook.
export const captureOn = () => {
  if (process.env.HERALD_CURTAIN_DEBUG) return true;
  try {
    return existsSync(captureSentinel());
  } catch {
    return false;
  }
};

// Fail-open append of one JSON line to the hook debug log. This is how a real
// Grok hook payload gets captured: turn capture on, run a Grok session, read the
// log -- the Grok adapter is then built against fact, not a guessed shape.
// Observability must never break a hook, so every error is swallowed.
export const debugLog = (record) => {
  if (!captureOn()) return;
  try {
    const dir = stateDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(captureLogPath(), `${JSON.stringify(record)}\n`);
  } catch {
    /* ignore */
  }
};
