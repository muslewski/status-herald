#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
#
# The session is resolved DYNAMICALLY every tick (no cached name): `show-options`
# with no -t reads the card pane's own session, so a `prefix + $` rename is
# transparent — the old name can never strand the card on the classic-idle
# fallback, and reveal always targets the live name.
set -u
printf '\033[?25l'
# On any exit/signal, reveal — which (when tmuxBar coupling is on) restores the
# status bar, so a killed loop can't strand the dropped background.
trap 'herald curtain reveal "$(tmux display -p "#{session_name}" 2>/dev/null)" >/dev/null 2>&1 || true' EXIT INT TERM HUP
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
  subs=${O[@herald_bg_subagents]:-0}
  shells=${O[@herald_bg_shells]:-0}
  worked=${O[@herald_worked]:-0}
  theme=${O[@herald_theme]:-classic}
  frame_ms=${O[@herald_frame_ms]:-1000}
  covered=${O[@herald_covered]:-0}
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
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
