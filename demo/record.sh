#!/usr/bin/env bash
# Regenerate status-herald README demo GIFs from staged fixtures.
# Dev-only. Isolates all herald + tmux traffic to the greenui-demo socket
# and a throwaway sandbox HOME — never touches the live tmux server.
set -euo pipefail
cd "$(dirname "$0")"

GREEN_DEMO="${GREEN_DEMO:-$HOME/.local/lib/green-demo.sh}"
[ -r "$GREEN_DEMO" ] || {
  echo "green-demo.sh not found — run green-ui-kit/install.sh" >&2
  exit 1
}
# shellcheck source=/dev/null
. "$GREEN_DEMO"

REPO_ROOT="$(cd .. && pwd)"
HERALD_BIN="$REPO_ROOT/bin/herald"
STAGE_BOARD="$PWD/stage-board.mjs"
REAL_TMUX="$(command -v tmux)"
if [ -x /usr/bin/tmux ]; then REAL_TMUX=/usr/bin/tmux; fi

# --- sandbox (HOME + XDG) + fixture overlay + gen.sh ---
# IMPORTANT: call demo_sandbox in the current shell (no $() / pipes).
# Command substitution runs the function in a subshell and drops the exports.
demo_sandbox "$PWD" >/dev/null
SANDBOX_ROOT=$(dirname "$HOME")
export XDG_RUNTIME_DIR="$HOME/.runtime"
export AGENT_STATUS_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/agent-status"
mkdir -p "$XDG_RUNTIME_DIR" "$AGENT_STATUS_DIR" "$HOME/bin" "$PWD/../assets"
# Refuse to continue if sandboxing failed (would touch the live HOME).
case "$HOME" in
  /tmp/* | "${TMPDIR:-/tmp}"/*) ;;
  *)
    echo "record.sh: sandbox HOME is not under /tmp ($HOME) — abort" >&2
    exit 1
    ;;
esac

# --- PATH isolation: force bare `tmux` → greenui-demo only ---
# herald's lib/curtain/tmux.mjs execFileSync("tmux", ...) has no -L flag.
# A front-of-PATH wrapper keeps the live server untouchable without runtime edits.
SHIM_DIR="$HOME/bin"
cat >"$SHIM_DIR/tmux" <<EOF
#!/usr/bin/env bash
# Demo-only: pin every bare tmux call to the greenui-demo socket.
exec "$REAL_TMUX" -L greenui-demo "\$@"
EOF
chmod +x "$SHIM_DIR/tmux"

# herald shim: real CLI for everything except fleet inspect (no session arg).
# See stage-board.mjs for why the fleet board is rebuilt here.
cat >"$SHIM_DIR/herald" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "curtain" ] && [ "\${2:-}" = "inspect" ] && [ -z "\${3:-}" ]; then
  exec node "$STAGE_BOARD"
fi
exec node "$HERALD_BIN" "\$@"
EOF
chmod +x "$SHIM_DIR/herald"

export PATH="$SHIM_DIR:$REPO_ROOT/bin:$PATH"
# Never inherit the operator's live attached session socket.
unset TMUX || true
export HERALD_BIN
export TMUX_BIN="$SHIM_DIR/tmux"
export HERALD_DEMO_SESS=atlas
# Isolate the greenui-demo socket into the sandbox so concurrent fleet children
# that also use -L greenui-demo (under /tmp) cannot kill our server mid-record.
export TMUX_TMPDIR="$HOME/.tmux-tmp"
mkdir -p "$TMUX_TMPDIR"

# Clean prompt — no user@host (privacy gate). VHS/ttyd shells source .bashrc.
export PS1='demo$ '
export PROMPT_COMMAND=
cat >"$HOME/.bashrc" <<'RC'
# Demo interactive shell — sandbox PATH + clean prompt (privacy).
export PATH="$HOME/bin:${PATH}"
export PS1='demo$ '
unset PROMPT_COMMAND
# Do not re-attach to a foreign TMUX from the host environment.
unset TMUX
RC
# Non-interactive fallback used by some vhs shells.
cp "$HOME/.bashrc" "$HOME/.bash_profile"
# Ensure trigger is on PATH even if gen.sh ran before mkdir edge cases.
if [ ! -x "$HOME/bin/herald-demo-trigger.sh" ] && [ -f "$PWD/fixtures/gen.sh" ]; then
  bash "$PWD/fixtures/gen.sh" || true
fi

# --- isolated demo tmux server (socket lives under $TMUX_TMPDIR) ---
"$REAL_TMUX" -L greenui-demo kill-server 2>/dev/null || true
sleep 0.2
demo_tmux start
trap 'demo_tmux stop' EXIT

# Hide host chrome (status bar prints the machine hostname → privacy gate).
# Do NOT kill the harness "demo" session yet — tmux exits when the last
# session dies, and demo_tmux only created that one.
"$REAL_TMUX" -L greenui-demo set -g status off || true
"$REAL_TMUX" -L greenui-demo set -g set-titles off || true

stage_session() {
  local name=$1 state=$2 covered=$3 leases=$4 since_ago=$5
  local now exp lease_str
  now=$(date +%s)
  exp=$((now + 900))
  lease_str=${leases//EXP/$exp}

  "$REAL_TMUX" -L greenui-demo has-session -t "$name" 2>/dev/null \
    || "$REAL_TMUX" -L greenui-demo new-session -d -s "$name" -n "$name" "sleep 3600"

  # Per-session: no status bar, no host title (privacy).
  "$REAL_TMUX" -L greenui-demo set -t "$name" status off
  "$REAL_TMUX" -L greenui-demo set -t "$name" set-titles off

  # arm via herald (uses PATH tmux shim → greenui-demo)
  node "$HERALD_BIN" curtain arm "$name" >/dev/null 2>&1 || true
  # arm may re-enable set-titles; force off again for the demo capture.
  "$REAL_TMUX" -L greenui-demo set -t "$name" set-titles off
  "$REAL_TMUX" -L greenui-demo set -t "$name" status off

  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_state "$state"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_since "$((now - since_ago))"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_leases "$lease_str"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_last_hook "$((now - 3))"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_last_active "$((now - 3))"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_host_kind synthesis
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_settle_ts "$now"
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_theme forge
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_draw_ms 75
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_draw_frames 8
  "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_frame_ms 500

  if [ "$state" = "done" ]; then
    "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_worked "$since_ago"
  fi

  if [ "$covered" = "1" ]; then
    node "$HERALD_BIN" curtain cover "$name" >/dev/null 2>&1 || true
    "$REAL_TMUX" -L greenui-demo set -t "$name" @herald_covered 1
    "$REAL_TMUX" -L greenui-demo select-window -t "${name}:_curtain" 2>/dev/null || true
  fi
}

# Fixture fleet: atlas (hero WORKING card), beacon DONE, lumen NEEDS.
stage_session atlas working 1 \
  'subagent:syn-atlas-1:EXP,subagent:syn-atlas-2:EXP,watcher:loop-atlas:EXP,bg_shell:build-atlas:EXP' \
  42
stage_session beacon done 0 \
  'watcher:loop-beacon:EXP' \
  95
stage_session lumen needs 1 \
  'subagent:syn-lumen-1:EXP,bg_shell:test-lumen:EXP' \
  18

# Now safe to drop the harness placeholder session (fleet sessions keep server up).
"$REAL_TMUX" -L greenui-demo kill-session -t demo 2>/dev/null || true

# Clear any residual shut so trigger owns the draw sequence.
"$REAL_TMUX" -L greenui-demo set -t atlas @herald_draw "" || true
"$REAL_TMUX" -L greenui-demo select-window -t atlas:_curtain 2>/dev/null || true
# Re-assert no status bar / titles after arm (privacy: no hostname).
for s in atlas beacon lumen; do
  "$REAL_TMUX" -L greenui-demo set -t "$s" status off || true
  "$REAL_TMUX" -L greenui-demo set -t "$s" set-titles off || true
done

# Sanity: inspect board must be non-empty before recording.
board=$(herald curtain inspect || true)
case "$board" in
  *"HERALD STAGE"*) ;;
  *)
    echo "record.sh: stage board empty after staging — abort" >&2
    echo "$board" >&2
    exit 1
    ;;
esac

mkdir -p build
# Wait for the host to free a couple of vhs slots (fleet runs in parallel).
wait_for_vhs_slot() {
  local i=0
  while [ "$(pgrep -c vhs 2>/dev/null || echo 0)" -ge 3 ] && [ "$i" -lt 120 ]; do
    sleep 5
    i=$((i + 1))
  done
}

for tape in scenes/*.tape; do
  base=$(basename "$tape" .tape)
  # Drop stale outputs so a failed gate cannot leave a privacy-dirty gif.
  rm -f "../assets/demo-${base}.gif" "build/demo-${base}.txt" "build/${base}.tape"
  attempt=1
  max=5
  while [ "$attempt" -le "$max" ]; do
    wait_for_vhs_slot
    if demo_record "$tape"; then
      break
    fi
    echo "record.sh: demo_record failed for $tape (attempt $attempt/$max)" >&2
    if [ "$attempt" -eq "$max" ]; then
      exit 1
    fi
    sleep 8
    attempt=$((attempt + 1))
  done
done

echo "record.sh: all scenes ok (sandbox=$SANDBOX_ROOT)"
