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
# Capture live HOME before sandbox so GREEN_DEMO path still works if relative.
SANDBOX_ROOT=$(demo_sandbox "$PWD")
export XDG_RUNTIME_DIR="$HOME/.runtime"
export AGENT_STATUS_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/agent-status"
mkdir -p "$XDG_RUNTIME_DIR" "$AGENT_STATUS_DIR" "$HOME/bin" "$PWD/../assets"

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

# Clean prompt — no user@host (privacy gate).
export PS1='demo$ '
export PROMPT_COMMAND=

# --- isolated demo tmux server ---
demo_tmux start
trap 'demo_tmux stop' EXIT

# Drop the harness default "demo" session; we stage atlas/beacon/lumen.
"$REAL_TMUX" -L greenui-demo kill-session -t demo 2>/dev/null || true

stage_session() {
  local name=$1 state=$2 covered=$3 leases=$4 since_ago=$5
  local now exp lease_str
  now=$(date +%s)
  exp=$((now + 900))
  lease_str=${leases//EXP/$exp}

  "$REAL_TMUX" -L greenui-demo has-session -t "$name" 2>/dev/null \
    || "$REAL_TMUX" -L greenui-demo new-session -d -s "$name" -n "$name" "sleep 3600"

  # arm via herald (uses PATH tmux shim → greenui-demo)
  node "$HERALD_BIN" curtain arm "$name" >/dev/null 2>&1 || true

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

# Clear any residual shut so trigger owns the draw sequence.
"$REAL_TMUX" -L greenui-demo set -t atlas @herald_draw ""
"$REAL_TMUX" -L greenui-demo select-window -t atlas:_curtain 2>/dev/null || true

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
for tape in scenes/*.tape; do
  demo_record "$tape"
done

echo "record.sh: all scenes ok (sandbox=$SANDBOX_ROOT)"
