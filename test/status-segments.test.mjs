import assert from "node:assert/strict";
import { test } from "node:test";

import { tmuxColor, visibleWidth } from "../lib/render.mjs";

test("visibleWidth strips tmux markup (for status engine)", () => {
  assert.equal(visibleWidth("#[fg=colour46]hi#[default]"), 2);
});

test("tmuxColor wraps text with tmux fg and default reset", () => {
  assert.equal(tmuxColor("hi", "colour46"), "#[fg=colour46]hi#[default]");
});
