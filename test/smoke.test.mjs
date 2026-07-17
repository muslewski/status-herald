import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("herald --version prints version line", () => {
  const pkg = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
      "utf8",
    ),
  );
  const out = execFileSync("node", ["bin/herald", "--version"], {
    encoding: "utf8",
  });
  assert.match(out, /^herald \d+\.\d+\.\d+/);
  assert.equal(out.trim(), `herald ${pkg.version}`);
  assert.notEqual(pkg.version, "0.0.0");
});
