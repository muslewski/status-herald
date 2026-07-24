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

// HUP from tmux kill-window must exit the process. A trap that only cleans up
// and returns leaves orphan loops painting dead ttys (100+ glitch fleet).
test("card loop exits on HUP/INT/TERM (no orphan after refresh)", () => {
  assert.match(script, /trap 'exit \d+' HUP/, "HUP exits the process");
  assert.match(script, /trap 'exit \d+' INT/, "INT exits the process");
  assert.match(script, /trap 'exit \d+' TERM/, "TERM exits the process");
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

// Act I: stage-curtain draw rides the existing tick loop (no new event loop).
// Scrollback of old paints = "matrix code" when mouse-scrolling the card.
test("card loop disables scrollback (alt screen + history-limit 0)", () => {
  assert.match(
    script,
    /1049h/,
    "enters alternate screen so paints do not fill primary history",
  );
  assert.match(
    script,
    /1049l/,
    "leaves alternate screen on cleanup",
  );
  assert.match(
    script,
    /history-limit\s+0/,
    "window history-limit 0 — nothing to scroll into",
  );
  assert.match(script, /clear-history/, "clears any inherited history at start");
  // CSI 3J at start / on wheel — NOT every paint (that feedback-looped pets).
  assert.match(script, /\\033\[3J|3J/, "erases terminal scrollback");
  assert.match(script, /WHEEL_PET_MS/, "debounces wheel→pet");
});

// Easter egg: wheel must cycle pets, never scroll or reveal.
test("card loop maps wheel to pet / pet-prev and never reveals on wheel", () => {
  assert.match(script, /IN_KIND=wheel|IN_WHEEL/, "decodes wheel events");
  assert.match(script, /pet-prev/, "wheel-up path exists");
  assert.match(
    script,
    /IN_KIND.*=.*wheel|wheel.*pet/,
    "wheel handled as first-class kind",
  );
  // Wheel branch must call pet without falling into reveal.
  const wheelStart = script.indexOf('if [ "$IN_KIND" = "wheel" ]');
  assert.ok(wheelStart >= 0, "wheel if-block present");
  const wheelSlice = script.slice(wheelStart, wheelStart + 900);
  assert.match(wheelSlice, /pet-prev/, "up → pet-prev");
  assert.match(wheelSlice, /chrome_action pet /, "down → pet");
  assert.doesNotMatch(
    wheelSlice,
    /curtain reveal/,
    "wheel must not reveal live pane",
  );
  // SGR wheel base codes: strict 64/65 after modifier mask (not bare b>=64)
  assert.match(script, /base=.*64|\"64\"/, "wheel-up base 64");
  assert.match(script, /\"65\"|base.*65/, "wheel-down base 65");
  assert.match(script, /WHEEL_PET_MS|last_wheel_pet/, "debounce thrash guard");
});

test("card loop reads @herald_draw and passes --draw/--draw-tick to render", () => {
  assert.match(script, /@herald_draw/, "reads draw phase");
  assert.match(script, /--draw/, "forwards draw direction");
  assert.match(script, /--draw-tick/, "forwards draw progress tick");
  assert.match(script, /@herald_draw_ms|draw_ms/, "draw burst cadence");
  assert.match(script, /@herald_draw_frames|draw_frames/, "draw frame count");
});

test("card loop uses draw_ms pace during shut/open (≤ ~600ms full draw)", () => {
  assert.match(
    script,
    /draw.*=.*shut|draw_ms/,
    "draw phase branches for pace",
  );
  // When drawing, ms comes from draw_ms not the slow uncovered 1s path alone.
  assert.match(script, /ms=\$\{draw_ms/);
});

test("card loop keypress starts open theatrics on non-classic before reveal", () => {
  assert.match(script, /@herald_draw open|herald_draw open/, "open phase");
  assert.match(script, /theme.*classic|classic.*theme/, "classic gate");
});
