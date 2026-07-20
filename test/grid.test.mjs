import assert from "node:assert/strict";
import { test } from "node:test";
import { focusHookCmd } from "../lib/curtain/grid.mjs";

test("focusHookCmd is absolute node+herald, not bare herald", () => {
  const c = focusHookCmd("focus-in");
  assert.ok(c.includes(process.execPath), "includes absolute node");
  assert.match(c, /bin\/herald/);
  assert.match(c, /curtain focus-in #\{pane_id\}/);
  assert.doesNotMatch(c, /^herald /);
  assert.doesNotMatch(c, /run-shell "herald /);
});

test("focusHookCmd focus-out matches absolute form", () => {
  const c = focusHookCmd("focus-out");
  assert.ok(c.includes(process.execPath), "includes absolute node");
  assert.match(c, /bin\/herald/);
  assert.match(c, /curtain focus-out #\{pane_id\}/);
});
