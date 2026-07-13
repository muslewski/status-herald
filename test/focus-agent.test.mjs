import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RUN = fileURLToPath(
  new URL("../scripts/focus-agent/run.sh", import.meta.url),
);
const AGENT_DIR = dirname(RUN);
const ROOT = join(AGENT_DIR, "../..");
const UNIT = join(ROOT, "contrib/systemd/status-herald-curtain.service");
const FOCUS_LUA = join(ROOT, "mac/herald-focus.lua");

// run.sh --print with a stub `herald` on PATH that reports the given source.
const printFor = (source) => {
  const dir = mkdtempSync(join(tmpdir(), "herald-stub-"));
  const stub = join(dir, "herald");
  const json = JSON.stringify({ curtain: { focus: { source } } });
  writeFileSync(stub, `#!/usr/bin/env bash\ncat <<'JSON'\n${json}\nJSON\n`);
  chmodSync(stub, 0o755);
  try {
    return execFileSync("bash", [RUN, "--print"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        HERALD_FOCUS_AGENT_DIR: AGENT_DIR,
      },
    }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("run.sh selects the poll adapter for ssh-osascript", () => {
  assert.match(
    printFor("ssh-osascript"),
    /ssh-osascript -> .*ghostty-ssh-poll\.sh$/,
  );
});

test("run.sh selects the stream adapter for ghostty-hammerspoon", () => {
  assert.match(
    printFor("ghostty-hammerspoon"),
    /ghostty-hammerspoon -> .*ghostty-hammerspoon-stream\.sh$/,
  );
});

test("run.sh falls back to the poll adapter for an unknown source", () => {
  assert.match(printFor("who-knows"), /ghostty-ssh-poll\.sh$/);
});

// r005: Restart=on-failure must not flash cards via reveal-all mid-restart.
// Poll adapter reveal-all on its own clean exit; stream holds state; operator
// can `herald curtain reveal-all` manually. ExecStopPost runs on unclean exit
// too, so it must not call reveal-all while Restart=on-failure is set.
test("systemd unit does not ExecStopPost reveal-all (no mid-blip on failure restart)", () => {
  const unit = readFileSync(UNIT, "utf8");
  // Comments may document the ban; only active directives matter.
  const directives = unit
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert.doesNotMatch(
    directives,
    /ExecStopPost\s*=\s*.*reveal-all/,
    "ExecStopPost reveal-all flashes cards on Restart=on-failure cycles",
  );
  assert.match(unit, /Restart=on-failure/);
});

// r005: heartbeat-only sessions still grow the event file; truncate on that path.
// Source contract: either append()'s body calls truncateIfLarge (covers all
// writers including heartbeat), or the heartbeat timer does before append.
test("herald-focus.lua truncates event file on heartbeat append path", () => {
  const lua = readFileSync(FOCUS_LUA, "utf8");
  assert.match(lua, /append\(["']__hb__/);

  const appendBody = lua.match(
    /function append\s*\([^)]*\)\s*\n([\s\S]*?)\nend\b/,
  );
  assert.ok(appendBody, "append function present");
  const truncateInAppend = /truncateIfLarge\s*\(/.test(appendBody[1]);

  const heartbeatBody = lua.match(
    /doEvery\s*\([^,]+,\s*function\s*\(\)\s*\n([\s\S]*?)\nend\)/,
  );
  assert.ok(heartbeatBody, "heartbeat timer present");
  const truncateInHeartbeat = /truncateIfLarge\s*\(/.test(heartbeatBody[1]);

  assert.ok(
    truncateInAppend || truncateInHeartbeat,
    "heartbeat writes must call truncateIfLarge (in append or in timer)",
  );
});
