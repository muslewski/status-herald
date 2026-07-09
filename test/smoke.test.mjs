import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("herald --version prints version line", () => {
  const out = execFileSync("node", ["bin/herald", "--version"], {
    encoding: "utf8",
  });
  assert.match(out, /^herald \d+\.\d+\.\d+/);
});
