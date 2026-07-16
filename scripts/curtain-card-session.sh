#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
#
# The session is resolved DYNAMICALLY every tick (no cached name): `show-options`
# with no -t reads the card pane's own session, so a `prefix + $` rename is
# transparent — the old name can never strand the card on the classic-idle
# fallback, and reveal always targets the live name.
set -u

# Resolve herald by absolute path next to this script. New Grok panes often ship
# a PATH that points at a different Node (e.g. nvm v24) where `npm link` never
# installed `herald` — a bare `herald` then fails silently (stderr → /dev/null)
# and the curtain is an empty screen. Absolute path always hits this checkout.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERALD_BIN="${HERALD_BIN:-$ROOT/bin/herald}"
if [ ! -x "$HERALD_BIN" ]; then
  # Last-ditch: whatever `herald` is on PATH (older arms / custom installs).
  HERALD_BIN="$(command -v herald 2>/dev/null || true)"
fi
herald() {
  if [ -n "${HERALD_BIN:-}" ] && [ -x "$HERALD_BIN" ]; then
    "$HERALD_BIN" "$@"
  else
    # Visible failure beat a blank pane (operators can see the path problem).
    printf '\033[H\033[2Jherald binary not found\n(expected %s/bin/herald)\n' "$ROOT"
    return 127
  fi
}

printf '\033[?25l'
# On exit, reveal — which (when tmuxBar coupling is on) restores the status bar,
# so a killed loop can't strand the dropped background.
# Skip when refreshCards is mid kill/recreate (@herald_refreshing=1); otherwise
# the trap would uncover under the freshly selected card (keypress no-op).
#
# CRITICAL: HUP/INT/TERM must *exit*, not only run cleanup. Bash trap on HUP
# that returns continues the loop — after `tmux kill-window` the orphan keeps
# painting a dead tty and fleets accumulate 100+ glitching card processes.
cleanup() {
  s=$(tmux display -p "#{session_name}" 2>/dev/null)
  r=$(tmux show -t "$s" -v @herald_refreshing 2>/dev/null || true)
  [ "$r" = "1" ] || herald curtain reveal "$s" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
tick=0
while :; do
  # One untargeted call dumps every option this repaint needs from the current
  # session. @herald_* values are single tokens, so `read -r k v` is safe.
  opts=$(tmux show-options 2>/dev/null)
  unset O
  declare -A O
  while IFS=' ' read -r k v; do
    [ -n "$k" ] && O["$k"]="$v"
  done <<<"$opts"
  state=${O[@herald_state]:-idle}
  since=${O[@herald_since]:-0}
  leases=${O[@herald_leases]:-}
  worked=${O[@herald_worked]:-0}
  theme=${O[@herald_theme]:-classic}
  frame_ms=${O[@herald_frame_ms]:-1000}
  covered=${O[@herald_covered]:-0}
  # settleAfter is relative to state entry: a monotonic tick from arm freezes
  # DONE/COMPACTING animation after a long WORKING session. Reset on change so
  # the first paint of the new state uses tick 0.
  prev_state=${prev_state-}
  if [ "$state" != "${prev_state}" ]; then
    tick=0
    prev_state=$state
  fi
  # Defense-in-depth: unstick WORKING/COMPACTING when hooks go quiet (Grok
  # synthesis hosts). Fail-open; no-op when settle policy has nothing to do.
  herald curtain settle >/dev/null 2>&1 || true
  # Bottom bar wash (working flow / done settle / needs pulse) from @herald_state.
  herald curtain wash >/dev/null 2>&1 || true
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --leases "${leases:-}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  tick=$((tick + 1))
  # Pace: the theme's hot rate (frame_ms) ONLY while covered/visible; otherwise
  # 1 s, so an animated theme on a revealed/detached session is not repainted
  # 2x/sec for a card nobody is looking at.
  if [ "$covered" = "1" ]; then ms=${frame_ms:-1000}; else ms=1000; fi
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac
  if read -rsn1 -t "$secs" 2>/dev/null; then
    herald curtain reveal "$(tmux display -p '#{session_name}' 2>/dev/null)" >/dev/null 2>&1 || true
  fi
done
