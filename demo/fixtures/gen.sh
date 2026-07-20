#!/usr/bin/env bash
# Materialize sandbox-only herald fixtures. Runs inside demo_sandbox (HOME + XDG set).
# Deterministic modulo DEMO_ANCHOR_EPOCH. No personal paths, no keys.
set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(cd "$FIXTURES_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/.." && pwd)"
HERALD_BIN="${HERALD_BIN:-$REPO_ROOT/bin/herald}"

# Isolate agent-status + any runtime dirs from the live user tree.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$HOME/.runtime}"
mkdir -p "$XDG_RUNTIME_DIR" \
  "${XDG_STATE_HOME:-$HOME/.local/state}/agent-status/providers" \
  "${XDG_STATE_HOME:-$HOME/.local/state}/agent-status/sessions" \
  "$HOME/.claude" \
  "$HOME/.grok/hooks" \
  "$HOME/bin"

# Wire hooks into the sandbox HOME so doctor sees absolute + resolvable commands.
if [ -f "$HERALD_BIN" ]; then
  node "$HERALD_BIN" curtain install >/dev/null 2>&1 || true
  node "$HERALD_BIN" curtain install grok >/dev/null 2>&1 || true
fi

# Tiny agent-status heartbeats (informational doctor line only).
# Prefer XDG_STATE_HOME so doctor does not fall through to XDG_RUNTIME_DIR
# (which may still point at the live user tree if unset).
anchor=${DEMO_ANCHOR_EPOCH:-$(date +%s)}
now_ms=$((anchor * 1000))
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/agent-status"
# Also unset live runtime bleed: gen cannot clear parent env, but record.sh
# re-exports XDG_RUNTIME_DIR under the sandbox.
cat >"$state_dir/providers/token-oracle.json" <<EOF
{"schema":1,"name":"token-oracle","ts":${now_ms},"ttl_ms":3600000,"ok":true}
EOF
cat >"$state_dir/providers/agentic-sage.json" <<EOF
{"schema":1,"name":"agentic-sage","ts":${now_ms},"ttl_ms":3600000,"ok":true}
EOF

# Stage-draw trigger used by the hero tape (~1s after attach).
cat >"$HOME/bin/herald-demo-trigger.sh" <<'TRIG'
#!/usr/bin/env bash
# Fire shut → DONE (spark rain) → open on the pre-staged atlas session.
# Invoked from the VHS tape ~1s into the attached view.
set -euo pipefail
TMUX_BIN="${TMUX_BIN:-tmux}"
SESS="${HERALD_DEMO_SESS:-atlas}"
sleep 1
# Re-assert working + leases so the card has body during shut.
now=$(date +%s)
exp=$((now + 900))
leases="subagent:syn-atlas-1:${exp},subagent:syn-atlas-2:${exp},watcher:loop-atlas:${exp},bg_shell:build-atlas:${exp}"
"$TMUX_BIN" set -t "$SESS" @herald_state working
"$TMUX_BIN" set -t "$SESS" @herald_since "$((now - 42))"
"$TMUX_BIN" set -t "$SESS" @herald_leases "$leases"
"$TMUX_BIN" set -t "$SESS" @herald_last_hook "$((now - 2))"
"$TMUX_BIN" set -t "$SESS" @herald_last_active "$((now - 2))"
"$TMUX_BIN" set -t "$SESS" @herald_draw shut
# Shut budget ≈ 600ms (8 frames × 75ms); linger on the steady WORKING card.
sleep 1.2
# DONE unlocks spark rain theatrics on forge.
"$TMUX_BIN" set -t "$SESS" @herald_state done
"$TMUX_BIN" set -t "$SESS" @herald_worked 42
"$TMUX_BIN" set -t "$SESS" @herald_leases "watcher:loop-atlas:${exp}"
sleep 1.6
# Stage-curtain open (card loop paints open, then reveals).
"$TMUX_BIN" set -t "$SESS" @herald_draw open
TRIG
chmod +x "$HOME/bin/herald-demo-trigger.sh"
