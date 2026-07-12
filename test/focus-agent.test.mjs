import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RUN = fileURLToPath(
  new URL("../scripts/focus-agent/run.sh", import.meta.url),
);
const AGENT_DIR = dirname(RUN);

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
