import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { version } from "../lib/version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("version() returns package.json version", () => {
  assert.equal(version(), pkg.version);
});

test("package version is not the placeholder 0.0.0", () => {
  assert.notEqual(pkg.version, "0.0.0");
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});

test("herald --version prints package.json version", () => {
  const out = execFileSync("node", ["bin/herald", "--version"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal(out.trim(), `herald ${pkg.version}`);
});

test("herald -v matches --version", () => {
  const out = execFileSync("node", ["bin/herald", "-v"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal(out.trim(), `herald ${pkg.version}`);
});
