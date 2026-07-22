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
# Mouse tracking (SGR): corner chrome buttons (× off / ↻ pet) are clickable.
# Restored on exit so we never leave the host terminal sticky.
printf '\033[?1000h\033[?1002h\033[?1006h' 2>/dev/null || true
# On exit, reveal — which (when tmuxBar coupling is on) restores the status bar,
# so a killed loop can't strand the dropped background.
# Skip when refreshCards is mid kill/recreate (@herald_refreshing=1); otherwise
# the trap would uncover under the freshly selected card (keypress no-op).
#
# CRITICAL: HUP/INT/TERM must *exit*, not only run cleanup. Bash trap on HUP
# that returns continues the loop — after `tmux kill-window` the orphan keeps
# painting a dead tty and fleets accumulate 100+ glitching card processes.
cleanup() {
  printf '\033[?1006l\033[?1002l\033[?1000l' 2>/dev/null || true
  s=$(tmux display -p "#{session_name}" 2>/dev/null)
  r=$(tmux show -t "$s" -v @herald_refreshing 2>/dev/null || true)
  [ "$r" = "1" ] || herald curtain reveal "$s" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
tick=0
draw_tick=0
prev_draw=

# Apply a chrome action (pause | pet). Returns 0 if handled.
chrome_action() {
  local act=$1 sess=$2
  case "$act" in
    pause)
      # Hold curtain off for this session (stays armed; resume to re-enable).
      herald curtain pause "$sess" >/dev/null 2>&1 || true
      return 0
      ;;
    pet)
      herald curtain pet "$sess" >/dev/null 2>&1 || true
      return 0
      ;;
  esac
  return 1
}

