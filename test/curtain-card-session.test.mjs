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

// refreshCards kills _curtain; EXIT trap must not reveal mid-refresh or the
// session ends covered=0 with the card selected (keypress no-op, bar desync).
test("card EXIT trap skips reveal while @herald_refreshing is set", () => {
  assert.match(
    script,
    /@herald_refreshing|herald_refreshing/,
    "trap consults refreshing flag",
  );
  // Fail-open: only skip when flag is exactly 1; otherwise still reveal.
  assert.match(
    script,
    /\[\s*"\$r"\s*=\s*"1"\s*\]\s*\|\|\s*herald curtain reveal/,
    "skip reveal only when refreshing=1",
  );
});

// settleAfter freezes once tick > settleAfter (pickFrame). A monotonic tick from
// arm means DONE after a long WORKING session already has tick ≫ settleAfter and
// never animates. Reset tick when @herald_state changes so the first frame of a
// new state uses tick 0.
test("card loop resets tick when herald state changes (settleAfter relative to entry)", () => {
  assert.match(
    script,
    /prev_state/,
    "tracks previous state across loop iterations",
  );
  assert.match(
    script,
    /"\$state"\s*!=\s*"\$\{prev_state\}"/,
    "compares current state to previous",
  );
  // On change: tick=0 before render (first frame of new state), not only after.
  const changeBlock = script.match(
    /if\s+\[\s*"\$state"\s*!=\s*"\$\{prev_state\}"\s*\][\s\S]*?fi/,
  );
  assert.ok(changeBlock, "state-change if-block present");
  assert.match(changeBlock[0], /tick=0/, "resets tick to 0 on state change");
  assert.match(
    changeBlock[0],
    /prev_state=\$state/,
    "stores new state as prev",
  );

  // Reset must occur before the render invocation so first paint uses tick 0.
  const stateAssign = script.indexOf("state=${O[@herald_state]");
  const renderCall = script.indexOf("herald render --surface curtain-card");
  const tickReset = script.indexOf("tick=0", script.indexOf("prev_state"));
  assert.ok(
    stateAssign >= 0 && renderCall > stateAssign,
    "state read before render",
  );
  assert.ok(
    tickReset > stateAssign && tickReset < renderCall,
    "tick reset after state read and before render",
  );
});
