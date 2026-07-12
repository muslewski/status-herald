#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
set -u
sess=$(tmux display -p '#{session_name}' 2>/dev/null)
[ -n "$sess" ] || exit 0
printf '\033[?25l'
tick=0
while :; do
  state=$(tmux show -t "$sess" -v @herald_state 2>/dev/null)
  since=$(tmux show -t "$sess" -v @herald_since 2>/dev/null)
  subs=$(tmux show -t "$sess" -v @herald_bg_subagents 2>/dev/null)
  shells=$(tmux show -t "$sess" -v @herald_bg_shells 2>/dev/null)
  worked=$(tmux show -t "$sess" -v @herald_worked 2>/dev/null)
  theme=$(tmux show -t "$sess" -v @herald_theme 2>/dev/null)
  frame_ms=$(tmux show -t "$sess" -v @herald_frame_ms 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  tick=$((tick + 1))
  # Repaint interval: @herald_frame_ms (default 1000) → seconds for read -t.
  ms=${frame_ms:-1000}
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac
  if read -rsn1 -t "$secs" 2>/dev/null; then
    herald curtain reveal "$sess" >/dev/null 2>&1 || true
  fi
done
