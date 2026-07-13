import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  fileURLToPath(new URL("../scripts/curtain-card-session.sh", import.meta.url)),
  "utf8",
);

test("card loop reads options from the current session, never a cached -t name", () => {
  // A cached `-t "$sess"` target is exactly the rename bug (Why #4): after a
  // `prefix + $` rename the old name resolves to nothing and the card falls to
  // classic-idle. The dump must be untargeted (current session).
  assert.doesNotMatch(script, /show-options\s+-t/, "no cached -t target");
  assert.match(script, /tmux show-options/, "still dumps options");
});

test("card loop paces fast only while covered", () => {
  assert.match(script, /@herald_covered/, "reads the covered flag");
  assert.match(script, /covered.*=.*1/, "branches on covered == 1");
});

test("card loop reveals (restoring the bar) on exit/signal", () => {
  assert.match(script, /trap .* EXIT/, "has an exit/signal trap");
  assert.match(script, /curtain reveal/, "trap path reveals");
});