# Read one input event within $1 seconds.
# Sets: IN_KIND=timeout|key|click  IN_KEY=  IN_X=  IN_Y=
read_event() {
  local timeout=$1
  IN_KIND=timeout
  IN_KEY=
  IN_X=
  IN_Y=
  local c n m ch seq b x y
  if ! read -rsn1 -t "$timeout" c 2>/dev/null; then
    return 1
  fi
  if [[ "$c" != $'\033' ]]; then
    IN_KIND=key
    IN_KEY=$c
    return 0
  fi
  # Escape sequence — try SGR mouse: ESC [ < b ; x ; y M/m
  read -rsn1 -t 0.02 n 2>/dev/null || { IN_KIND=key; IN_KEY=$'\033'; return 0; }
  if [[ "$n" != '[' ]]; then
    IN_KIND=key
    IN_KEY=$'\033'
    return 0
  fi
  read -rsn1 -t 0.02 m 2>/dev/null || { IN_KIND=key; IN_KEY=$'\033'; return 0; }
  if [[ "$m" != '<' ]]; then
    # Other CSI — drain briefly and treat as non-chrome key (reveal).
    IN_KIND=key
    IN_KEY=other
    return 0
  fi
  seq=""
  while read -rsn1 -t 0.05 ch 2>/dev/null; do
    seq+="$ch"
    if [[ "$ch" == "M" || "$ch" == "m" ]]; then
      break
    fi
  done
  # Only act on press (M), ignore release (m)
  if [[ "$seq" != *M ]]; then
    IN_KIND=timeout
    return 1
  fi
  seq=${seq%M}
  b=${seq%%;*}
  rest=${seq#*;}
  x=${rest%%;*}
  y=${rest#*;}
  # button 0 = left click (low 2 bits of b in basic protocol; SGR uses b directly)
  # SGR: b=0 left press
  if [[ "$b" != "0" && "$b" != "32" ]]; then
    IN_KIND=timeout
    return 1
  fi
  IN_KIND=click
  IN_X=$x
  IN_Y=$y
  return 0
}

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
  draw=${O[@herald_draw]:-}
  draw_ms=${O[@herald_draw_ms]:-75}
  draw_frames=${O[@herald_draw_frames]:-8}
  entity=${O[@herald_entity]:-}
  seed=${O[@herald_seed]:-0}
  # settleAfter is relative to state entry: a monotonic tick from arm freezes
  # DONE/COMPACTING animation after a long WORKING session. Reset on change so
  # the first paint of the new state uses tick 0.
  prev_state=${prev_state-}
  if [ "$state" != "${prev_state}" ]; then
    tick=0
    prev_state=$state
  fi
  # Act I stage-curtain: reset draw_tick when @herald_draw phase changes.
  if [ "$draw" != "${prev_draw}" ]; then
    draw_tick=0
    prev_draw=$draw
  fi
  # Defense-in-depth: unstick WORKING/COMPACTING when hooks go quiet (Grok
  # synthesis hosts). Fail-open; no-op when settle policy has nothing to do.
  herald curtain settle >/dev/null 2>&1 || true
  # Bottom bar wash (working flow / done settle / needs pulse) from @herald_state.
  herald curtain wash >/dev/null 2>&1 || true
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  # Stage draw flags for the pure render path (classic ignores them).
  draw_flags=()
  if [ "$draw" = "shut" ] || [ "$draw" = "open" ]; then
    draw_flags=(--draw "$draw" --draw-tick "$draw_tick")
  fi
  # Session name for the card label (prefix+$ renames show up next tick).
  sess_name=$(tmux display -p '#{session_name}' 2>/dev/null || true)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --leases "${leases:-}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --entity "${entity:-}" --seed "${seed:-0}" \
    --session "${sess_name:-}" \
    --cols "$cols" --rows "$rows" --color always \
    "${draw_flags[@]}" 2>/dev/null || true
  tick=$((tick + 1))
  # Advance / complete stage-curtain phase on the existing tick loop.
  if [ "$draw" = "shut" ] || [ "$draw" = "open" ]; then
    draw_tick=$((draw_tick + 1))
    # draw_frames frames indexed 0..N-1; complete once we've painted the last.
    if [ "$draw_tick" -ge "${draw_frames:-8}" ]; then
      if [ "$draw" = "open" ]; then
        herald curtain reveal "$(tmux display -p '#{session_name}' 2>/dev/null)" >/dev/null 2>&1 || true
      else
        # Shut finished — clear phase so the steady card shows.
        tmux set-option -u @herald_draw 2>/dev/null || true
      fi
      draw_tick=0
      prev_draw=
    fi
  fi
  # Pace: draw burst uses draw_ms (full shut/open ≤ ~600ms); else theme hot rate
  # ONLY while covered/visible; otherwise 1 s.
  if [ "$draw" = "shut" ] || [ "$draw" = "open" ]; then
    ms=${draw_ms:-75}
  elif [ "$covered" = "1" ]; then
    ms=${frame_ms:-1000}
  else
    ms=1000
  fi
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac

  if read_event "$secs"; then
    sess=$(tmux display -p '#{session_name}' 2>/dev/null)
    act=
    if [ "$IN_KIND" = "click" ]; then
      act=$(herald curtain chrome-hit --cols "${cols:-80}" --rows "${rows:-24}" \
        --x "${IN_X:-0}" --y "${IN_Y:-0}" 2>/dev/null || true)
    elif [ "$IN_KIND" = "key" ]; then
      # Single-letter chrome shortcuts (x/o = off, a/p = pet). Else reveal.
      act=$(herald curtain chrome-hit --key "${IN_KEY:-}" 2>/dev/null || true)
    fi
    if [ -n "$act" ] && chrome_action "$act" "$sess"; then
      # pause already reveals; pet stays on card (next tick shows new animal)
      :
    else
      # Default: any other click/key opens the live pane (fail-open).
      if [ "${theme:-classic}" != "classic" ] && [ "$draw" != "open" ] && [ "$covered" = "1" ]; then
        tmux set-option @herald_draw open 2>/dev/null || true
        draw_tick=0
        prev_draw=open
      else
        herald curtain reveal "$sess" >/dev/null 2>&1 || true
      fi
    fi
  fi
done
